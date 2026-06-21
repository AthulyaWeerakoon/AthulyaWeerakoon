"""Gradio entrypoint for the Huggy Hugging Face Space."""

from __future__ import annotations

import hmac
import os
import sys
from pathlib import Path

import gradio as gr


ROOT = Path(__file__).resolve().parent
RAG_DIR = ROOT / "scripts" / "rag"
sys.path.insert(0, str(RAG_DIR))

from chat_gemini import DEFAULT_MODEL as DEFAULT_GEMINI_MODEL, HuggyGemini  # noqa: E402
from chat_groq import DEFAULT_MODEL as DEFAULT_GROQ_MODEL, HuggyGroq  # noqa: E402
from commands import match_frontend_command  # noqa: E402
from conversation import (  # noqa: E402
    ContextBudgetError,
    DEFAULT_COMPACT_HISTORY_WORDS,
    DEFAULT_COMPACT_TARGET_WORDS,
    DEFAULT_MAX_HISTORY_WORDS,
    DEFAULT_MAX_LONG_TERM_WORDS,
    DEFAULT_MAX_MESSAGE_WORDS,
    budget_history_newest,
    budget_history_oldest,
    pair_dicts,
    refusal_for_long_message,
    validate_long_term_context,
    word_count,
)


_huggy: HuggyGemini | HuggyGroq | None = None


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def env_truthy(name: str) -> bool:
    return os.environ.get(name, "").lower() in {"1", "true", "yes", "on"}


MAX_MESSAGE_WORDS = env_int("HUGGY_MAX_MESSAGE_WORDS", DEFAULT_MAX_MESSAGE_WORDS)
MAX_HISTORY_WORDS = env_int("HUGGY_MAX_HISTORY_WORDS", DEFAULT_MAX_HISTORY_WORDS)
MAX_LONG_TERM_WORDS = env_int("HUGGY_MAX_LONG_TERM_WORDS", DEFAULT_MAX_LONG_TERM_WORDS)
COMPACT_HISTORY_WORDS = env_int("HUGGY_COMPACT_HISTORY_WORDS", DEFAULT_COMPACT_HISTORY_WORDS)
COMPACT_TARGET_WORDS = env_int("HUGGY_COMPACT_TARGET_WORDS", DEFAULT_COMPACT_TARGET_WORDS)
API_ONLY = env_truthy("HUGGY_API_ONLY")
REQUIRE_SECRET = env_truthy("HUGGY_REQUIRE_SECRET") or bool(os.environ.get("HUGGY_CLOUDFLARE_SECRET"))
SECRET_HEADER_NAME = os.environ.get("HUGGY_SECRET_HEADER", "x-huggy-secret").lower()
SECRET_VALUE = os.environ.get("HUGGY_CLOUDFLARE_SECRET", "")


def get_huggy():
    global _huggy
    if _huggy is None:
        provider = os.environ.get("HUGGY_PROVIDER", "groq").lower()
        common_kwargs = {
            "artifact_dir": ROOT / "rag_artifacts",
            "chatbot_context_path": ROOT / "knowledge" / "huggy-chatbot-context.md",
            "local_files_only": env_truthy("RAG_LOCAL_FILES_ONLY"),
            "max_chunks": int(os.environ.get("HUGGY_MAX_CHUNKS", "6")),
            "score_threshold": float(os.environ.get("HUGGY_SCORE_THRESHOLD", "0.34")),
            "max_output_tokens": int(os.environ.get("HUGGY_MAX_OUTPUT_TOKENS", "320")),
        }
        if provider == "groq":
            _huggy = HuggyGroq(
                model=os.environ.get("GROQ_MODEL", DEFAULT_GROQ_MODEL),
                **common_kwargs,
            )
        else:
            _huggy = HuggyGemini(
                model=os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL),
                **common_kwargs,
            )
    return _huggy


def _error_response(message: str, *, refused: bool = True) -> dict:
    return {
        "reply": message,
        "backend_refused": refused,
        "accepted_history": [],
        "forwarded_history": [],
        "ignored_history": [],
        "metadata": {
            "accepted_history_words": 0,
            "forwarded_history_words": 0,
            "max_message_words": MAX_MESSAGE_WORDS,
            "max_history_words": MAX_HISTORY_WORDS,
            "max_long_term_words": MAX_LONG_TERM_WORDS,
        },
    }


def _request_header(request: gr.Request | None, name: str) -> str:
    if request is None:
        return ""
    headers = getattr(request, "headers", {}) or {}
    if hasattr(headers, "get"):
        return headers.get(name, "") or headers.get(name.lower(), "") or headers.get(name.title(), "")
    return ""


