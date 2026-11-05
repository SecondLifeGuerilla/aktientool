"""Quellenbasierte, redaktionelle Zukunftseinordnung; unabhängig von Finanzscores.

Keine Branchenheuristik: nur explizite Ticker/ISIN-Zuordnungen. Der kleine Katalog
wird bei jedem Aufruf gelesen, damit Korrekturen ohne Cache-Reset wirksam werden.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
from pathlib import Path
from urllib.parse import urlsplit

CATALOG_FILE = Path(__file__).with_name("outlook.json")
REVIEW_DAYS = 90
LEVELS = {"low", "medium", "high", "unknown"}
DIMENSIONS = {"cost", "revenue", "business", "moat", "execution"}
log = logging.getLogger(__name__)


def _text(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Leerer oder ungültiger Text im Zukunftskatalog")


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Datum muss YYYY-MM-DD sein")
    return dt.date.fromisoformat(value)


def validate(catalog: dict) -> None:
    """Prüft Belege, Identität und Datumsangaben vor der Veröffentlichung."""
    if catalog["version"] != 1 or not isinstance(catalog["profiles"], list):
        raise ValueError("Unbekanntes Katalogformat")
    symbols, isins = set(), set()
    for p in catalog["profiles"]:
        for key in ("name", "theme", "summary", "short_term", "long_term", "uncertainty"):
            _text(p[key])
        reviewed = _date(p["reviewed_at"])
        for field, seen, pattern in (("symbols", symbols, r"[A-Z0-9.\-^=]{1,20}"),
                                     ("isins", isins, r"[A-Z]{2}[A-Z0-9]{9}\d")):
            if not p[field]:
                raise ValueError("Unternehmen braucht Ticker und ISIN")
            for value in p[field]:
                if not isinstance(value, str) or not re.fullmatch(pattern, value) or value in seen:
                    raise ValueError("Ungültige oder doppelte Unternehmenszuordnung")
                seen.add(value)
        sources = set()
        for s in p["sources"]:
            for key in ("id", "title", "publisher", "url"):
                _text(s[key])
            url = urlsplit(s["url"])
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError("Quellen brauchen eine öffentliche HTTPS-Adresse")
            if s["id"] in sources or _date(s["published"]) > reviewed:
                raise ValueError("Doppelte Quelle oder Quelle nach dem Prüfdatum")
            sources.add(s["id"])
        if not sources or not p["evidence"]:
            raise ValueError("Einordnung ohne Belege")
        if len(p["dimensions"]) != 5 or {d["key"] for d in p["dimensions"]} != DIMENSIONS:
            raise ValueError("Die fünf Blickwinkel müssen vollständig sein")
        for axis in ("opportunity", "risk"):
            if p[axis]["level"] not in LEVELS:
                raise ValueError("Unbekannte Einordnung")
        for item in [p["opportunity"], p["risk"], *p["dimensions"], *p["evidence"]]:
            _text(item["text"])
            if not item["source_ids"] or not set(item["source_ids"]) <= sources:
                raise ValueError("Aussage ohne zugehörige Quelle")
        for e in p["evidence"]:
            if e["kind"] not in {"reported", "announced"}:
                raise ValueError("Unbekannter Belegtyp")
        if len(p["watch"]) != 3:
            raise ValueError("Genau drei Beobachtungspunkte erforderlich")
        for w in p["watch"]:
            _text(w["label"])
            _text(w["text"])
            if w.get("metric") not in {None, "operating_margin", "fcf_margin"}:
                raise ValueError("Unbekannte Beobachtungskennzahl")


def for_company(symbol: str, isin: str = "", *, today: dt.date | None = None) -> dict:
    today = today or dt.datetime.now(dt.timezone.utc).date()
    try:
        catalog = json.loads(CATALOG_FILE.read_text("utf-8"))
        validate(catalog)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        log.warning("Zukunftskatalog nicht verfügbar: %s", e)
        return {"status": "unavailable", "coverage": []}

    # Noch nicht veröffentlichte Einordnungen nicht vorzeitig anzeigen.
    profiles = [p for p in catalog["profiles"] if _date(p["reviewed_at"]) <= today]
    coverage = [{"name": p["name"], "symbol": p["symbols"][0]} for p in profiles]
    result = {"status": "uncovered", "coverage": coverage, "review_days": REVIEW_DAYS}
    symbol, isin = symbol.strip().upper(), isin.strip().upper()
    by_symbol = next((p for p in profiles if symbol in p["symbols"]), None)
    by_isin = next((p for p in profiles if isin and isin in p["isins"]), None)
    # Widersprüchliche Stammdaten dürfen keine fremde Einordnung liefern.
    if by_symbol and isin and isin not in by_symbol["isins"]:
        return {**result, "status": "identity_conflict"}
    p = by_symbol or by_isin
    if p is None:
        return result
    age = (today - _date(p["reviewed_at"])).days
    return {**result, "status": "available", "profile": p, "age_days": age,
            "stale": age >= REVIEW_DAYS,
            "next_review": (_date(p["reviewed_at"]) + dt.timedelta(days=REVIEW_DAYS)).isoformat()}
