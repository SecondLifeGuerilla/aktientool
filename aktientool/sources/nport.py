"""Positionen von US-Fonds aus den Quartalsmeldungen an die SEC (Formular N-PORT, öffentlich mit 60 Tagen Verzug).

Jeder in den USA registrierte Fonds, auch jeder Closed-End-Fonds, meldet dort seinen kompletten Bestand. Die Datei
kann bei Anleihefonds viele Megabyte groß sein; sie wird deshalb beim Lesen durchlaufen und nicht gespeichert.
"""

from __future__ import annotations

import heapq
import urllib.request
import xml.etree.ElementTree as ET

from .. import config
from . import sec

SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
DOC_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/primary_doc.xml"
TOP = 15


def _latest_filing(cik: int) -> tuple[str, str] | None:
    recent = (sec._get_json(SUBMISSIONS_URL.format(cik=cik)).get("filings") or {}).get("recent") or {}
    for form, acc, day in zip(recent.get("form", []), recent.get("accessionNumber", []), recent.get("reportDate", [])):
        if form == "NPORT-P":
            return acc.replace("-", ""), day
    return None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _float(x: str | None) -> float | None:
    try:
        return float(x) if x not in (None, "", "N/A") else None
    except ValueError:
        return None


def _text(el) -> str:
    """Text eines Feldes; Platzhalter wie „N/A“ zählen als leer."""
    value = (el.text or "").strip() if el is not None else ""
    return "" if value.upper() in ("N/A", "NA", "NONE", "-") else value


def parse(stream) -> dict:
    """Die TOP größten Positionen nach Anteil am Fondsvermögen, dazu Stichtag und Nettovermögen."""
    top: list[tuple[float, int, dict]] = []
    info: dict = {"count": 0}
    n = 0
    for _, el in ET.iterparse(stream, events=("end",)):
        tag = _local(el.tag)
        if tag == "invstOrSec":
            fields = {_local(c.tag): c for c in el}
            pct = _float(fields["pctVal"].text) if "pctVal" in fields else None
            if pct is not None:
                isin = None
                ids = fields.get("identifiers")
                if ids is not None:
                    found = next((c for c in ids if _local(c.tag) == "isin"), None)
                    isin = found.get("value") if found is not None else None
                name = _text(fields.get("name"))
                title = _text(fields.get("title"))
                item = {"name": name or title or "unbekannt", "title": title if name and title != name else None,
                        "isin": isin, "weight": pct / 100, "value_usd": _float(fields["valUSD"].text) if "valUSD" in fields else None,
                        "kind": fields["assetCat"].text if "assetCat" in fields else None}
                n += 1
                entry = (pct, n, item)
                if len(top) < TOP:
                    heapq.heappush(top, entry)
                else:
                    heapq.heappushpop(top, entry)
            info["count"] += 1
            el.clear()
        elif tag == "repPdDate":
            info["date"] = (el.text or "")[:10] or None
        elif tag == "netAssets":
            info["net_assets_usd"] = _float(el.text)
    info["holdings"] = [item for _, _, item in sorted(top, reverse=True)]
    return info


def holdings(ticker: str) -> dict | None:
    """Größte Positionen eines US-Fonds laut letzter N-PORT-Meldung; None, wenn die SEC den Ticker nicht kennt
    oder es keine Meldung gibt."""
    entry = sec.ticker_map().get(ticker.upper())
    if not entry:
        return None
    found = _latest_filing(entry["cik"])
    if not found:
        return None
    acc, day = found
    req = urllib.request.Request(DOC_URL.format(cik=entry["cik"], acc=acc), headers={"User-Agent": config.SEC_USER_AGENT})
    with urllib.request.urlopen(req, timeout=180) as resp:
        out = parse(resp)
    out.setdefault("date", day)
    return out