def _authorized(request: gr.Request | None) -> bool:
    if not REQUIRE_SECRET:
        return True
    if not SECRET_VALUE:
        return False
    return hmac.compare_digest(_request_header(request, SECRET_HEADER_NAME), SECRET_VALUE)


def _unauthorized_response() -> dict:
    return {
        "reply": "Unauthorized.",
        "backend_refused": True,
        "accepted_history": [],
        "forwarded_history": [],
        "ignored_history": [],
        "metadata": {"error": "missing_or_invalid_cloudflare_secret_header"},
    }


def _chat_response(
    message: str,
    chat_history: list[dict] | dict | None = None,
    long_term_context: dict | str | None = None,
) -> dict:
    if not message.strip():
        return _error_response(
            "Ask me something about Athulya first. I promise this works better with input."
        )

    if word_count(message) > MAX_MESSAGE_WORDS:
        return _error_response(refusal_for_long_message(message))

    try:
        accepted_long_term_context = validate_long_term_context(
            long_term_context,
            MAX_LONG_TERM_WORDS,
        )
    except ContextBudgetError as exc:
        return _error_response(str(exc))

    budgeted = budget_history_newest(
        chat_history,
        max_words=MAX_HISTORY_WORDS,
        max_message_words=MAX_MESSAGE_WORDS,
    )

    if command := match_frontend_command(message):
        reply = command
    else:
        reply = get_huggy().answer(
            message,
            chat_history_pairs=budgeted.accepted,
            long_term_context=accepted_long_term_context,
        )

    return {
        "reply": reply,
        "backend_refused": False,
        "accepted_history": pair_dicts(budgeted.accepted),
        "forwarded_history": pair_dicts(budgeted.rejected),
        "ignored_history": budgeted.ignored,
        "metadata": {
            "accepted_history_words": budgeted.accepted_words,
            "forwarded_history_words": budgeted.rejected_words,
            "max_message_words": MAX_MESSAGE_WORDS,
            "max_history_words": MAX_HISTORY_WORDS,
            "max_long_term_words": MAX_LONG_TERM_WORDS,
            "long_term_context_words": word_count(accepted_long_term_context),
        },
    }


def chat_api(
    message: str,
    chat_history: list[dict] | dict | None = None,
    long_term_context: dict | str | None = None,
    request: gr.Request | None = None,
) -> dict:
    if not _authorized(request):
        return _unauthorized_response()
    try:
        return _chat_response(message, chat_history, long_term_context)
    except RuntimeError as exc:
        return _error_response(
            f"{exc} Add it as a Hugging Face Space secret or local environment variable."
        )
    except Exception as exc:
        if env_truthy("HUGGY_DEBUG_ERRORS"):
            return _error_response(f"Huggy hit an API error before answering: {exc}")
        return _error_response(
            "Huggy hit an API error before answering. Tiny free-tier dignity crisis. Try again in a moment."
        )


