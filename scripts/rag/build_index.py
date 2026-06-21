#!/usr/bin/env python3
"""Build a FAISS retrieval index for Huggy's knowledge corpus."""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_SOURCE = Path("knowledge/athulya-knowledge-corpus.md")
DEFAULT_OUT_DIR = Path("rag_artifacts")
MAX_CHUNK_WORDS = 140
MIN_CHUNK_WORDS = 8
OVERLAP_WORDS = 22
SKIP_TOP_LEVEL_SECTIONS = {"Future Additions"}


def env_truthy(name: str) -> bool:
    return os.environ.get(name, "").lower() in {"1", "true", "yes", "on"}


@dataclass
class RawBlock:
    heading_path: list[str]
    text: str
    start_line: int


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def markdown_blocks(path: Path) -> list[RawBlock]:
    lines = path.read_text(encoding="utf-8").splitlines()
    headings: list[str] = []
    blocks: list[RawBlock] = []
    buffer: list[str] = []
    block_start = 1
    in_fence = False

    def flush() -> None:
        nonlocal buffer, block_start
        text = "\n".join(buffer).strip()
        buffer = []
        if not text or not headings:
            return
        if any(heading in SKIP_TOP_LEVEL_SECTIONS for heading in headings):
            return
        normalized = normalize_space(text)
        if normalized:
            blocks.append(RawBlock(headings.copy(), normalized, block_start))

    for line_number, line in enumerate(lines, start=1):
        stripped = line.strip()

        if stripped.startswith("```"):
            in_fence = not in_fence
            if not buffer:
                block_start = line_number
            buffer.append(stripped)
            continue

        if not in_fence:
            match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
            if match:
                flush()
                level = len(match.group(1))
                title = match.group(2).strip()
                headings = headings[: level - 1]
                headings.append(title)
                block_start = line_number + 1
                continue

        if stripped:
            if not buffer:
                block_start = line_number
            buffer.append(stripped)
        else:
            flush()
            block_start = line_number + 1

    flush()
    return blocks


def split_words(text: str, max_words: int, overlap_words: int) -> list[str]:
    words = text.split()
    if len(words) <= max_words:
        return [text]

    chunks: list[str] = []
    start = 0
    step = max_words - overlap_words

    while start < len(words):
        end = min(start + max_words, len(words))
        chunk = " ".join(words[start:end]).strip()
        if len(chunk.split()) >= MIN_CHUNK_WORDS:
            chunks.append(chunk)
        if end == len(words):
            break
        start += step

    return chunks


def build_chunks(blocks: list[RawBlock], source: Path) -> list[dict]:
    chunks: list[dict] = []

    for block in blocks:
        for part_index, text in enumerate(split_words(block.text, MAX_CHUNK_WORDS, OVERLAP_WORDS)):
            heading_path = " > ".join(block.heading_path)
            embedding_text = f"{heading_path}\n\n{text}"
            chunks.append(
                {
                    "id": f"chunk-{len(chunks):04d}",
                    "heading_path": block.heading_path,
                    "heading": heading_path,
                    "text": text,
                    "embedding_text": embedding_text,
                    "source": str(source),
                    "start_line": block.start_line,
                    "part": part_index,
                    "word_count": len(text.split()),
                }
            )

    return chunks


def encode(
    model_name: str,
    texts: list[str],
    batch_size: int,
    local_files_only: bool = False,
) -> np.ndarray:
    model = SentenceTransformer(model_name, device="cpu", local_files_only=local_files_only)
    vectors = model.encode(
        texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    return np.asarray(vectors, dtype="float32")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Huggy FAISS retrieval artifacts.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--local-files-only", action="store_true")
    args = parser.parse_args()

    blocks = markdown_blocks(args.source)
    chunks = build_chunks(blocks, args.source)
    if not chunks:
        raise SystemExit("No chunks generated.")

    vectors = encode(
        args.model,
        [chunk["embedding_text"] for chunk in chunks],
        args.batch_size,
        local_files_only=args.local_files_only or env_truthy("RAG_LOCAL_FILES_ONLY"),
    )
    index = faiss.IndexFlatIP(vectors.shape[1])
    index.add(vectors)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(args.out_dir / "knowledge.faiss"))

    public_chunks = []
    for chunk in chunks:
        public_chunk = dict(chunk)
        public_chunk.pop("embedding_text", None)
        public_chunks.append(public_chunk)

    (args.out_dir / "chunks.json").write_text(
        json.dumps(public_chunks, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model": args.model,
        "source": str(args.source),
        "index": "knowledge.faiss",
        "chunks": "chunks.json",
        "metric": "cosine_similarity_via_normalized_inner_product",
        "chunk_count": len(chunks),
        "vector_dim": int(vectors.shape[1]),
        "chunking": {
            "max_chunk_words": MAX_CHUNK_WORDS,
            "overlap_words": OVERLAP_WORDS,
            "heading_path_in_embedding_text": True,
            "heading_path_in_stored_text": False,
            "skipped_top_level_sections": sorted(SKIP_TOP_LEVEL_SECTIONS),
        },
    }
    (args.out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"Built {len(chunks)} chunks")
    print(f"Wrote {args.out_dir / 'knowledge.faiss'}")
    print(f"Wrote {args.out_dir / 'chunks.json'}")
    print(f"Wrote {args.out_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()
