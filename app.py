"""Gradio entrypoint for the Huggy Hugging Face Space."""

from __future__ import annotations

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


_huggy: HuggyGemini | HuggyGroq | None = None


def env_truthy(name: str) -> bool:
    return os.environ.get(name, "").lower() in {"1", "true", "yes", "on"}


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


def respond(message: str, history: list[dict] | None = None):
    del history
    if not message.strip():
        yield "Ask me something about Athulya first. I promise this works better with input."
        return

    if command := match_frontend_command(message):
        yield command
        return

    try:
        answer = ""
        for text in get_huggy().stream(message):
            answer += text
            yield answer
    except RuntimeError as exc:
        yield f"{exc} Add it as a Hugging Face Space secret or local environment variable."
    except Exception as exc:
        if env_truthy("HUGGY_DEBUG_ERRORS"):
            yield f"Huggy hit an API error before answering: {exc}"
        else:
            yield "Huggy hit an API error before answering. Tiny free-tier dignity crisis. Try again in a moment."


demo = gr.ChatInterface(
    fn=respond,
    title="Huggy",
    description="Athulya's portfolio assistant.",
    type="messages",
)


if __name__ == "__main__":
    demo.launch()
