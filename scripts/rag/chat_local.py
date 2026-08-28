#!/usr/bin/env python3
"""Local Huggy chat runner using retrieved portfolio context."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import torch
from fetch_context import DEFAULT_ARTIFACT_DIR, Retriever, render_context
from transformers import AutoModelForCausalLM, AutoTokenizer


DEFAULT_MODEL = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
DEFAULT_CHATBOT_CONTEXT = Path("knowledge/huggy-chatbot-context.md")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def build_prompt(
    user_message: str,
    chatbot_context: str,
    retrieved_context: str,
) -> str:
    context_block = retrieved_context if retrieved_context else "<no relevant context found>"
    return f"""You are answering as Huggy.

CHATBOT INSTRUCTIONS:
{chatbot_context}

RETRIEVED KNOWLEDGE:
{context_block}

USER MESSAGE:
{user_message}

Answer using the retrieved knowledge and chatbot instructions.

For factual questions about Athulya, his work, his writing, his projects, or his portfolio, use the knowledge corpus as the source of truth. If a factual Athulya question is not answered by the retrieved knowledge, say that the answer is not in the current corpus.

For harmless small talk, greetings, thanks, compliments, and questions about Huggy's own UI character, answer naturally from the chatbot instructions without requiring retrieved knowledge.

If a frontend command is appropriate, output only the command."""


def load_model(model_name: str, device: str):
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    dtype = torch.float16 if device == "cuda" else torch.float32
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        dtype=dtype,
    )
    model.to(device)
    model.eval()
    return tokenizer, model


def generate_reply(
    tokenizer,
    model,
    prompt: str,
    device: str,
    max_new_tokens: int,
    temperature: float,
    top_p: float,
) -> str:
    messages = [{"role": "user", "content": prompt}]
    inputs = tokenizer.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    ).to(device)

    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=temperature,
            top_p=top_p,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )

    generated = output[0][inputs["input_ids"].shape[-1] :]
    return tokenizer.decode(generated, skip_special_tokens=True).strip()


def choose_device(requested: str) -> str:
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA was requested, but torch.cuda.is_available() is false.")
    return requested


def main() -> None:
    parser = argparse.ArgumentParser(description="Try Huggy locally with RAG context.")
    parser.add_argument("message", nargs="?", help="User message. Omit for interactive mode.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--chatbot-context", type=Path, default=DEFAULT_CHATBOT_CONTEXT)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--max-chunks", type=int, default=6)
    parser.add_argument("--score-threshold", type=float, default=0.34)
    parser.add_argument("--max-new-tokens", type=int, default=384)
    parser.add_argument("--temperature", type=float, default=0.6)
    parser.add_argument("--top-p", type=float, default=0.95)
    parser.add_argument("--show-context", action="store_true")
    parser.add_argument("--show-thinking", action="store_true")
    args = parser.parse_args()

    device = choose_device(args.device)
    chatbot_context = read_text(args.chatbot_context)
    retriever = Retriever(args.artifact_dir)
    tokenizer, model = load_model(args.model, device)

    def answer(message: str) -> str:
        results = retriever.fetch(message, args.max_chunks, args.score_threshold)
        retrieved_context = render_context(results)
        if args.show_context:
            print("\n[retrieved context]")
            print(render_context(results, include_scores=True) or "<empty>")
            print("[/retrieved context]\n")
        prompt = build_prompt(message, chatbot_context, retrieved_context)
        reply = generate_reply(
            tokenizer,
            model,
            prompt,
            device,
            args.max_new_tokens,
            args.temperature,
            args.top_p,
        )
        return reply if args.show_thinking else strip_thinking(reply)

    if args.message:
        print(answer(args.message))
        return

    print("Huggy local chat. Press Ctrl-D or Ctrl-C to exit.")
    while True:
        try:
            message = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not message:
            continue
        print(f"\nHuggy: {answer(message)}")


if __name__ == "__main__":
    main()
