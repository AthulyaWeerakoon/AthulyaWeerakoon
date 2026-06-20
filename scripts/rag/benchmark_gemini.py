#!/usr/bin/env python3
"""Benchmark Gemini first-token latency with tiny prompts."""

from __future__ import annotations

import argparse
import os
import time

from google import genai
from google.genai import types


DEFAULT_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash-8b",
]
DEFAULT_PROMPT = "Reply with exactly: ok"
DEFAULT_TIMEOUT_MS = 20_000
DEFAULT_DELAY_SECONDS = 40.0


def benchmark_model(client: genai.Client, model: str, prompt: str) -> tuple[float | None, str]:
    started_at = time.perf_counter()
    received_first = False
    output = ""

    try:
        for chunk in client.models.generate_content_stream(
            model=model,
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=prompt)],
                )
            ],
            config=types.GenerateContentConfig(max_output_tokens=16),
        ):
            if text := chunk.text:
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
    parser = argparse.ArgumentParser(description="Benchmark Gemini model latency.")
    parser.add_argument(
        "--models",
        nargs="+",
        default=DEFAULT_MODELS,
        help="Gemini model names to test.",
    )
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=int(os.environ.get("GEMINI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)),
    )
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=float(os.environ.get("GEMINI_BENCHMARK_DELAY_SECONDS", DEFAULT_DELAY_SECONDS)),
        help="Delay between model tests to avoid free-tier per-minute quota errors.",
    )
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("GEMINI_API_KEY is not set.")

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=args.timeout_ms),
    )

    for index, model in enumerate(args.models):
        if index and args.delay_seconds > 0:
            time.sleep(args.delay_seconds)
        latency, detail = benchmark_model(client, model, args.prompt)
        if latency is None:
            print(f"{model}: failed - {detail}")
        else:
            print(f"{model}: first token {latency:.2f}s - {detail}")


if __name__ == "__main__":
    main()
