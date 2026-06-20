#!/usr/bin/env python3
"""Run quick relevance checks for Huggy's retrieval index."""

from __future__ import annotations

import argparse
from pathlib import Path

from fetch_context import DEFAULT_ARTIFACT_DIR, Retriever


TESTS = [
    ("What did Athulya do at WSO2?", ["WSO2", "Financial Services Accelerator"]),
    ("Tell me about the exam registration portal", ["Exam Registration Portal"]),
    ("What is Rustic Log Furnace?", ["Rustic Log Furnace"]),
    ("Open the projects section", ["Chatbot Frontend Commands"]),
    ("What article talks about Rust engineering discipline?", ["Why Every Developer Should Learn Rust"]),
    ("What are Athulya's cloud and DevOps skills?", ["Skills"]),
    ("How does the portfolio weather button work?", ["Portfolio Page Mechanics"]),
    ("What is his Wattpad link?", ["Contact And Public Links", "Chatbot Frontend Commands"]),
    ("What is his phone number?", []),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Huggy retrieval quality.")
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--max-chunks", type=int, default=5)
    parser.add_argument("--score-threshold", type=float, default=0.34)
    args = parser.parse_args()

    retriever = Retriever(args.artifact_dir)
    passed = 0
    for query, expected_headings in TESTS:
        results = retriever.fetch(query, args.max_chunks, args.score_threshold)
        headings = [result["heading"] for result in results]
        matched = not expected_headings or any(
            expected in heading for expected in expected_headings for heading in headings
        )
        empty_ok = expected_headings or not results
        ok = matched if expected_headings else empty_ok
        passed += int(ok)

        print(f"\nQUERY: {query}")
        print(f"PASS: {ok}")
        if not results:
            print("RESULTS: <empty>")
            continue
        for result in results:
            print(f"- {result['score']:.4f} | {result['heading']} | {result['id']}")

    print(f"\nPassed {passed}/{len(TESTS)} checks")


if __name__ == "__main__":
    main()
