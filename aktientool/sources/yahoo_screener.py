"""Yahoo-Finance-Screener: ganze Börsen mit wenigen Abfragen laden (bis zu 250 Aktien je Seite).

Zwei Endpunkte liefern dieselbe Trefferliste mit unterschiedlichen Feldern:
- /v1/finance/screener: Kursdaten (Kurs, Börsenwert, KGV, Dividendenrendite, 52-Wochen-Werte, Analysten) und die
  Yahoo-Firmenkennung `messageBoardId`, die alle Börsennotierungen einer Firma (auch ADRs) gemeinsam haben
- /v1/finance/visualization: ISIN, Sektor, Branche und Bilanzkennzahlen der letzten 12 Monate
"""

from __future__ import annotations

import json
import logging
import time

from yfinance.data import YfData
from yfinance.exceptions import YFRateLimitError

log = logging.getLogger(__name__)

BASE = "https://query1.finance.yahoo.com"
PAGE = 250
PARAMS = {"lang": "en-US", "region": "US", "formatted": "false", "corsDomain": "finance.yahoo.com"}

FUNDAMENTAL_FIELDS = [
    "ticker", "isin", "sector", "industry", "intradaymarketcap",
    "peratio.lasttwelvemonths", "pricebookratio.quarterly", "lastclosemarketcaptotalrevenue.lasttwelvemonths",
    "lastclosetevebitda.lasttwelvemonths", "pegratio_5y",
    "returnonequity.lasttwelvemonths", "returnonassets.lasttwelvemonths", "grossprofitmargin.lasttwelvemonths",
    "ebitdamargin.lasttwelvemonths", "netincomemargin.lasttwelvemonths",
    "totalrevenues1yrgrowth.lasttwelvemonths", "epsgrowth.lasttwelvemonths",
    "totaldebtequity.lasttwelvemonths", "netdebtebitda.lasttwelvemonths", "beta",
    "forward_dividend_yield", "consecutive_years_of_dividend_growth_count",
    "lastclosetevebit.lasttwelvemonths", "returnontotalcapital.lasttwelvemonths",
    "altmanzscoreusingtheaveragestockinformationforaperiod.lasttwelvemonths",
]


def _request(method: str, path: str, **kwargs) -> dict:
    data = YfData()  # Singleton mit Cookie und Crumb, wie bei yfinance selbst
    for attempt in range(4):
        try:
            resp = getattr(data, method)(BASE + path, **kwargs)
        except YFRateLimitError:
            if attempt == 3:
                raise
            time.sleep(5 * 2 ** attempt)
            continue
        if resp.status_code == 200:
            return resp.json()
        if resp.status_code >= 500 and attempt < 3:
            time.sleep(2 ** attempt)
            continue
        resp.raise_for_status()
    raise RuntimeError(f"Yahoo Finance antwortet nicht ({path})")


def _post(path: str, body: dict) -> dict:
    j = _request("post", path, data=json.dumps(body, separators=(",", ":")), params=PARAMS)
    result = (j.get("finance") or {}).get("result") or [{}]
    return result[0] or {}


def _query(exchanges: list[str], min_cap: float) -> dict:
    eq = [{"operator": "EQ", "operands": ["exchange", e]} for e in exchanges]
    exchange = eq[0] if len(eq) == 1 else {"operator": "OR", "operands": eq}
    return {"operator": "AND", "operands": [exchange, {"operator": "GT", "operands": ["intradaymarketcap", min_cap]}]}


def listings(exchanges: list[str], min_cap: float) -> list[dict]:
    """Alle Aktien der Börsen mit einem Börsenwert über `min_cap` (in Landeswährung).

    Jede Notierung ist ein Yahoo-Kursdatensatz, ergänzt um `fundamentals` aus dem zweiten Endpunkt.
    """
    query = _query(exchanges, min_cap)
    quotes, fundamentals = [], {}
    offset, total = 0, None
    while total is None or offset < total:
        body = {"offset": offset, "size": PAGE, "sortField": "intradaymarketcap", "sortType": "DESC",
                "quoteType": "EQUITY", "query": query}
        page = _post("/v1/finance/screener", {**body, "userId": "", "userIdType": "guid"})
        viz = _post("/v1/finance/visualization", {**body, "includeFields": FUNDAMENTAL_FIELDS, "topOperator": "AND"})
        total = page.get("total") or 0
        quotes += page.get("quotes") or []
        doc = (viz.get("documents") or [{}])[0]
        cols = [c["id"] for c in doc.get("columns", [])]
        for row in doc.get("rows", []):
            rec = dict(zip(cols, row))
            if rec.get("ticker"):
                fundamentals[rec["ticker"]] = rec
        if not page.get("quotes"):
            break
        offset += PAGE
    # Beide Endpunkte sortieren gleich, an Seitengrenzen kann es trotzdem verrutschen: daher erst am Ende zusammenführen
    return [{**q, "fundamentals": fundamentals.get(q.get("symbol"), {})} for q in quotes if q.get("symbol")]


def quotes(symbols: list[str]) -> list[dict]:
    """Kursdatensätze für beliebige Ticker (gleiche Felder wie im Screener)."""
    out = []
    for i in range(0, len(symbols), 100):
        j = _request("get", "/v7/finance/quote", params={"symbols": ",".join(symbols[i:i + 100])})
        out += (j.get("quoteResponse") or {}).get("result") or []
    return out


def usd_rates(currencies: list[str]) -> dict[str, float]:
    """US-Dollar je Einheit der jeweiligen Währung, z. B. {'EUR': 1.08}."""
    rates = {"USD": 1.0}
    for q in quotes([f"{c}USD=X" for c in currencies if c != "USD"]):
        price = q.get("regularMarketPrice")
        if price:
            rates[q["symbol"][:3]] = float(price)
    return rates
