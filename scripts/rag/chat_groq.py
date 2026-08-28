#!/usr/bin/env python3
"""Huggy chat runner using Groq plus retrieved portfolio context."""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Iterable

from commands import match_frontend_command
from conversation import render_history, render_retrieval_query
from rate_limits import rate_limit_payload


DEFAULT_MODEL = "openai/gpt-oss-20b"
DEFAULT_CHATBOT_CONTEXT = Path("knowledge/huggy-chatbot-context.md")
DEFAULT_ARTIFACT_DIR = Path("rag_artifacts")
DEFAULT_MAX_CHUNKS = 6
DEFAULT_SCORE_THRESHOLD = 0.34
DEFAULT_MAX_OUTPUT_TOKENS = 240
DEFAULT_TIMEOUT_SECONDS = 20.0


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def log(message: str, verbose: bool) -> None:
    if verbose:
        print(message, file=sys.stderr, flush=True)


def log_elapsed(label: str, start_time: float, verbose: bool) -> None:
    log(f"{label} in {time.perf_counter() - start_time:.2f}s.", verbose)


def build_prompt(
    user_message: str,
    chatbot_context: str,
    retrieved_context: str,
    chat_history: str = "",
    long_term_context: str = "",
) -> str:
    context_block = retrieved_context if retrieved_context else "<no relevant context found>"
    history_block = chat_history if chat_history else "<no accepted chat history>"
    memory_block = long_term_context if long_term_context else "<no long-term context>"
    return f"""You are answering as Huggy.

CHATBOT INSTRUCTIONS:
{chatbot_context}

LONG-TERM CHAT CONTEXT:
{memory_block}

RECENT CHAT HISTORY:
{history_block}

RETRIEVED KNOWLEDGE:
{context_block}

USER MESSAGE:
{user_message}

Answer using the retrieved knowledge, chatbot instructions, and supplied chat context.

For factual questions about Athulya, his work, his writing, his projects, or his portfolio, use the knowledge corpus as the source of truth. The chat context may clarify pronouns or follow-up questions, but it must not override the knowledge corpus. If a factual Athulya question is not answered by the retrieved knowledge, say that the answer is not in the current corpus.

For harmless small talk, greetings, thanks, compliments, and questions about Huggy's own UI character, answer naturally from the chatbot instructions without requiring retrieved knowledge.

If a frontend command is appropriate, output only the command."""


def build_compaction_prompt(
    chatbot_context: str,
    previous_long_term_context: str,
    accepted_history: str,
    target_words: int,
) -> str:
    return f"""You are Huggy's memory compactor.

CHATBOT INSTRUCTIONS:
{chatbot_context}

PREVIOUS LONG-TERM CHAT CONTEXT:
{previous_long_term_context or "<none>"}

CHAT HISTORY TO COMPACT:
{accepted_history or "<none>"}

Write a compact long-term context object for future Huggy replies.

Rules:
- Keep only durable facts, user preferences, unresolved tasks, and useful conversation state.
- Do not include exact wording unless it matters.
- Do not invent facts.
- Do not summarize Athulya's portfolio corpus unless the user discussed it in this chat.
- Keep it under {target_words} words.
- Return plain text only."""


