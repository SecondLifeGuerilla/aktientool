"""Yahoo Finance über yfinance: Suche, Kurse, Dividenden, Stammdaten, Jahresabschlüsse und Analystenschätzungen.

Alles wird in reine Python-Strukturen (JSON-fähig) übersetzt, damit es im Datei-Cache landen kann.
Yahoo liefert Jahresabschlüsse nur für die letzten ~4 Geschäftsjahre; Kurse und Dividenden reichen Jahrzehnte zurück.
"""

from __future__ import annotations

import logging
import math

import pandas as pd
import yfinance as yf

log = logging.getLogger(__name__)


class SymbolNotFound(Exception):
    pass


# Aufbau der Rohdaten; ältere Cache-Dateien ohne die neueren Felder werden neu geladen
RAW_VERSION = 2


INFO_KEYS = [
    "longName", "shortName", "symbol", "exchange", "fullExchangeName", "quoteType",
    "country", "sector", "industry", "fullTimeEmployees", "website", "longBusinessSummary",
    "currency", "financialCurrency", "marketCap", "currentPrice", "regularMarketPrice",
    "regularMarketPreviousClose", "regularMarketChangePercent", "sharesOutstanding",
    "impliedSharesOutstanding", "trailingEps", "forwardEps", "trailingPE", "forwardPE",
    "payoutRatio", "totalDebt", "totalCash", "operatingCashflow", "freeCashflow",
    "targetMeanPrice", "targetMedianPrice", "targetLowPrice", "targetHighPrice",
    "numberOfAnalystOpinions", "recommendationKey", "lastFiscalYearEnd", "nextFiscalYearEnd",
    "mostRecentQuarter", "beta", "exDividendDate", "dividendDate", "dividendRate",
]

INCOME_MAP = {
    "eps": ["Diluted EPS", "Basic EPS"],
    "net_income": ["Net Income Common Stockholders", "Net Income"],
    "normalized_income": ["Normalized Income"],
    "shares": ["Diluted Average Shares", "Basic Average Shares"],
    "revenue": ["Total Revenue", "Operating Revenue"],
    # für Kapitalrendite (ROIC) und Piotroski F-Score
    "ebit": ["EBIT", "Operating Income"],
    "gross_profit": ["Gross Profit"],
    "tax_rate": ["Tax Rate For Calcs"],
}
CASHFLOW_MAP = {
    "ocf": ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"],
    "capex": ["Capital Expenditure"],
    "fcf": ["Free Cash Flow"],
}
BALANCE_MAP = {
    "total_debt": ["Total Debt"],
    "cash": ["Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents"],
    "invested_capital": ["Invested Capital"],
    "total_assets": ["Total Assets"],
    "current_assets": ["Current Assets"],
    "current_liabilities": ["Current Liabilities"],
    "long_term_debt": ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"],
    "equity": ["Stockholders Equity", "Common Stock Equity"],
    "shares_out": ["Ordinary Shares Number", "Share Issued"],
}