def compact_context_api(
    chat_history: list[dict] | dict | None = None,
    previous_long_term_context: dict | str | None = None,
    request: gr.Request | None = None,
) -> dict:
    if not _authorized(request):
        return {
            "long_term_context": {"summary": ""},
            "backend_refused": True,
            "error": "Unauthorized.",
            "accepted_history": [],
            "ignored_end_history": [],
            "ignored_history": [],
            "metadata": {"error": "missing_or_invalid_cloudflare_secret_header"},
        }

    try:
        accepted_long_term_context = validate_long_term_context(
            previous_long_term_context,
            MAX_LONG_TERM_WORDS,
        )
    except ContextBudgetError as exc:
        return {
            "long_term_context": {"summary": ""},
            "backend_refused": True,
            "error": str(exc),
            "accepted_history": [],
            "ignored_end_history": [],
            "ignored_history": [],
            "metadata": {"max_long_term_words": MAX_LONG_TERM_WORDS},
        }

    budgeted = budget_history_oldest(
        chat_history,
        max_words=COMPACT_HISTORY_WORDS,
        max_message_words=MAX_MESSAGE_WORDS,
    )
    if not budgeted.accepted and not accepted_long_term_context:
        return {
            "long_term_context": {"summary": ""},
            "backend_refused": False,
            "accepted_history": [],
            "ignored_end_history": pair_dicts(budgeted.rejected),
            "ignored_history": budgeted.ignored,
            "metadata": {
                "accepted_history_words": 0,
                "ignored_end_history_words": budgeted.rejected_words,
                "compact_history_word_limit": COMPACT_HISTORY_WORDS,
                "target_words": COMPACT_TARGET_WORDS,
            },
        }

    try:
        compacted = get_huggy().compact_context(
            previous_long_term_context=accepted_long_term_context,
            chat_history_pairs=budgeted.accepted,
            target_words=COMPACT_TARGET_WORDS,
        )
    except RuntimeError as exc:
        return {
            "long_term_context": {"summary": ""},
            "backend_refused": True,
            "error": f"{exc} Add it as a Hugging Face Space secret or local environment variable.",
            "accepted_history": pair_dicts(budgeted.accepted),
            "ignored_end_history": pair_dicts(budgeted.rejected),
            "ignored_history": budgeted.ignored,
            "metadata": {"target_words": COMPACT_TARGET_WORDS},
        }
    except Exception as exc:
        error = f"Huggy hit an API error during compaction: {exc}" if env_truthy("HUGGY_DEBUG_ERRORS") else "Huggy hit an API error during compaction."
        return {
            "long_term_context": {"summary": ""},
            "backend_refused": True,
            "error": error,
            "accepted_history": pair_dicts(budgeted.accepted),
            "ignored_end_history": pair_dicts(budgeted.rejected),
            "ignored_history": budgeted.ignored,
            "metadata": {"target_words": COMPACT_TARGET_WORDS},
        }

    return {
        "long_term_context": {"summary": compacted},
        "backend_refused": False,
        "accepted_history": pair_dicts(budgeted.accepted),
        "ignored_end_history": pair_dicts(budgeted.rejected),
        "ignored_history": budgeted.ignored,
        "metadata": {
            "accepted_history_words": budgeted.accepted_words,
            "ignored_end_history_words": budgeted.rejected_words,
            "compact_history_word_limit": COMPACT_HISTORY_WORDS,
            "target_words": COMPACT_TARGET_WORDS,
            "previous_long_term_context_words": word_count(accepted_long_term_context),
            "new_long_term_context_words": word_count(compacted),
        },
    }


def respond(message: str, history: list[dict] | None = None):
    if not message.strip():
        yield "Ask me something about Athulya first. I promise this works better with input."
        return

    try:
        if word_count(message) > MAX_MESSAGE_WORDS:
            yield refusal_for_long_message(message)
            return

        budgeted = budget_history_newest(
            history,
            max_words=MAX_HISTORY_WORDS,
            max_message_words=MAX_MESSAGE_WORDS,
        )
        if command := match_frontend_command(message):
            yield command
            return

        answer = ""
        for text in get_huggy().stream(message, chat_history_pairs=budgeted.accepted):
            answer += text
            yield answer
    except RuntimeError as exc:
        yield f"{exc} Add it as a Hugging Face Space secret or local environment variable."
    except Exception as exc:
        if env_truthy("HUGGY_DEBUG_ERRORS"):
            yield f"Huggy hit an API error before answering: {exc}"
        else:
            yield "Huggy hit an API error before answering. Tiny free-tier dignity crisis. Try again in a moment."


with gr.Blocks(title="Huggy") as demo:
    if not API_ONLY:
        gr.ChatInterface(
            fn=respond,
            title="Huggy",
            description="Athulya's portfolio assistant.",
        )

    with gr.Group(visible=not API_ONLY):
        with gr.Accordion("API utilities", open=False):
            gr.Markdown(
                "Use these for the portfolio frontend. Chat keeps the newest full turns and forwards older overflow. Compaction keeps the oldest overflow and ignores newer overflow."
            )
            with gr.Tab("Chat API"):
                chat_message = gr.Textbox(label="Message")
                chat_history = gr.JSON(label="Chat history")
                chat_long_term_context = gr.JSON(label="Long-term context")
                chat_output = gr.JSON(label="Response")
                chat_button = gr.Button("Send")
            with gr.Tab("Compact Context API"):
                compact_history = gr.JSON(label="History to compact")
                previous_context = gr.JSON(label="Previous long-term context")
                compact_output = gr.JSON(label="Compacted context")
                compact_button = gr.Button("Compact")

    chat_button.click(
        chat_api,
        inputs=[chat_message, chat_history, chat_long_term_context],
        outputs=chat_output,
        api_name="chat",
        api_visibility="public",
    )

    compact_button.click(
        compact_context_api,
        inputs=[compact_history, previous_context],
        outputs=compact_output,
        api_name="compact_context",
        api_visibility="public",
    )


if __name__ == "__main__":
    demo.launch(footer_links=[] if API_ONLY else None)
