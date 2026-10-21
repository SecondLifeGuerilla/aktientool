"""ESEF: offizielle Jahresfinanzberichte börsennotierter europäischer Firmen im XBRL-Format, kostenlos über
filings.xbrl.org (ohne API-Key).

Seit dem Geschäftsjahr 2020 müssen Emittenten an EU-Börsen ihre Konzernabschlüsse maschinenlesbar veröffentlichen;
jeder Bericht enthält auch das Vorjahr. Zusammen mit den ~4 Jahren von Yahoo ergeben sich so meist 6 und mehr
Geschäftsjahre. Die Sammlung von filings.xbrl.org deckt u. a. Frankreich, die Niederlande, Italien, Spanien,
Skandinavien, Österreich, Belgien, Polen und Großbritannien ab, aber nicht Deutschland und Irland (dort werden die
Berichte nur im Unternehmensregister veröffentlicht, das keine freie Schnittstelle hat).

Ablauf: ISIN -> LEI (GLEIF) -> Liste der Berichte -> je Bericht die benötigten Werte aus dem xBRL-JSON.
Ein Bericht ändert sich nicht mehr; seine Werte bleiben daher dauerhaft im Cache.
"""

from __future__ import annotations

import gzip
import http.client
import json
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

from .. import config
from ..cache import cached

GLEIF_URL = "https://api.gleif.org/api/v1/lei-records?filter%5Bisin%5D={isin}"
FILINGS_URL = "https://filings.xbrl.org/api/entities/{lei}/filings"
BASE_URL = "https://filings.xbrl.org"

# Länder (laut ISIN), deren Berichte filings.xbrl.org sammelt
COUNTRIES = {"FR", "NL", "IT", "ES", "SE", "DK", "FI", "AT", "BE", "PT", "NO", "GB", "PL", "LU", "GR", "CZ", "HU",
             "RO", "SI", "SK", "HR", "BG", "EE", "LV", "LT", "IS", "CY", "MT", "LI"}

# Je Feld mehrere IFRS-Konzepte; das erste mit einem Wert für ein Geschäftsjahr gewinnt
CONCEPTS = {
    "eps": ["ifrs-full:DilutedEarningsLossPerShare", "ifrs-full:BasicAndDilutedEarningsLossPerShare",
            "ifrs-full:BasicEarningsLossPerShare"],
    "net_income": ["ifrs-full:ProfitLossAttributableToOwnersOfParent", "ifrs-full:ProfitLoss"],
    "shares": ["ifrs-full:AdjustedWeightedAverageShares", "ifrs-full:WeightedAverageShares"],
    "ocf": ["ifrs-full:CashFlowsFromUsedInOperatingActivities"],
    "capex": ["ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
              "ifrs-full:PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets"],
    "revenue": ["ifrs-full:Revenue", "ifrs-full:RevenueFromContractsWithCustomers"],
}
PER_SHARE = {"eps"}
SHARE_COUNTS = {"shares"}
PLAIN_DIMENSIONS = {"concept", "entity", "period", "unit"}  # Werte mit weiteren Achsen (Segmente …) zählen nicht


def covers(isin: str | None) -> bool:
    return bool(isin) and isin[:2].upper() in COUNTRIES


def _get(url: str, attempts: int = 3) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": config.SEC_USER_AGENT, "Accept-Encoding": "gzip"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                return gzip.decompress(body) if resp.headers.get("Content-Encoding") == "gzip" else body
        except (http.client.IncompleteRead, ConnectionError, TimeoutError):
            if attempt == attempts - 1:
                raise
            time.sleep(2 * (attempt + 1))  # abgebrochene Übertragung: kurz warten, erneut versuchen
    raise RuntimeError("unerreichbar")


def lei_for_isin(isin: str) -> str | None:
    def load():
        data = json.loads(_get(GLEIF_URL.format(isin=urllib.parse.quote(isin))))
        records = data.get("data") or []
        return records[0]["id"] if records else None
    return cached(f"esef_lei_{isin}", config.TTL_ESEF_LEI, load)


def filings(lei: str) -> list[dict]:
    """Jahresberichte einer Firma, je Geschäftsjahr der zuletzt eingestellte (bei mehreren Sprachfassungen)."""
    def load():
        data = json.loads(_get(FILINGS_URL.format(lei=lei)))
        by_end: dict[str, dict] = {}
        for f in data.get("data") or []:
            a = f.get("attributes") or {}
            if not a.get("json_url") or not a.get("period_end"):
                continue
            item = {"id": a.get("fxo_id") or a["json_url"], "end": a["period_end"], "added": (a.get("date_added") or "")[:10],
                    "url": a["json_url"]}
            prev = by_end.get(item["end"])
            if prev is None or item["added"] > prev["added"]:
                by_end[item["end"]] = item
        return sorted(by_end.values(), key=lambda x: x["end"])
    return cached(f"esef_filings_{lei}", config.TTL_ESEF_FILINGS, load)


