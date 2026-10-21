"""Netto-Leerverkaufspositionen aus dem Bundesanzeiger (kostenlos, als CSV).

Wer 0,5 % oder mehr der Aktien eines in der EU gehandelten Emittenten leerverkauft hat, muss das veröffentlichen;
der Bundesanzeiger listet die Meldungen zu Emittenten, für die die BaFin zuständig ist (vor allem deutsche
Aktien). Eine Meldung unter 0,5 % bedeutet, dass die Position unter die Meldeschwelle gefallen ist.
"""

from __future__ import annotations

import csv
import http.cookiejar
import io
import re
import urllib.request
from collections import defaultdict

from .. import config
from ..cache import cached

PAGE_URL = "https://www.bundesanzeiger.de/pub/de/nlp?0"
THRESHOLD = 0.5  # Prozent


def _download() -> str:
    """Die CSV-Datei hängt an einer Sitzung: erst die Seite laden (Cookie), dann den Link darauf abrufen."""
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", "Mozilla/5.0 (Aktientool lokal)")]
    html = opener.open(PAGE_URL, timeout=30).read().decode("utf-8", "replace")
    match = re.search(r'href="([^"]*csv~form~panel-form-csv~resource~link[^"]*)"', html)
    if not match:
        raise RuntimeError("CSV-Link im Bundesanzeiger nicht gefunden")
    return opener.open(match.group(1).replace("&amp;", "&"), timeout=60).read().decode("utf-8-sig", "replace")


def parse(text: str) -> dict[str, dict]:
    """{ISIN: {"issuer", "total", "positions": [...]}}; je Positionsinhaber zählt die jüngste Meldung."""
    latest: dict[str, dict[str, dict]] = defaultdict(dict)
    issuers: dict[str, str] = {}
    for row in csv.DictReader(io.StringIO(text)):
        isin = (row.get("ISIN") or "").strip().upper()
        holder = (row.get("Positionsinhaber") or "").strip()
        try:
            pos = float((row.get("Position") or "").replace(",", "."))
        except ValueError:
            continue
        day = (row.get("Datum") or "").strip()
        if not isin or not holder:
            continue
        issuers[isin] = (row.get("Emittent") or "").strip()
        prev = latest[isin].get(holder)
        if prev is None or day >= prev["date"]:
            latest[isin][holder] = {"holder": holder, "position": pos / 100, "date": day}
    out = {}
    for isin, holders in latest.items():
        positions = sorted(holders.values(), key=lambda p: -p["position"])
        active = [p for p in positions if p["position"] >= THRESHOLD / 100]
        out[isin] = {"issuer": issuers.get(isin), "total": sum(p["position"] for p in active),
                     "active": len(active), "positions": positions}
    return out


def all_positions() -> dict[str, dict]:
    return cached("shorts_bundesanzeiger", config.TTL_SHORTS, lambda: parse(_download()))


def for_isin(isin: str | None) -> dict | None:
    if not isin:
        return None
    return all_positions().get(isin.upper())
