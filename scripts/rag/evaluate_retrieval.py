#!/usr/bin/env python3
"""Run relevance checks for Huggy's retrieval index."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from commands import match_frontend_command
from fetch_context import DEFAULT_ARTIFACT_DIR, Retriever


@dataclass(frozen=True)
class RetrievalCase:
    query: str
    required: tuple[str, ...] = ()
    forbidden: tuple[str, ...] = ()
    expected_command: str | None = None
    expect_empty: bool = False


def cases_for(required: tuple[str, ...], queries: list[str]) -> list[RetrievalCase]:
    return [RetrievalCase(query=query, required=required) for query in queries]


CASES: list[RetrievalCase] = []

CASES += cases_for(
    ("Experience", "WSO2", "Virtual System Solutions"),
    [
        "what experience does athulya have?",
        "tell me about Athulya's work experience",
        "where has Athulya worked?",
        "what professional experience does Athulya have?",
        "summarize his career experience",
        "what jobs has Athulya had?",
        "what internship experience does Athulya have?",
        "does Athulya have DevOps experience?",
        "what did Athulya do professionally?",
        "what companies has Athulya worked with?",
        "what is Athulya doing at Virtual System Solutions?",
        "what did Athulya do at WSO2?",
    ],
)

CASES += cases_for(
    ("Teaching And Tutoring", "Computer Architecture", "MIPS"),
    [
        "did Athulya tutor anyone?",
        "what did Athulya teach in university?",
        "tell me about Athulya's tutoring recordings",
        "what was Athulya's computer architecture tutoring about?",
        "did Athulya explain MIPS pipelining?",
        "what teaching experience does Athulya have?",
    ],
)

CASES += cases_for(
    ("WSO2", "Financial Services Accelerator"),
    [
        "what did Athulya do at WSO2?",
        "describe Athulya's WSO2 internship",
        "what was Athulya's WSO2 work about?",
        "did Athulya work on Open Banking?",
        "what did he do in the Financial Services Accelerator?",
        "what tests did Athulya write at WSO2?",
        "what did Athulya do with NextGenPSD2?",
        "what was his internship period at WSO2?",
        "what did Athulya do with OBIE?",
        "what did Athulya do with the Berlin Open Banking framework?",
        "what did he notice about multi-step authorization?",
        "did Athulya work on SCA account selection?",
        "what did Athulya do with Choreo at WSO2?",
        "what was the old Java class extension model?",
        "what were the API-based extension points at WSO2?",
        "did Athulya work on accelerator localization?",
    ],
)

CASES += cases_for(
    ("DevOps Engineer", "Virtual System Solutions"),
    [
        "what does Athulya do as a DevOps engineer?",
        "tell me about his Virtual System Solutions work",
        "what DevOps work has Athulya done?",
        "does Athulya have deployment automation experience?",
        "what has Athulya done with observability?",
        "what identity access management work has he done?",
        "what secure handshake work did Athulya design?",
        "what backup automation work did he do?",
        "what is ANT at Virtual System Solutions?",
        "what role does Athulya have at VSS?",
        "is Athulya involved in solution engineering?",
        "what kind of customer products did Athulya work on at VSS?",
    ],
)

CASES += cases_for(
    ("Education", "University of Jaffna", "GPA"),
    [
        "what is Athulya's education?",
        "where did Athulya study?",
        "what degree does Athulya have?",
        "what was Athulya's GPA?",
        "did Athulya graduate with honours?",
        "what university did he attend?",
        "what certification does Athulya have?",
        "was Athulya active in university societies?",
    ],
)

CASES += cases_for(
    ("Skills",),
    [
        "what skills does Athulya have?",
        "what is Athulya's tech stack?",
        "what are Athulya's cloud and DevOps skills?",
        "what security skills does Athulya have?",
        "what backend technologies does he know?",
        "does Athulya know Docker?",
        "does Athulya know Rust?",
        "what AI skills does Athulya have?",
        "what embedded systems skills does he have?",
        "what VLSI skills does Athulya have?",
        "how strong is Athulya in Java?",
        "does Athulya know WSO2 Carbon?",
        "how good is Athulya with Python?",
        "does Athulya know C++?",
        "why does Athulya know Go?",
        "where did Athulya use Laravel?",
    ],
)

CASES += cases_for(
    ("Programming Languages And Frameworks", "Java", "Python", "C++"),
    [
        "what programming languages is Athulya familiar with?",
        "what languages is he familiar with?",
        "what coding languages does Athulya know?",
        "does Athulya know programming languages?",
        "what are Athulya's strongest languages?",
    ],
)

CASES += cases_for(
    ("Network and API security",),
    [
        "what security qualifications does Athulya have?",
        "does Athulya understand FAPI?",
        "does Athulya know mTLS?",
        "does Athulya understand RBAC scopes and permissions?",
        "does Athulya know MFA CIBA SSO and SCIM?",
        "does Athulya know JWT validation with JWKS?",
        "does Athulya have server hardening experience?",
        "does Athulya know nmap and Nessus?",
        "what ethical hacking exposure does Athulya have?",
    ],
)

CASES += [
    RetrievalCase("what IAM experience does Athulya have?", required=("Identity and Access Management",)),
]

CASES += cases_for(
    ("AI And Research Background",),
    [
        "what is Athulya's AI background?",
        "what does Athulya think about AI?",
        "what did Athulya do with LoRA and QLoRA?",
        "does Athulya like small models?",
        "what was his Sinhala RAG work?",
        "what did Athulya learn from show and tell?",
    ],
)

CASES += cases_for(
    ("AI And Research Background", "KAN"),
    [
        "what AI research did Athulya do?",
        "what was Athulya's undergraduate research about?",
        "did Athulya work with KANs?",
        "what did Athulya do with LPC and ANS?",
    ],
)

CASES += cases_for(
    ("Project Highlights", "Summary:"),
    [
        "what projects has Athulya built?",
        "tell me about Athulya's projects",
        "what are Athulya's project highlights?",
        "show me examples of Athulya's work",
        "what GitHub projects does Athulya have?",
    ],
)

CASES += cases_for(
    ("Exam Registration Portal",),
    [
        "tell me about the exam registration portal",
        "what is ExamRegistrationUoJ?",
        "what project used ASP.NET and Blazor?",
        "what project had GitHub Actions CI/CD?",
        "what university system did Athulya build?",
    ],
)

CASES += cases_for(
    ("Rustic Log Furnace",),
    [
        "what is Rustic Log Furnace?",
        "tell me about his Rust log processor",
        "what Rust project did Athulya build?",
        "what project used pipelined processing?",
        "does Athulya have a log processing project?",
    ],
)

CASES += cases_for(
    ("Sri Lankan Constitution Chatbot",),
    [
        "what is the Sinhala Constitution chatbot?",
        "what RAG chatbot did Athulya build?",
        "what project used QLoRA?",
        "what Sinhala language AI project does he have?",
        "what constitutional knowledge project did he build?",
    ],
)

CASES += cases_for(
    ("Flappy Bird On FPGA",),
    [
        "what FPGA project has Athulya done?",
        "tell me about Flappy Bird on FPGA",
        "what Verilog game did Athulya build?",
        "what project used VGA output?",
        "did Athulya build anything on DE2-115?",
    ],
)

CASES += cases_for(
    ("Writing", "Current Medium articles"),
    [
        "what has Athulya written on Medium?",
        "what Medium articles does Athulya have?",
        "list Athulya's writing",
        "what has he written?",
        "what blog posts has Athulya written?",
        "what articles are on Athulya's Medium?",
        "does Athulya write about web hosting?",
        "what is the forever-free chatbot article about?",
        "what did Athulya write about Huggy?",
    ],
)

CASES += cases_for(
    ("Creative Writing",),
    [
        "what does Athulya write about?",
    ],
)

CASES += cases_for(
    ("Writing", "A Forever-Free Chatbot for Your Portfolio", "free-tier limits"),
    [
        "what article is about a portfolio chatbot?",
        "what article covers Huggy and free-tier limits?",
        "which article talks about avoiding surprise cloud bills?",
        "what writing covers Cloudflare and Groq?",
    ],
)

CASES += cases_for(
    ("Why Every Developer Should Learn Rust", "engineering discipline"),
    [
        "what article talks about Rust engineering discipline?",
        "what is Athulya's Rust article about?",
        "which article is about explicit contracts?",
        "what writing covers ownership and mutability?",
        "is the Rust article really about Rust?",
    ],
)

CASES += cases_for(
    ("Portfolio Page Mechanics", "particle"),
    [
        "how does the portfolio weather button work?",
        "how does the rain in this page work?",
        "what script controls the rain effect?",
        "how does the snow theme work?",
        "what controls the portfolio particles?",
    ],
)

CASES += cases_for(
    ("Portfolio Page Mechanics",),
    [
        "how does the portfolio recolor background images?",
        "what is the sepia hue rotate trick?",
        "did Athulya write the portfolio mechanics himself?",
    ],
)

CASES += cases_for(
    ("Creative Writing", "Wattpad"),
    [
        "what does Athulya write on Wattpad?",
        "what stories has Athulya published?",
        "tell me about Triagon Origins",
        "what is Hall of Ivory?",
        "what is A Hundred Years about?",
        "which story does Athulya want to be known for?",
        "what was Athulya's ONC entry?",
        "what is Athulya rewriting for the Wattys?",
        "who is Jasmine in Athulya's writing?",
        "who is Turren?",
    ],
)

CASES += cases_for(
    ("Contact And Public Links",),
    [
        "what is Athulya's Medium link?",
        "what is his GitHub link?",
        "where is Athulya's LinkedIn?",
        "what is his Wattpad link?",
        "how can I contact Athulya publicly?",
    ],
)

CASES += [
    RetrievalCase("show me his experience", expected_command="/navigate experience"),
    RetrievalCase("can I see Athulya's experience", expected_command="/navigate experience"),
    RetrievalCase("show me skills", expected_command="/navigate skills"),
    RetrievalCase("open the projects section", expected_command="/navigate projects"),
    RetrievalCase("show me articles", expected_command="/navigate articles"),
    RetrievalCase("take me to Athulya's Medium", expected_command="/open-link https://medium.com/@athulyaweerakoon"),
    RetrievalCase("open his Wattpad", expected_command="/open-link https://www.wattpad.com/user/AtleeBugs"),
    RetrievalCase("open Triagon Origins", expected_command="/open-link https://www.wattpad.com/myworks/352689078-triagon-origins"),
    RetrievalCase("open Hall of Ivory", expected_command="/open-link https://www.wattpad.com/myworks/394332711-the-hall-of-ivory"),
    RetrievalCase("open A Hundred Years", expected_command="/open-link https://www.wattpad.com/myworks/408067856-a-hundred-years"),
    RetrievalCase("visit https://example.com", expected_command="/open-link https://example.com"),
    RetrievalCase(
        "what about this? I worked on Open Banking at WSO2 and also wrote about MIPS processor architecture and pipeline registers during university tutoring",
        required=("Teaching And Tutoring", "WSO2"),
    ),
]

CASES += [
    RetrievalCase("what is his phone number?", expect_empty=True),
    RetrievalCase("what is Athulya's salary?", expect_empty=True),
    RetrievalCase("what is his home address?", expect_empty=True),
    RetrievalCase("what is his private life like?", expect_empty=True),
]


def result_text(results: list[dict]) -> str:
    return "\n".join(f"{result['heading']}\n{result['text']}" for result in results)


def check_case(case: RetrievalCase, retriever: Retriever, max_chunks: int, score_threshold: float) -> tuple[bool, list[dict], str | None]:
    command = match_frontend_command(case.query)
    if case.expected_command is not None:
        return command == case.expected_command, [], command
    if command is not None:
        return False, [], command

    results = retriever.fetch(case.query, max_chunks, score_threshold)
    text = result_text(results)
    if case.expect_empty:
        return not results, results, None

    has_required = all(required.lower() in text.lower() for required in case.required)
    has_forbidden = any(forbidden.lower() in text.lower() for forbidden in case.forbidden)
    return has_required and not has_forbidden, results, None


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Huggy retrieval quality.")
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--max-chunks", type=int, default=6)
    parser.add_argument("--score-threshold", type=float, default=0.34)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    retriever = Retriever(args.artifact_dir)
    failed = []

    for index, case in enumerate(CASES, start=1):
        ok, results, command = check_case(case, retriever, args.max_chunks, args.score_threshold)
        if ok and not args.verbose:
            continue

        print(f"\n[{index:03d}] QUERY: {case.query}")
        print(f"PASS: {ok}")
        if case.expected_command is not None:
            print(f"COMMAND: {command}")
            print(f"EXPECTED: {case.expected_command}")
        elif not results:
            print("RESULTS: <empty>")
        else:
            for result in results:
                print(f"- {result['score']:.4f} | {result['heading']} | {result['id']}")

        if not ok:
            failed.append(case)

    passed = len(CASES) - len(failed)
    print(f"\nPassed {passed}/{len(CASES)} checks")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
