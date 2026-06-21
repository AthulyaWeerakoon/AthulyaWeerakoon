#!/usr/bin/env python3
"""Benchmark Groq first-token latency with tiny prompts."""

from __future__ import annotations

import argparse
import os
import time

from groq import Groq


DEFAULT_MODELS = [
    "llama-3.1-8b-instant",
    "openai/gpt-oss-20b",
    "qwen/qwen3-32b",
]
DEFAULT_PROMPT = "Reply with exactly: ok"
DEFAULT_TIMEOUT_SECONDS = 20.0


def benchmark_model(client: Groq, model: str, prompt: str) -> tuple[float | None, str]:
    started_at = time.perf_counter()
    received_first = False
    output = ""

    try:
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=16,
            temperature=0,
            stream=True,
        )
        for chunk in stream:
            text = chunk.choices[0].delta.content
            if text:
                output += text
                if not received_first:
                    first_token_latency = time.perf_counter() - started_at
                    received_first = True
        if not received_first:
            return None, "<no text returned>"
        total = time.perf_counter() - started_at
        return first_token_latency, f"{total:.2f}s total, {output.strip()!r}"
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark Groq model latency.")
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=float(os.environ.get("GROQ_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)),
    )
    args = parser.parse_args()

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise SystemExit("GROQ_API_KEY is not set.")

    client = Groq(api_key=api_key, timeout=args.timeout_seconds)

    for model in args.models:
        latency, detail = benchmark_model(client, model, args.prompt)
        if latency is None:
            print(f"{model}: failed - {detail}")
        else:
            print(f"{model}: first token {latency:.2f}s - {detail}")


if __name__ == "__main__":
    main()
