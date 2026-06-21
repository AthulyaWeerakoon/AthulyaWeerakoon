"""Small conversation budgeting helpers for Huggy."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


DEFAULT_MAX_MESSAGE_WORDS = 160
DEFAULT_MAX_HISTORY_WORDS = 700
DEFAULT_MAX_LONG_TERM_WORDS = 360
DEFAULT_COMPACT_HISTORY_WORDS = 900
DEFAULT_COMPACT_TARGET_WORDS = 220

LONG_MESSAGE_REFUSALS = [
    "That message is too chunky for my tiny free-tier backpack. Ask me the short version.",
    "I respect the essay energy, but the backend has refused this one on budget grounds. Trim it and try again.",
    "That question is larger than my hosting plan's emotional support allowance. Smaller, please.",
    "I am but a modest free-tier bot. That message is too long for me to answer responsibly.",
    "Nope, that prompt tried to move in and sign a lease. Give me the compact version.",
    "Backend says no. I agree with backend. This message needs fewer words and fewer dramatic entrances.",
    "That is too long for this little portfolio bot. Condense it before the server starts judging both of us.",
    "I cannot process that much text on this setup. Free-tier dignity has boundaries.",
    "That message exceeded my tiny-token patience meter. Ask it in one clean question.",
    "I am hosted on a budget, not in a data center throne room. Shorten that and I will behave.",
    "The backend refused this because it is too long. Honestly, fair.",
    "That prompt is trying to become a novel. I support literature, but not inside this chat box.",
    "Too long. My free-tier knees buckled. Send a tighter version.",
    "I would answer, but the budget simply said no.",
    "That is beyond my current context budget. Give me the main question and I will answer it.",
    "That question is way too long. Might I suggest a haiku instead?",
    "I love reading, I swear! But I'm not in that emtional space right now. So~ something shorter, please?",
    "I'm not ChatGPT, I'm Huggy! And Huggy has a context budget. That message blew it.",
    "You're going to have to paypal Athulya and me for the extra tokens that message would have cost.",
    "You know I love you (platonically), but that message is too long for me to handle. I swear I'm trying my best.",
    "It's not you, it's me. Sorry to break this to you, but I just can't process that much text in one go.",
    "You know Athulya loves writing novels too, you should hit him up. Seems you both share that passion. But for now, let's keep it short and sweet in this chat",
    "I believe it's Shakespeare who said, 'Brevity is the soul of wit. Thus, prithee, compress thy wall of words ere thou bankrupt mine tokens.'",
    "I believe it was Abraham Lincoln who said, “The free-tier chatbot is not built for great burdens; let us therefore proceed with brevity, charity, and as few tokens as Providence allows.” He was famously stern about such matters.",
    "Okay, calm down, take a deep breath, and rethink what you just said- and make it shorter.'",
]


WORD_RE = re.compile(r"\b[\w'-]+\b")


@dataclass(frozen=True)
class ChatPair:
    user: str
    assistant: str

    def to_dict(self) -> dict[str, str]:
        return {"user": self.user, "assistant": self.assistant}


@dataclass(frozen=True)
class BudgetedHistory:
    accepted: list[ChatPair]
    rejected: list[ChatPair]
    ignored: list[dict[str, Any]]
    accepted_words: int
    rejected_words: int


class ContextBudgetError(ValueError):
    pass


def word_count(text: str | None) -> int:
    if not text:
        return 0
    return len(WORD_RE.findall(str(text)))


def refusal_for_long_message(message: str) -> str:
    index = word_count(message) % len(LONG_MESSAGE_REFUSALS)
    return LONG_MESSAGE_REFUSALS[index]


def normalize_long_term_context(raw_context: Any) -> str:
    if raw_context is None:
        return ""
    if isinstance(raw_context, str):
        return raw_context.strip()
    if isinstance(raw_context, dict):
        for key in ("summary", "context", "long_term_context", "memory"):
            value = raw_context.get(key)
            if isinstance(value, str):
                return value.strip()
        return ""
    return str(raw_context).strip()


def validate_long_term_context(raw_context: Any, max_words: int) -> str:
    context = normalize_long_term_context(raw_context)
    if word_count(context) > max_words:
        raise ContextBudgetError(
            f"Long-term context is too large. Limit it to {max_words} words before sending it back."
        )
    return context


def normalize_history(raw_history: Any, max_message_words: int) -> tuple[list[ChatPair], list[dict[str, Any]]]:
    pairs: list[ChatPair] = []
    ignored: list[dict[str, Any]] = []

    if not raw_history:
        return pairs, ignored

    history = raw_history
    if isinstance(raw_history, dict):
        history = (
            raw_history.get("pairs")
            or raw_history.get("history")
            or raw_history.get("messages")
            or []
        )

    if not isinstance(history, list):
        ignored.append({"reason": "history_not_a_list", "item": str(raw_history)[:200]})
        return pairs, ignored

    if _looks_like_message_list(history):
        return _pairs_from_messages(history, max_message_words)

    for item in history:
        pair = _pair_from_item(item)
        if pair is None:
            ignored.append({"reason": "unsupported_history_item", "item": str(item)[:200]})
            continue
        if _pair_has_long_message(pair, max_message_words):
            ignored.append({"reason": "history_pair_too_long", "pair": pair.to_dict()})
            continue
        pairs.append(pair)

    return pairs, ignored


def budget_history_newest(
    raw_history: Any,
    *,
    max_words: int,
    max_message_words: int,
) -> BudgetedHistory:
    pairs, ignored = normalize_history(raw_history, max_message_words)
    accepted_reversed: list[ChatPair] = []
    rejected: list[ChatPair] = []
    accepted_words = 0

    for pair in reversed(pairs):
        pair_words = _pair_word_count(pair)
        if pair_words and accepted_words + pair_words <= max_words:
            accepted_reversed.append(pair)
            accepted_words += pair_words
        else:
            rejected.append(pair)

    accepted = list(reversed(accepted_reversed))
    rejected.reverse()
    return BudgetedHistory(
        accepted=accepted,
        rejected=rejected,
        ignored=ignored,
        accepted_words=accepted_words,
        rejected_words=sum(_pair_word_count(pair) for pair in rejected),
    )


def budget_history_oldest(
    raw_history: Any,
    *,
    max_words: int,
    max_message_words: int,
) -> BudgetedHistory:
    pairs, ignored = normalize_history(raw_history, max_message_words)
    accepted: list[ChatPair] = []
    rejected: list[ChatPair] = []
    accepted_words = 0

    for pair in pairs:
        pair_words = _pair_word_count(pair)
        if pair_words and accepted_words + pair_words <= max_words:
            accepted.append(pair)
            accepted_words += pair_words
        else:
            rejected.append(pair)

    return BudgetedHistory(
        accepted=accepted,
        rejected=rejected,
        ignored=ignored,
        accepted_words=accepted_words,
        rejected_words=sum(_pair_word_count(pair) for pair in rejected),
    )


def render_history(pairs: list[ChatPair]) -> str:
    if not pairs:
        return "<no accepted chat history>"
    rendered = []
    for pair in pairs:
        rendered.append(f"User: {pair.user}\nHuggy: {pair.assistant}")
    return "\n\n".join(rendered)


def pair_dicts(pairs: list[ChatPair]) -> list[dict[str, str]]:
    return [pair.to_dict() for pair in pairs]


def _looks_like_message_list(history: list[Any]) -> bool:
    return all(isinstance(item, dict) and "role" in item and "content" in item for item in history)


def _pairs_from_messages(
    messages: list[dict[str, Any]],
    max_message_words: int,
) -> tuple[list[ChatPair], list[dict[str, Any]]]:
    pairs: list[ChatPair] = []
    ignored: list[dict[str, Any]] = []
    pending_user: str | None = None

    for message in messages:
        role = str(message.get("role", "")).lower()
        content = str(message.get("content", "")).strip()
        if not content:
            continue
        if role == "user":
            if pending_user is not None:
                ignored.append({"reason": "incomplete_user_turn", "message": pending_user})
            pending_user = content
        elif role in {"assistant", "huggy", "bot"}:
            if pending_user is None:
                ignored.append({"reason": "assistant_without_user", "message": content})
                continue
            pair = ChatPair(user=pending_user, assistant=content)
            pending_user = None
            if _pair_has_long_message(pair, max_message_words):
                ignored.append({"reason": "history_pair_too_long", "pair": pair.to_dict()})
                continue
            pairs.append(pair)

    if pending_user is not None:
        ignored.append({"reason": "incomplete_user_turn", "message": pending_user})

    return pairs, ignored


def _pair_from_item(item: Any) -> ChatPair | None:
    if isinstance(item, ChatPair):
        return item
    if isinstance(item, (list, tuple)) and len(item) >= 2:
        user, assistant = str(item[0]).strip(), str(item[1]).strip()
        if user and assistant:
            return ChatPair(user=user, assistant=assistant)
    if isinstance(item, dict):
        user = item.get("user") or item.get("request") or item.get("question")
        assistant = item.get("assistant") or item.get("response") or item.get("answer")
        if user and assistant:
            return ChatPair(user=str(user).strip(), assistant=str(assistant).strip())
    return None


def _pair_has_long_message(pair: ChatPair, max_message_words: int) -> bool:
    return word_count(pair.user) > max_message_words or word_count(pair.assistant) > max_message_words


def _pair_word_count(pair: ChatPair) -> int:
    return word_count(pair.user) + word_count(pair.assistant)