def _num(x) -> float | None:
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _day(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def search(query: str, limit: int = 10) -> list[dict]:
    res = yf.Search(query, max_results=limit, news_count=0, lists_count=0, recommended=0)
    out = []
    for q in res.quotes:
        if q.get("quoteType") != "EQUITY" or not q.get("symbol"):
            continue
        out.append({
            "symbol": q["symbol"],
            "name": q.get("longname") or q.get("shortname") or q["symbol"],
            "exchange": q.get("exchDisp") or q.get("exchange"),
            "sector": q.get("sectorDisp") or q.get("sector"),
        })
    return out


def _statement(df: pd.DataFrame | None, mapping: dict[str, list[str]]) -> dict[str, dict]:
    """yfinance-Abschluss (Zeilen = Positionen, Spalten = Stichtage) -> {Stichtag: {Feld: Wert}}."""
    out: dict[str, dict] = {}
    if df is None or df.empty:
        return out
    for col in df.columns:
        row = out.setdefault(_day(col), {})
        for field, names in mapping.items():
            for name in names:
                if name in df.index:
                    val = df.loc[name, col]
                    if isinstance(val, pd.Series):  # doppelte Zeilennamen
                        val = val.iloc[0]
                    v = _num(val)
                    if v is not None:
                        row[field] = v
                        break
    return out


def _first_column(df: pd.DataFrame | None, mapping: dict[str, list[str]]) -> dict:
    stmt = _statement(df.iloc[:, :1] if df is not None and not df.empty else None, mapping)
    return next(iter(stmt.values()), {})


def _safe(fn, default=None):
    try:
        return fn()
    except Exception as e:  # yfinance wirft je nach Endpunkt sehr unterschiedliche Fehler
        log.info("yfinance: %s", e)
        return default


def _revisions(t: yf.Ticker) -> dict:
    """Wie sich die Gewinnschätzungen der Analysten zuletzt verändert haben (Schätzungs-Revisionen)."""
    out = {}
    trend = _safe(lambda: t.eps_trend)
    revs = _safe(lambda: t.eps_revisions)
    for period in ("0y", "+1y"):
        row = {}
        if trend is not None and not trend.empty and period in trend.index:
            r = trend.loc[period]
            row.update({k: _num(r.get(col)) for k, col in (("now", "current"), ("d7", "7daysAgo"), ("d30", "30daysAgo"),
                                                           ("d60", "60daysAgo"), ("d90", "90daysAgo"))})
        if revs is not None and not revs.empty and period in revs.index:
            r = revs.loc[period]
            row.update({"up30": _num(r.get("upLast30days")), "down30": _num(r.get("downLast30days"))})
        if row:
            out[period] = row
    return out


def _surprises(t: yf.Ticker) -> list[dict]:
    """Gemeldeter Gewinn je Aktie gegenüber der Analystenerwartung in den letzten Quartalen."""
    df = _safe(lambda: t.earnings_history)
    if df is None or df.empty:
        return []
    return [{"quarter": _day(q), "actual": _num(r.get("epsActual")), "estimate": _num(r.get("epsEstimate")),
             "surprise": _num(r.get("surprisePercent"))} for q, r in df.iterrows()]


def _insider(t: yf.Ticker) -> dict:
    """Insiderkäufe und -verkäufe (Yahoo hat sie praktisch nur für US-Aktien)."""
    out: dict = {"summary": {}, "transactions": []}
    p = _safe(lambda: t.insider_purchases)
    if p is not None and not p.empty:
        for _, r in p.iterrows():
            label = str(r.iloc[0])
            key = {"Purchases": "buys", "Sales": "sales", "Net Shares Purchased (Sold)": "net",
                   "Total Insider Shares Held": "held"}.get(label)
            if key:
                out["summary"][key] = {"shares": _num(r.get("Shares")), "count": _num(r.get("Trans"))}
    tx = _safe(lambda: t.insider_transactions)
    if tx is not None and not tx.empty:
        for _, r in tx.head(12).iterrows():
            day = r.get("Start Date")
            out["transactions"].append({
                "date": _day(day) if day is not None and not pd.isna(day) else None,
                "insider": str(r.get("Insider") or "").title(), "position": str(r.get("Position") or ""),
                "text": str(r.get("Text") or ""), "shares": _num(r.get("Shares")), "value": _num(r.get("Value")),
            })
    return out


def _calendar_day(value) -> str | None:
    if isinstance(value, list):
        value = value[0] if value else None
    if value is None:
        return None
    try:
        return _day(value)
    except (TypeError, ValueError):
        return None


def load(symbol: str, light: bool = False) -> dict:
    """Alle Daten einer Aktie. `light` (für den Hintergrundlauf über Tausende Aktien) spart die langsamen
    Abfragen für ISIN, Termine, Insider und Quartalsüberraschungen."""
    t = yf.Ticker(symbol)
    hist = t.history(period="max", auto_adjust=False, actions=True)
    if hist is None or hist.empty:
        raise SymbolNotFound(symbol)
    idx = hist.index.tz_localize(None) if hist.index.tz is not None else hist.index
    hist.index = idx.normalize()

    prices = [
        [_day(d), round(float(c), 6), round(float(a), 6)]
        for d, c, a in zip(hist.index, hist["Close"], hist["Adj Close"])
        if pd.notna(c) and pd.notna(a) and c > 0
    ]
    dividends = [[_day(d), float(v)] for d, v in hist["Dividends"].items() if v and v > 0] if "Dividends" in hist else []
    splits = [[_day(d), float(v)] for d, v in hist["Stock Splits"].items() if v and v > 0] if "Stock Splits" in hist else []

    raw_info = _safe(t.get_info, {}) or {}
    info = {k: raw_info.get(k) for k in INFO_KEYS}

    annual: dict[str, dict] = {}
    for df, mapping in ((_safe(lambda: t.income_stmt), INCOME_MAP),
                        (_safe(lambda: t.cashflow), CASHFLOW_MAP),
                        (_safe(lambda: t.balance_sheet), BALANCE_MAP)):
        for day, fields in _statement(df, mapping).items():
            annual.setdefault(day, {}).update(fields)
    annual = {d: f for d, f in annual.items() if f.get("eps") is not None or f.get("ocf") is not None}

    ttm = {}
    ttm.update(_first_column(_safe(lambda: t.ttm_income_stmt), INCOME_MAP))
    ttm.update(_first_column(_safe(lambda: t.ttm_cashflow), CASHFLOW_MAP))

    estimates = {}
    ee = _safe(lambda: t.earnings_estimate)
    if ee is not None and not ee.empty:
        for period in ("0y", "+1y"):
            if period in ee.index:
                r = ee.loc[period]
                estimates[period] = {
                    "avg": _num(r.get("avg")), "low": _num(r.get("low")), "high": _num(r.get("high")),
                    "year_ago": _num(r.get("yearAgoEps")), "analysts": _num(r.get("numberOfAnalysts")),
                    "growth": _num(r.get("growth")), "currency": r.get("currency") if isinstance(r.get("currency"), str) else None,
                }

    out = {
        "symbol": symbol,
        "v": RAW_VERSION,
        "light": light,
        "info": info,
        "prices": prices,
        "dividends": dividends,
        "splits": splits,
        "annual": annual,
        "ttm": ttm,
        "estimates": estimates,
        "revisions": _revisions(t),
    }
    if light:
        return out

    cal = _safe(lambda: t.calendar, {}) or {}
    cal = cal if isinstance(cal, dict) else {}
    isin = _safe(lambda: t.isin)
    out.update({
        "earnings_date": _calendar_day(cal.get("Earnings Date")),
        "ex_dividend_date": _calendar_day(cal.get("Ex-Dividend Date")),
        "dividend_pay_date": _calendar_day(cal.get("Dividend Date")),
        "isin": isin if isinstance(isin, str) and len(isin) == 12 else None,
        "surprises": _surprises(t),
        "insider": _insider(t),
    })
    return out


def fx_history(pair: str) -> list[list]:
    """Monatliche Schlusskurse eines Währungspaars wie 'DKKUSD=X'."""
    hist = yf.Ticker(pair).history(period="max", interval="1mo", auto_adjust=False)
    if hist is None or hist.empty:
        return []
    idx = hist.index.tz_localize(None) if hist.index.tz is not None else hist.index
    return [[_day(d), float(c)] for d, c in zip(idx, hist["Close"]) if pd.notna(c) and c > 0]
