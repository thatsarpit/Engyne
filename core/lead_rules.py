from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

_TIME_RX = re.compile(r"\b\d+\s*(min|mins|minute|minutes|hour|hours|hr|hrs|day|days)\s*ago\b", re.IGNORECASE)
_MEMBER_SINCE_RX = re.compile(r"member since[^\n]*", re.IGNORECASE)
_MEMBER_MONTHS_RX = re.compile(r"member since\s+(\d+)\s*\+?\s*(month|months|year|years)", re.IGNORECASE)
_QUANTITY_RX = re.compile(r"\bQuantity\b\s*:\s*([^\n]+)", re.IGNORECASE)
_STRENGTH_RX = re.compile(r"\bStrength\b\s*:\s*([^\n]+)", re.IGNORECASE)
_PACKAGING_RX = re.compile(r"\bPackaging(?:\s*(?:Size|Type))?\b\s*:\s*([^\n]+)", re.IGNORECASE)
_INTENT_RX = re.compile(r"\bI\s+want\s+this\s+for\b\s*:\s*([^\n]+)", re.IGNORECASE)
_BUYS_RX = re.compile(r"\bBuys\b\s*:\s*([^\n]+)", re.IGNORECASE)
_REQUIREMENTS_RX = re.compile(r"\bRequirements\b\s*:\s*(\d+)", re.IGNORECASE)
_CALLS_RX = re.compile(r"\bCalls\b\s*:\s*(\d+)", re.IGNORECASE)
_REPLIES_RX = re.compile(r"\bReplies\b\s*:\s*(\d+)", re.IGNORECASE)
_RETAIL_RX = re.compile(r"\bretail\s+lead\b", re.IGNORECASE)


def normalize_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set, frozenset)):
        items = [str(v).strip().lower() for v in value if str(v).strip()]
        return [v for v in items if v]
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        return [v.strip().lower() for v in re.split(r"[,\n;]+", raw) if v.strip()]
    return [str(value).strip().lower()] if str(value).strip() else []


def normalize_method(value: str) -> str:
    v = value.strip().lower()
    if v in {"mobile", "phone", "call"}:
        return "phone"
    if v in {"email", "mail"}:
        return "email"
    if v in {"whatsapp", "wa"}:
        return "whatsapp"
    return v


def text_contains_any(text: str, keywords: list[str]) -> bool:
    haystack = text.lower()
    return any(k in haystack for k in keywords)


def normalize_keyword_text(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9 ]+", " ", value.lower())
    return " ".join(normalized.split())


def fuzzy_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def keywords_match(text: str, keywords: list[str], fuzzy_enabled: bool, fuzzy_threshold: float) -> bool:
    normalized = normalize_keyword_text(text)
    if not normalized:
        return False
    tokens = normalized.split()
    if not tokens:
        return False
    for raw in keywords:
        keyword = normalize_keyword_text(raw)
        if not keyword:
            continue
        if keyword in normalized:
            return True
        if not fuzzy_enabled:
            continue
        if len(keyword) < 4:
            continue
        keyword_tokens = keyword.split()
        if len(keyword_tokens) == 1:
            for token in tokens:
                if len(token) < 4:
                    continue
                if fuzzy_ratio(token, keyword) >= fuzzy_threshold:
                    return True
            continue
        window = len(keyword_tokens)
        if window > len(tokens):
            if fuzzy_ratio(normalized, keyword) >= fuzzy_threshold:
                return True
            continue
        for idx in range(len(tokens) - window + 1):
            window_text = " ".join(tokens[idx : idx + window])
            if fuzzy_ratio(window_text, keyword) >= fuzzy_threshold:
                return True
    return False


def normalize_country_value(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9 ]+", " ", value.lower())
    return " ".join(normalized.split())


def country_matches(value: str, terms: list[str]) -> bool:
    normalized = normalize_country_value(value)
    if not normalized:
        return False
    tokens = {t for t in normalized.split() if t}
    aliases = {
        "us": ["usa", "united states", "united states of america"],
        "usa": ["united states", "united states of america"],
        "uk": ["united kingdom"],
        "aus": ["australia"],
    }
    for raw in terms:
        term = normalize_country_value(raw)
        if not term:
            continue
        if len(term) <= 3:
            if term in tokens:
                return True
        else:
            if term in normalized:
                return True
        if term in aliases:
            for alias in aliases[term]:
                alias_norm = normalize_country_value(alias)
                if alias_norm and alias_norm in normalized:
                    return True
    return False


def extract_time_text(text: str | None) -> str | None:
    if not text:
        return None
    match = _TIME_RX.search(text)
    return match.group(0).strip() if match else None


def parse_age_hours(raw: str | None) -> float | None:
    if not raw:
        return None
    text = raw.lower()
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    if not match:
        return None
    value = float(match.group(1))
    if "min" in text:
        return value / 60.0
    if "hour" in text or "hr" in text:
        return value
    if "day" in text:
        return value * 24.0
    return None


def extract_member_since_text(text: str | None) -> str | None:
    if not text:
        return None
    match = _MEMBER_SINCE_RX.search(text)
    return match.group(0).strip() if match else None


def parse_member_months(raw: str | None) -> int | None:
    if not raw:
        return None
    match = _MEMBER_MONTHS_RX.search(raw)
    if not match:
        return None
    try:
        value = int(match.group(1))
    except Exception:
        return None
    unit = match.group(2).lower()
    if "year" in unit:
        return value * 12
    return value


def _extract_match(rx: re.Pattern[str], text: str) -> str | None:
    match = rx.search(text)
    if not match:
        return None
    return match.group(1).strip()


def _extract_int(rx: re.Pattern[str], text: str) -> int | None:
    match = rx.search(text)
    if not match:
        return None
    try:
        return int(match.group(1))
    except Exception:
        return None


def extract_structured_fields(text: str | None) -> dict[str, Any]:
    if not text:
        return {}
    payload: dict[str, Any] = {
        "quantity_text": _extract_match(_QUANTITY_RX, text),
        "strength_text": _extract_match(_STRENGTH_RX, text),
        "packaging_text": _extract_match(_PACKAGING_RX, text),
        "intent_text": _extract_match(_INTENT_RX, text),
        "buys_text": _extract_match(_BUYS_RX, text),
        "engagement_requirements": _extract_int(_REQUIREMENTS_RX, text),
        "engagement_calls": _extract_int(_CALLS_RX, text),
        "engagement_replies": _extract_int(_REPLIES_RX, text),
        "retail_hint": bool(_RETAIL_RX.search(text)),
    }
    return payload
