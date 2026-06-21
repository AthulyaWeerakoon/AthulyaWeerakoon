"""Helpers for preserving provider rate-limit headers."""

from __future__ import annotations

RATE_LIMIT_HEADER_PREFIX = "x-ratelimit-"
RATE_LIMIT_HEADER_EXACT = {"retry-after"}


def header_value(headers, name: str) -> str:
    if not headers or not hasattr(headers, "get"):
        return ""
    return headers.get(name, "") or headers.get(name.lower(), "") or headers.get(name.title(), "")


def iter_header_items(headers):
    if not headers or not hasattr(headers, "items"):
        return []
    return headers.items()


def rate_limit_headers(headers) -> dict[str, str]:
    values: dict[str, str] = {}
    for name, value in iter_header_items(headers):
        header_name = str(name).lower()
        if header_name in RATE_LIMIT_HEADER_EXACT or header_name.startswith(RATE_LIMIT_HEADER_PREFIX):
            values[header_name] = str(value)

    for name in RATE_LIMIT_HEADER_EXACT:
        if name not in values and (value := header_value(headers, name)):
            values[name] = value

    return values


def normalize_rate_limit_headers(headers: dict[str, str]) -> dict[str, str]:
    return {name.replace("-", "_"): value for name, value in headers.items()}


def rate_limit_payload(headers, *, provider: str, status_code: int | None = None) -> dict:
    raw_headers = rate_limit_headers(headers)
    return {
        "provider": provider,
        "status_code": status_code,
        "headers": raw_headers,
        **normalize_rate_limit_headers(raw_headers),
    }