def _year_end(period: str) -> str | None:
    """'2023-01-01T00:00:00/2024-01-01T00:00:00' -> '2023-12-31', nur für Zeiträume von rund einem Jahr."""
    if "/" not in period:
        return None
    start, end = (date.fromisoformat(p[:10]) for p in period.split("/"))
    if not 340 <= (end - start).days <= 390:
        return None
    # xBRL-JSON gibt das Ende exklusiv an (Mitternacht des Folgetags)
    return (end - timedelta(days=1)).isoformat() if period.split("/")[1][11:19] == "00:00:00" else end.isoformat()


def extract(doc: dict) -> dict[str, dict[str, dict]]:
    """{Feld: {Geschäftsjahresende: {"val", "unit"}}} aus einem xBRL-JSON-Bericht."""
    found: dict[str, dict[str, dict[str, dict]]] = {f: {} for f in CONCEPTS}  # Feld -> Konzept -> Ende -> Wert
    wanted = {c: f for f, cs in CONCEPTS.items() for c in cs}
    for fact in (doc.get("facts") or {}).values():
        dims = fact.get("dimensions") or {}
        field = wanted.get(dims.get("concept"))
        if not field or not set(dims) <= PLAIN_DIMENSIONS or "unit" not in dims:
            continue
        end = _year_end(dims.get("period", ""))
        try:
            val = float(fact.get("value"))
        except (TypeError, ValueError):
            continue
        if end:
            found[field].setdefault(dims["concept"], {})[end] = {"val": val, "unit": dims["unit"]}
    out: dict[str, dict[str, dict]] = {}
    for field, concepts in CONCEPTS.items():
        merged: dict[str, dict] = {}
        for concept in concepts:
            for end, v in found[field].get(concept, {}).items():
                merged.setdefault(end, v)
        out[field] = merged
    return out


def _filing_values(filing: dict) -> dict:
    def load():
        return extract(json.loads(_get(BASE_URL + filing["url"])))
    return cached(f"esef_facts_{filing['id']}", config.TTL_ESEF_FACTS, load)


def _currency(unit: str) -> str:
    # 'iso4217:EUR' bzw. 'iso4217:EUR/xbrli:shares'
    return unit.split("/")[0].split(":")[-1].upper()


def annual_reports(all_filings: list[dict], fy_month: int | None) -> list[dict]:
    """Nur Jahresberichte: Manche Firmen (z. B. Novo Nordisk) veröffentlichen auch Quartalsberichte im ESEF-Format.
    Erkannt am Monat des Geschäftsjahresendes; ohne diese Angabe der häufigste Monat."""
    if not all_filings:
        return []
    months = [int(f["end"][5:7]) for f in all_filings]
    month = fy_month or max(set(months), key=lambda m: (months.count(m), m == 12))
    return [f for f, m in zip(all_filings, months) if m == month]


def annual_rows(isin: str, splits: list[list], fy_month: int | None = None) -> list[dict]:
    """Jahreswerte im Format von sec.annual_rows; spätere Berichte überschreiben Vorjahreswerte (Anpassungen)."""
    from .sec import _split_factor  # gleiche Split-Bereinigung wie bei den SEC-Daten

    lei = lei_for_isin(isin)
    if not lei:
        return []
    merged: dict[str, dict] = {}
    for filing in annual_reports(filings(lei), fy_month):
        values = _filing_values(filing)
        # „date_added“ ist der Tag der Aufnahme ins Archiv, bei älteren Berichten oft Jahre nach der Veröffentlichung.
        # Für die Split-Bereinigung zählt die Veröffentlichung: spätestens rund 5 Monate nach Geschäftsjahresende
        published = min(filing["added"] or "9999", (date.fromisoformat(filing["end"]) + timedelta(days=150)).isoformat())
        for field, by_end in values.items():
            for end, v in by_end.items():
                row = merged.setdefault(end, {"end": end})
                if field in row and row.get(f"_{field}_filed", "") > published:
                    continue
                val = v["val"]
                factor = _split_factor(published, splits)
                if field in PER_SHARE:
                    val /= factor
                    row["eps_currency"] = _currency(v["unit"])
                elif field in SHARE_COUNTS:
                    val *= factor
                else:
                    row["currency"] = _currency(v["unit"])
                row[field] = abs(val) if field == "capex" else val
                row[f"_{field}_filed"] = published
    rows = []
    for end in sorted(merged):
        row = {k: v for k, v in merged[end].items() if not k.startswith("_")}
        if row.get("eps") is None and row.get("ocf") is None:
            continue
        if not row.get("shares") and row.get("net_income") and row.get("eps"):
            implied = row["net_income"] / row["eps"]
            if implied > 0:
                row["shares"] = implied
        rows.append(row)
    return rows
