"""Closed-End-Fonds (Investment Trusts) weltweit über die öffentliche Fondssuche von Morningstar UK.

Der Screener liefert für alle Börsen Kurs und Abschlag zum inneren Wert (NAV). Die Detailansicht mit den größten
Positionen, dem Datum des letzten NAV und dem durchschnittlichen Abschlag gibt es dort nur für Fonds, die in
Großbritannien vertrieben werden (London); für andere Börsen bleibt sie leer.
"""

from __future__ import annotations

import datetime as dt
import http.client
import json
import time
import urllib.parse
import urllib.request

BASE = "https://lt.morningstar.com/api/rest.svc"
CLIENT = "klr5zyak8x"  # Kennung der britischen Morningstar-Seite
USER_AGENT = "Mozilla/5.0 (Aktientool lokal)"
PAGE = 50  # größere Seiten brechen öfter ab
FIELDS = ["SecId", "Name", "LegalName", "Ticker", "ISIN", "ExchangeId", "PriceCurrency", "ClosePrice", "ClosePriceDate",
          "DiscountPremium", "CategoryName", "MarketCap", "ExpenseRatio", "DividendYield", "NavReturnM60", "ReturnM60",
          "BrandingCompanyName", "Domicile", "InceptionDate"]

# Morningstar-Börse -> (Yahoo-Endung, Land der Börse). Reihenfolge = Vorrang, wenn ein Fonds an mehreren Börsen notiert.
EXCHANGES = {
    "XLON": (".L", "GB"), "XNYS": ("", "US"), "XNAS": ("", "US"), "XASE": ("", "US"), "ARCX": ("", "US"),
    "XSWX": (".SW", "CH"), "XASX": (".AX", "AU"), "XTSE": (".TO", "CA"), "XNZE": (".NZ", "NZ"),
    "XAMS": (".AS", "NL"), "XPAR": (".PA", "FR"), "XMIL": (".MI", "IT"), "XDUB": (".IR", "IE"),
}


def _get(path: str, params: dict, timeout: int = 60) -> object:
    url = f"{BASE}/{path}?{urllib.parse.urlencode(params)}"
    err: Exception | None = None
    for attempt in range(5):  # die Antworten brechen gelegentlich mittendrin ab
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (OSError, ValueError, http.client.HTTPException) as e:
            err = e
            time.sleep(1 + attempt)
    raise err  # type: ignore[misc]


def _screen(exchange: str) -> list[dict]:
    rows: list[dict] = []
    page = 1
    while True:
        data = _get(f"{CLIENT}/security/screener", {
            "page": page, "pageSize": PAGE, "sortOrder": "Name asc", "outputType": "json", "version": 1,
            "languageId": "en-GB", "currencyId": "EUR", "universeIds": f"CEEXG${exchange}",
            "securityDataPoints": "|".join(FIELDS)})
        batch = data.get("rows") or []
        rows += batch
        if not batch or len(rows) >= (data.get("total") or 0) or page >= 30:
            return rows
        page += 1


def yahoo_symbol(ticker: str | None, exchange: str) -> str | None:
    suffix = EXCHANGES.get(exchange, (None,))[0]
    if not ticker or suffix is None:
        return None
    return ticker.strip().upper().replace(".", "-").replace("/", "-") + suffix


def closed_end_funds() -> list[dict]:
    """Alle Closed-End-Fonds der Börsen in EXCHANGES, je ISIN einmal (Heimatbörse bzw. die mit Abschlag zuerst).
    Börsenwert in Euro, Kurs in der Handelswährung (London: Pence), Prozentangaben als Anteil (0,05 = 5 %)."""
    best: dict[str, dict] = {}
    for exchange, (_, country) in EXCHANGES.items():
        for r in _screen(exchange):
            disc = r.get("DiscountPremium")
            price = r.get("ClosePrice")
            key = r.get("ISIN") or r.get("SecId")
            if not key or not price:
                continue
            row = {
                "sec_id": r.get("SecId"), "isin": r.get("ISIN"), "name": r.get("LegalName") or r.get("Name"),
                "symbol": yahoo_symbol(r.get("Ticker"), exchange), "exchange": exchange, "country": country,
                "currency": r.get("PriceCurrency"), "price": price, "date": r.get("ClosePriceDate"),
                "disc": disc / 100 if isinstance(disc, (int, float)) else None,
                "category": r.get("CategoryName"), "cap_eur": r.get("MarketCap"),
                "ocf": _pct(r.get("ExpenseRatio")), "yield": _pct(r.get("DividendYield")),
                "nav_ret5": _pct(r.get("NavReturnM60")), "ret5": _pct(r.get("ReturnM60")),
                "manager": r.get("BrandingCompanyName"), "launch": (r.get("InceptionDate") or "")[:10] or None,
            }
            old = best.get(key)
            if old is None or (old["disc"] is None and row["disc"] is not None):
                best[key] = row
    return list(best.values())


def _pct(x) -> float | None:
    return x / 100 if isinstance(x, (int, float)) else None


def timeseries(sec_id: str, nav: bool, start: str = "2000-01-01") -> list[list]:
    """Tägliche Schlusskurse bzw. NAVs eines Fonds in Euro: [[JJJJ-MM-TT, Wert], …] (bei vielen Fonds ab 2000).
    Kurs und NAV sind zum selben Tageskurs umgerechnet, ihr Verhältnis (der Abschlag) hängt also nicht davon ab."""
    params = {"currencyId": "EUR", "idtype": "Morningstar", "frequency": "daily", "startDate": start,
              "outputType": "COMPACTJSON", "id": f"{sec_id}]2]0]"}
    if nav:
        params["priceType"] = "NAV"
    rows = _get(f"timeseries_price/{CLIENT}", params, timeout=90)
    if not isinstance(rows, list):
        return []
    out = []
    for r in rows:
        if isinstance(r, list) and len(r) >= 2 and isinstance(r[1], (int, float)) and r[1] > 0:
            day = dt.datetime.fromtimestamp(r[0] / 1000, tz=dt.timezone.utc).date().isoformat()
            out.append([day, float(r[1])])
    return out


def details(sec_id: str) -> dict | None:
    """NAV-Datum, Durchschnittsabschlag, Fremdkapital und die größten Positionen (nur in Großbritannien
    vertriebene Fonds); None, wenn Morningstar zu dem Fonds keine Detailseite hat."""
    data = _get(f"{CLIENT}/security_details/{sec_id}", {
        "viewId": "MFsnapshot", "idtype": "msid", "responseViewFormat": "json", "languageId": "en-GB", "currencyId": "EUR"},
        timeout=90)
    if not isinstance(data, list) or not data or not isinstance(data[0], dict) or "Id" not in data[0]:
        return None
    d = data[0]
    cef = d.get("Cef") or {}
    holdings, as_of = [], None
    for port in d.get("Portfolios") or []:
        items = port.get("PortfolioHoldings")
        if isinstance(items, list) and items:
            as_of = (port.get("Date") or "")[:10] or None
            for h in items:
                if h.get("SecurityName"):
                    holdings.append({"name": h["SecurityName"], "isin": h.get("ISIN"), "weight": _pct(h.get("Weighting")),
                                     "shares": h.get("NumberOfShare"), "country": h.get("CountryId")})
            break
    return {
        "nav_date": (cef.get("LastNAVUpdated") or "")[:10] or None,
        "nav_frequency": cef.get("NAVFrequency"),
        "avg_disc_12m": _pct(cef.get("AverageDiscountM12")), "avg_disc_3m": _pct(cef.get("AverageDiscountM3")),
        "holdings": holdings, "holdings_date": as_of,
    }
