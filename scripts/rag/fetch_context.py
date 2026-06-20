#!/usr/bin/env python3
"""Fetch relevant Huggy context from a FAISS index."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


DEFAULT_ARTIFACT_DIR = Path("rag_artifacts")
DEFAULT_SCORE_THRESHOLD = 0.34
DEFAULT_MAX_CHUNKS = 8
DEFAULT_SEARCH_MULTIPLIER = 4


def load_manifest(artifact_dir: Path) -> dict:
    return json.loads((artifact_dir / "manifest.json").read_text(encoding="utf-8"))


def load_chunks(artifact_dir: Path, manifest: dict) -> list[dict]:
    return json.loads((artifact_dir / manifest["chunks"]).read_text(encoding="utf-8"))


def query_embedding(model: SentenceTransformer, query: str) -> np.ndarray:
    vector = model.encode([query], normalize_embeddings=True, convert_to_numpy=True)
    return np.asarray(vector, dtype="float32")


class Retriever:
    def __init__(self, artifact_dir: Path = DEFAULT_ARTIFACT_DIR):
        self.artifact_dir = artifact_dir
        self.manifest = load_manifest(artifact_dir)
        self.chunks = load_chunks(artifact_dir, self.manifest)
        self.index = faiss.read_index(str(artifact_dir / self.manifest["index"]))
        self.model = SentenceTransformer(self.manifest["model"], device="cpu")

    def fetch(
        self,
        query: str,
        max_chunks: int = DEFAULT_MAX_CHUNKS,
        score_threshold: float = DEFAULT_SCORE_THRESHOLD,
    ) -> list[dict]:
        search_count = min(len(self.chunks), max_chunks * DEFAULT_SEARCH_MULTIPLIER)
        scores, ids = self.index.search(query_embedding(self.model, query), search_count)

        results: list[dict] = []
        seen_ids: set[str] = set()

        for score, idx in zip(scores[0], ids[0]):
            if idx < 0 or float(score) < score_threshold:
                continue
            chunk = self.chunks[int(idx)]
            if chunk["id"] in seen_ids:
                continue
            seen_ids.add(chunk["id"])
            results.append(
                {
                    "score": round(float(score), 4),
                    "id": chunk["id"],
                    "heading": chunk["heading"],
                    "text": chunk["text"],
                    "source": chunk["source"],
                    "start_line": chunk["start_line"],
                }
            )
            if len(results) >= max_chunks:
                break

        return results


def fetch(
    query: str,
    artifact_dir: Path = DEFAULT_ARTIFACT_DIR,
    max_chunks: int = DEFAULT_MAX_CHUNKS,
    score_threshold: float = DEFAULT_SCORE_THRESHOLD,
) -> list[dict]:
    return Retriever(artifact_dir).fetch(query, max_chunks, score_threshold)


def render_context(results: list[dict]) -> str:
    if not results:
        return ""

    blocks = []
    for result in results:
        blocks.append(
            "\n".join(
                [
                    f"[{result['id']}] {result['heading']} (score {result['score']})",
                    result["text"],
                ]
            )
        )
    return "\n\n---\n\n".join(blocks)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch relevant Huggy RAG context.")
    parser.add_argument("query")
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--max-chunks", type=int, default=DEFAULT_MAX_CHUNKS)
    parser.add_argument("--score-threshold", type=float, default=DEFAULT_SCORE_THRESHOLD)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    retriever = Retriever(args.artifact_dir)
    results = retriever.fetch(args.query, args.max_chunks, args.score_threshold)
    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        print(render_context(results))


if __name__ == "__main__":
    main()
