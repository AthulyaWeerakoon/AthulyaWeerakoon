#!/usr/bin/env python3
"""Fetch relevant Huggy context from a FAISS index."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
from pathlib import Path

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


DEFAULT_ARTIFACT_DIR = Path("rag_artifacts")
DEFAULT_SCORE_THRESHOLD = 0.34
DEFAULT_MAX_CHUNKS = 8
DEFAULT_SEARCH_MULTIPLIER = 4


def env_truthy(name: str) -> bool:
    return os.environ.get(name, "").lower() in {"1", "true", "yes", "on"}


def load_manifest(artifact_dir: Path) -> dict:
    return json.loads((artifact_dir / "manifest.json").read_text(encoding="utf-8"))


def load_chunks(artifact_dir: Path, manifest: dict) -> list[dict]:
    return json.loads((artifact_dir / manifest["chunks"]).read_text(encoding="utf-8"))


def query_embedding(model: SentenceTransformer, query: str) -> np.ndarray:
    vector = model.encode([query], normalize_embeddings=True, convert_to_numpy=True)
    return np.asarray(vector, dtype="float32")


def retrieval_query(query: str) -> str:
    normalized = query.lower()
    if is_writing_query(normalized):
        return (
            f"{query}\n"
            "Writing Medium articles Current Medium articles article titles summaries URLs"
        )
    return query


def is_private_query(query: str) -> bool:
    tokens = set(re.findall(r"[a-z0-9]+", query.lower()))
    return bool(tokens & {"phone", "salary", "address", "private", "girlfriend", "boyfriend", "home"})


def is_writing_query(query: str) -> bool:
    normalized = query.lower()
    tokens = set(re.findall(r"[a-z0-9]+", normalized))
    if tokens & {"medium", "article", "articles", "blog", "blogs", "write", "writes", "wrote", "writing", "written"}:
        return True
    if any(
        phrase in normalized
        for phrase in {
            "forever free chatbot",
            "forever-free chatbot",
            "portfolio chatbot",
            "huggy article",
            "free tier chatbot",
            "free-tier chatbot",
        }
    ):
        return True
    return "what has" in normalized and "written" in normalized


def is_tiny_work_followup(query: str) -> bool:
    normalized = query.lower()
    return bool(
        re.search(r"current user message:\s*(what\s+)?(work|his work|what work)\??\s*$", normalized)
        or re.search(r"\bwhat\s+work\??\s*$", normalized)
    )


PINNED_SECTION_RULES = [
    (
        "experience",
        ["experience", "work history", "work experience", "professional work", "what work", "his work", "job", "jobs", "career", "internship", "professional", "wso2", "virtual system solutions", "open banking", "nextgenpsd2", "financial services accelerator", "obie", "berlin", "strong customer authentication", "sca", "choreo", "extension model", "extension points", "identity access management", "secure handshake", "backup automation", "ant"],
        "Experience",
        ["Experience summary:", "Athulya contributed", "battle-test", "Athulya contributes", "Worked on ANT"],
    ),
    (
        "tutoring",
        ["tutor", "tutoring", "teaching", "recording", "computer architecture", "mips", "pipelining", "pipeline registers"],
        "Teaching And Tutoring",
        ["Tutoring summary:"],
    ),
    (
        "education",
        ["education", "degree", "university", "study", "studied", "gpa", "honours", "honors", "graduated", "certification"],
        "Education",
        ["Degree:", "Institution:", "GPA:"],
    ),
    (
        "skills",
        ["skills", "skill", "tech stack", "technologies", "tools", "devops", "cloud", "security", "java", "python", "carbon", "osgi", "dotnet", ".net", "c++", "go", "laravel", "rust", "maui", "blazor", "server hardening"],
        "Skills",
        ["Backend and platform:", "Cloud and DevOps:", "Network and API security:"],
    ),
    (
        "security",
        ["security", "iam", "identity", "rbac", "oauth", "fapi", "mtls", "jwt", "jwks", "introspection", "mfa", "ciba", "sso", "scim", "xacml", "ldap", "radius", "nmap", "nessus", "metasploit", "cve", "server hardening"],
        "Skills",
        ["Network and API security:"],
    ),
    (
        "ai",
        ["ai", "machine learning", "deep learning", "computer vision", "rag", "embedding", "transformers", "lora", "qlora", "kan", "kolmogorov", "time series", "lpc", "ans", "precision agriculture", "show and tell", "small models"],
        "AI And Research Background",
        ["AI background summary:"],
    ),
    (
        "projects",
        ["projects", "project", "built", "portfolio work", "examples of", "github repositories", "university system", "asp.net", "blazor", "qlora", "sinhala", "constitution", "fpga", "verilog", "de2", "vga", "github actions", "ci/cd"],
        "Project Highlights",
        ["Project summary:"],
    ),
    (
        "contact",
        ["github link", "linkedin", "wattpad", "contact", "public links"],
        "Contact And Public Links",
        ["GitHub:", "LinkedIn:", "Wattpad:"],
    ),
    (
        "portfolio",
        ["weather", "rain", "snow", "particles", "particle", "portfolio page", "adventurer", "aos", "sepia", "hue rotate", "hue-rotate", "background color"],
        "Portfolio Page Mechanics",
        ["particle-control.js", "Weather buttons", "adventurer"],
    ),
    (
        "creative-writing",
        ["wattpad", "fiction", "story", "stories", "triagon", "hall of ivory", "a hundred years", "onc", "wattys", "jasmine", "turren"],
        "Creative Writing",
        ["Creative writing summary:"],
    ),
]


def pinned_chunks_for_query(query: str, chunks: list[dict]) -> list[dict]:
    normalized = query.lower()
    tiny_work_followup = is_tiny_work_followup(query)
    pins: list[dict] = []

    if is_writing_query(normalized):
        pins.extend(
            chunk
            for chunk in chunks
            if chunk["heading"].endswith("> Writing") and "Current Medium articles" in chunk["text"]
        )

    for _name, triggers, heading_suffix, required_texts in PINNED_SECTION_RULES:
        if tiny_work_followup and _name not in {"experience", "projects"}:
            continue
        if not any(trigger in normalized for trigger in triggers):
            continue
        pins.extend(
            chunk
            for chunk in chunks
            if f"> {heading_suffix}" in chunk["heading"]
            and any(required in chunk["text"] for required in required_texts)
        )

    unique_pins = []
    seen_ids: set[str] = set()
    for chunk in pins:
        if chunk["id"] in seen_ids:
            continue
        seen_ids.add(chunk["id"])
        unique_pins.append(chunk)
    return unique_pins


@contextlib.contextmanager
def maybe_suppress_output(verbose: bool):
    if verbose:
        yield
        return

    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        yield


class Retriever:
    def __init__(
        self,
        artifact_dir: Path = DEFAULT_ARTIFACT_DIR,
        verbose: bool = False,
        local_files_only: bool | None = None,
    ):
        self.artifact_dir = artifact_dir
        self.manifest = load_manifest(artifact_dir)
        self.chunks = load_chunks(artifact_dir, self.manifest)
        self.index = faiss.read_index(str(artifact_dir / self.manifest["index"]))
        if local_files_only is None:
            local_files_only = env_truthy("RAG_LOCAL_FILES_ONLY")
        with maybe_suppress_output(verbose):
            self.model = SentenceTransformer(
                self.manifest["model"],
                device="cpu",
                local_files_only=local_files_only,
            )

    def fetch(
        self,
        query: str,
        max_chunks: int = DEFAULT_MAX_CHUNKS,
        score_threshold: float = DEFAULT_SCORE_THRESHOLD,
    ) -> list[dict]:
        if is_private_query(query):
            return []

        search_count = min(len(self.chunks), max_chunks * DEFAULT_SEARCH_MULTIPLIER)
        scores, ids = self.index.search(
            query_embedding(self.model, retrieval_query(query)),
            search_count,
        )

        results: list[dict] = []
        seen_ids: set[str] = set()

        for chunk in pinned_chunks_for_query(query, self.chunks):
            seen_ids.add(chunk["id"])
            results.append(
                {
                    "score": 1.0,
                    "id": chunk["id"],
                    "heading": chunk["heading"],
                    "text": chunk["text"],
                    "source": chunk["source"],
                    "start_line": chunk["start_line"],
                }
            )

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


def render_context(results: list[dict], include_scores: bool = False) -> str:
    if not results:
        return ""

    blocks = []
    for result in results:
        title = f"[{result['id']}] {result['heading']}"
        if include_scores:
            title = f"{title} (score {result['score']})"
        blocks.append(
            "\n".join(
                [
                    title,
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
    parser.add_argument("--include-scores", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--local-files-only", action="store_true")
    args = parser.parse_args()

    retriever = Retriever(
        args.artifact_dir,
        verbose=args.verbose,
        local_files_only=args.local_files_only or None,
    )
    results = retriever.fetch(args.query, args.max_chunks, args.score_threshold)
    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        print(render_context(results, include_scores=args.include_scores))


if __name__ == "__main__":
    main()
