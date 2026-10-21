"""SEC EDGAR XBRL "companyfacts": lange Historie der Jahresabschlüsse (10-K, 20-F, 40-F), kostenlos und ohne API-Key.

Abgedeckt sind Unternehmen, die bei der SEC berichten: alle US-Firmen und ausländische Firmen mit US-Listing
(z. B. SAP, ASML, Novartis). Je Geschäftsjahr wird der zuletzt eingereichte Wert genommen; Werte je Aktie
werden um spätere Aktiensplits bereinigt.
"""

from __future__ import annotations

import gzip
import json
import re
import urllib.request
from datetime import date

from .. import config
from ..cache import cached

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "10-KT"}

# Je Feld mehrere mögliche Tags; der erste Tag mit einem Wert für ein Geschäftsjahr gewinnt.
TAGS = {
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic",
            "DilutedEarningsLossPerShare", "BasicAndDilutedEarningsLossPerShare", "BasicEarningsLossPerShare"],
    "net_income": ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic",
                   "ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
    "shares": ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic",
               "AdjustedWeightedAverageShares", "WeightedAverageShares"],
    "ocf": ["NetCashProvidedByUsedInOperatingActivities",
            "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
            "CashFlowsFromUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets",
              "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
                "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenue"],
}
PER_SHARE = {"eps"}
SHARE_COUNTS = {"shares"}
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def unit_ok(field: str, unit: str) -> bool:
    """Manche Firmen taggen Werte mit falscher Einheit (z. B. EPS als „pure“); solche Einträge ignorieren."""
    if field in PER_SHARE:
        cur, _, per = unit.partition("/")
        return per == "shares" and bool(CURRENCY_RE.match(cur))
    if field in SHARE_COUNTS:
        return unit == "shares"
    return bool(CURRENCY_RE.match(unit))

_LEGAL_WORDS = {
    "inc", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "se", "ag", "nv", "sa", "spa",
    "holding", "holdings", "group", "the", "kgaa", "as", "asa", "ab", "oyj", "ord", "adr", "class", "cl",
}


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": config.SEC_USER_AGENT, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return json.loads(body.decode("utf-8"))


def ticker_map() -> dict[str, dict]:
    def load():
        data = _get_json(TICKERS_URL)
        return {row["ticker"].upper(): {"cik": row["cik_str"], "title": row["title"]} for row in data.values()}
    return cached("sec_tickers", config.TTL_SEC_TICKERS, load)


def _name_tokens(name: str) -> list[str]:
    words = re.sub(r"[^a-z0-9 ]", " ", (name or "").lower()).split()
    return [w for w in words if w not in _LEGAL_WORDS]


def names_match(a: str, b: str) -> bool:
    ta, tb = _name_tokens(a), _name_tokens(b)
    return bool(ta and tb and ta[0] == tb[0])


def find_cik(symbol: str, company_name: str | None) -> int | None:
    """US-Ticker direkt; bei Auslandslistings (z. B. SAP.DE) nur, wenn der Basisticker bei der SEC
    existiert und der Firmenname passt."""
    base, _, suffix = symbol.upper().partition(".")
    entry = ticker_map().get(base)
    if not entry:
        return None
    if not suffix or names_match(entry["title"], company_name or ""):
        return entry["cik"]
    return None


def company_facts(cik: int) -> dict:
    """Alle XBRL-Werte einer Firma (oft 5–15 MB). Wird nicht gespeichert, nur der Auszug daraus (siehe _compact)."""
    return _get_json(FACTS_URL.format(cik=cik))


def compact(facts: dict) -> dict:
    """Nur die benötigten Jahreswerte: {Feld: {Stichtag: {"val", "filed", "unit"}}} (wenige KB statt MB)."""
    return {field: _series(facts, tags, field) for field, tags in TAGS.items()}


def _compact(cik: int) -> dict:
    return cached(f"sec_rows_{cik}", config.TTL_SEC_FACTS, lambda: compact(company_facts(cik)))


def _split_factor(filed: str, splits: list[list]) -> float:
    """Produkt aller Splits nach dem Einreichungsdatum: um diesen Faktor ist die Aktienzahl seither gewachsen."""
    factor = 1.0
    for day, ratio in splits:
        if day > filed and ratio > 0:
            factor *= ratio
    return factor


def _series(facts: dict, tags: list[str], field: str, instant: bool = False) -> dict[str, dict]:
    """{Geschäftsjahresende: {"val", "filed", "unit"}} – je Stichtag der zuletzt eingereichte Jahreswert."""
    merged: dict[str, dict] = {}
    for tag in tags:
        found: dict[str, dict] = {}
        for taxonomy in ("us-gaap", "ifrs-full"):
            node = facts.get("facts", {}).get(taxonomy, {}).get(tag)
            if not node:
                continue
            for unit, items in node.get("units", {}).items():
                if not unit_ok(field, unit):
                    continue
                for it in items:
                    if it.get("form") not in ANNUAL_FORMS or "end" not in it or it.get("val") is None:
                        continue
                    if not instant:
                        if "start" not in it:
                            continue
                        days = (date.fromisoformat(it["end"]) - date.fromisoformat(it["start"])).days
                        if not 340 <= days <= 390:
                            continue
                    prev = found.get(it["end"])
                    if prev is None or it.get("filed", "") >= prev["filed"]:
                        found[it["end"]] = {"val": float(it["val"]), "filed": it.get("filed", ""), "unit": unit}
        for end, v in found.items():
            merged.setdefault(end, v)
    return merged


def _currency(unit: str) -> str:
    return unit.split("/")[0].upper()


def annual_rows(cik: int, splits: list[list]) -> list[dict]:
    """Jahreswerte aus SEC-Daten: EPS (verwässert, splitbereinigt), Cashflow, Umsatz und Aktienzahl."""
    series = _compact(cik)
    ends = sorted(set(series["eps"]) | set(series["ocf"]))
    rows = []
    for end in ends:
        row: dict = {"end": end}
        for field, data in series.items():
            item = data.get(end)
            if not item:
                continue
            val = item["val"]
            factor = _split_factor(item["filed"], splits)
            if field in PER_SHARE:
                val /= factor
            elif field in SHARE_COUNTS:
                val *= factor
            else:
                row.setdefault("currency", _currency(item["unit"]))
            if field in PER_SHARE:
                row["eps_currency"] = _currency(item["unit"])
            row[field] = val
        # Aktienzahl fehlt manchmal; dann aus Gewinn / EPS ableiten
        if not row.get("shares") and row.get("net_income") and row.get("eps"):
            implied = row["net_income"] / row["eps"]
            if implied > 0:
                row["shares"] = implied
        rows.append(row)
    return rows
