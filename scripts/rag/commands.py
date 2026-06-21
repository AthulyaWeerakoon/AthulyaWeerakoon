"""Deterministic frontend command matching for Huggy."""

from __future__ import annotations

import re


SECTION_ALIASES = {
    "about": ["about", "intro", "introduction", "profile"],
    "articles": ["articles", "article", "blog", "blogs", "writing", "writings"],
    "projects": ["projects", "project", "portfolio work"],
    "experience": ["experience", "experiences", "work experience", "career", "jobs", "internship"],
    "skills": ["skills", "skill", "tech stack", "technologies", "tools"],
    "education": ["education", "educational", "degree", "university", "studies"],
}

PUBLIC_LINKS = {
    "github": "https://github.com/AthulyaWeerakoon",
    "linkedin": "https://linkedin.com/in/athulya-weerakoon",
    "medium": "https://medium.com/@athulyaweerakoon",
    "wattpad": "https://www.wattpad.com/user/AtleeBugs",
    "atleebugs": "https://www.wattpad.com/user/AtleeBugs",
    "portfolio": "https://athulyaweerakoon.xyz",
    "website": "https://athulyaweerakoon.xyz",
    "triagon": "https://www.wattpad.com/myworks/352689078-triagon-origins",
    "triagon origins": "https://www.wattpad.com/myworks/352689078-triagon-origins",
    "hall of ivory": "https://www.wattpad.com/myworks/394332711-the-hall-of-ivory",
    "a hundred years": "https://www.wattpad.com/myworks/408067856-a-hundred-years",
}

NAVIGATION_INTENTS = [
    "can i see",
    "show",
    "take me",
    "go",
    "navigate",
    "open",
    "view",
    "jump",
    "scroll",
]


def normalize_text(text: str) -> str:
    lowered = text.lower()
    lowered = re.sub(r"[^a-z0-9\s:/._-]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def looks_like_navigation_request(message: str) -> bool:
    normalized = normalize_text(message)
    return any(re.search(rf"\b{re.escape(intent)}\b", normalized) for intent in NAVIGATION_INTENTS)


def match_navigation_command(message: str) -> str | None:
    normalized = normalize_text(message)
    if not looks_like_navigation_request(normalized):
        return None

    for section, aliases in SECTION_ALIASES.items():
        if any(re.search(rf"\b{re.escape(alias)}\b", normalized) for alias in aliases):
            return f"/navigate {section}"
    return None


def match_open_link_command(message: str) -> str | None:
    normalized = normalize_text(message)

    match = re.search(r"https?://[^\s]+", message)
    if match and ("open" in normalized or "go to" in normalized or "visit" in normalized):
        return f"/open-link {match.group(0)}"

    if any(intent in normalized for intent in ["open", "go to", "visit", "take me"]):
        for alias, url in PUBLIC_LINKS.items():
            if re.search(rf"\b{re.escape(alias)}\b", normalized):
                return f"/open-link {url}"

    return None


def match_frontend_command(message: str) -> str | None:
    return match_open_link_command(message) or match_navigation_command(message)