class HuggyGroq:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str = DEFAULT_MODEL,
        artifact_dir: Path = DEFAULT_ARTIFACT_DIR,
        chatbot_context_path: Path = DEFAULT_CHATBOT_CONTEXT,
        max_chunks: int = DEFAULT_MAX_CHUNKS,
        score_threshold: float = DEFAULT_SCORE_THRESHOLD,
        max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        verbose: bool = False,
        local_files_only: bool | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("GROQ_API_KEY")
        if not self.api_key:
            raise RuntimeError("GROQ_API_KEY is not set.")

        started_at = time.perf_counter()
        log("Initializing Groq client...", verbose)
        from groq import Groq

        self.client = Groq(api_key=self.api_key, timeout=timeout_seconds)
        log_elapsed("Initialized Groq client", started_at, verbose)

        self.model = model
        self.verbose = verbose
        self.chatbot_context = read_text(chatbot_context_path)

        started_at = time.perf_counter()
        log("Loading RAG retriever...", verbose)
        from fetch_context import Retriever

        self.retriever = Retriever(
            artifact_dir,
            verbose=verbose,
            local_files_only=local_files_only,
        )
        log_elapsed("Loaded RAG retriever", started_at, verbose)

        self.max_chunks = max_chunks
        self.score_threshold = score_threshold
        self.max_output_tokens = max_output_tokens
        self.last_rate_limit: dict = {}

    def retrieved_context_for(self, message: str, include_scores: bool = False) -> str:
        started_at = time.perf_counter()
        log("Fetching relevant RAG context...", self.verbose)
        results = self.retriever.fetch(message, self.max_chunks, self.score_threshold)
        log_elapsed(f"Retrieved {len(results)} chunk(s)", started_at, self.verbose)
        from fetch_context import render_context

        return render_context(results, include_scores=include_scores)

    def prompt_for(
        self,
        message: str,
        *,
        chat_history: str = "",
        long_term_context: str = "",
        retrieval_query: str | None = None,
    ) -> str:
        return build_prompt(
            message,
            self.chatbot_context,
            self.retrieved_context_for(retrieval_query or message),
            chat_history=chat_history,
            long_term_context=long_term_context,
        )

    def stream(
        self,
        message: str,
        *,
        chat_history_pairs: list | None = None,
        long_term_context: str = "",
    ) -> Iterable[str]:
        if command := match_frontend_command(message):
            log(f"Matched frontend command: {command}", self.verbose)
            yield command
            return

        history_pairs = chat_history_pairs or []
        prompt = self.prompt_for(
            message,
            chat_history=render_history(history_pairs),
            long_term_context=long_term_context,
            retrieval_query=render_retrieval_query(message, history_pairs, long_term_context),
        )
        yield from self.stream_prompt(prompt)

    def stream_prompt(self, prompt: str) -> Iterable[str]:
        started_at = time.perf_counter()
        log(f"Calling Groq model: {self.model}", self.verbose)
        received_first_chunk = False
        with self.client.chat.completions.with_streaming_response.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=self.max_output_tokens,
            temperature=0.4,
            top_p=0.95,
            reasoning_effort="low",
            include_reasoning=False,
            stream=True,
        ) as response:
            self.last_rate_limit = rate_limit_payload(
                response.headers,
                provider="groq",
                status_code=response.status_code,
            )
            stream = response.parse()
            for chunk in stream:
                text = chunk.choices[0].delta.content
                if text:
                    if not received_first_chunk:
                        log_elapsed("Received first Groq chunk", started_at, self.verbose)
                        received_first_chunk = True
                    yield text
        log_elapsed("Finished Groq response", started_at, self.verbose)

    def rate_limit_metadata(self) -> dict:
        return self.last_rate_limit

    def compact_context(
        self,
        *,
        previous_long_term_context: str,
        chat_history_pairs: list,
        target_words: int,
    ) -> str:
        prompt = build_compaction_prompt(
            self.chatbot_context,
            previous_long_term_context,
            render_history(chat_history_pairs),
            target_words,
        )
        return "".join(self.stream_prompt(prompt)).strip()

    def answer(
        self,
        message: str,
        *,
        chat_history_pairs: list | None = None,
        long_term_context: str = "",
    ) -> str:
        return "".join(
            self.stream(
                message,
                chat_history_pairs=chat_history_pairs,
                long_term_context=long_term_context,
            )
        ).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Try Huggy locally with Groq and RAG context.")
    parser.add_argument("message", nargs="?", help="User message. Omit for interactive mode.")
    parser.add_argument("--model", default=os.environ.get("GROQ_MODEL", DEFAULT_MODEL))
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--chatbot-context", type=Path, default=DEFAULT_CHATBOT_CONTEXT)
    parser.add_argument("--max-chunks", type=int, default=DEFAULT_MAX_CHUNKS)
    parser.add_argument("--score-threshold", type=float, default=DEFAULT_SCORE_THRESHOLD)
    parser.add_argument("--max-output-tokens", type=int, default=DEFAULT_MAX_OUTPUT_TOKENS)
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=float(os.environ.get("GROQ_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)),
    )
    parser.add_argument("--verbose", action="store_true", help="Show progress logs.")
    parser.add_argument("--show-context", action="store_true")
    parser.add_argument("--show-scores", action="store_true")
    parser.add_argument("--local-files-only", action="store_true")
    args = parser.parse_args()

    if args.message and (command := match_frontend_command(args.message)):
        print(command)
        return

    huggy = HuggyGroq(
        model=args.model,
        artifact_dir=args.artifact_dir,
        chatbot_context_path=args.chatbot_context,
        max_chunks=args.max_chunks,
        score_threshold=args.score_threshold,
        max_output_tokens=args.max_output_tokens,
        timeout_seconds=args.timeout_seconds,
        verbose=args.verbose,
        local_files_only=args.local_files_only or None,
    )

    def answer(message: str) -> str:
        if args.show_context:
            print("\n[retrieved context]")
            print(huggy.retrieved_context_for(message, include_scores=args.show_scores) or "<empty>")
            print("[/retrieved context]\n")
        return huggy.answer(message)

    if args.message:
        print(answer(args.message))
        return

    print("Huggy Groq chat. Press Ctrl-D or Ctrl-C to exit.")
    while True:
        try:
            message = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not message:
            continue
        print("\nHuggy: ", end="")
        for text in huggy.stream(message):
            print(text, end="", flush=True)
        print()


if __name__ == "__main__":
    main()
