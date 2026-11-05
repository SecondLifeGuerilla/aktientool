"""Setzt die Rohdaten aller Quellen zu einem vollständigen Aktien-Profil zusammen."""

from __future__ import annotations

import datetime as dt
import logging
import math

import numpy as np
import pandas as pd

from . import config
from .analysis import business, dcf, fundamentals, metrics, scorecard, summary, tax, valuation
from .analysis import dividends as dividends_mod
from .cache import cache_age, cached, peek
from .names import SECTORS, industry_de
from .sources import esef, fx, sec, shorts, yahoo

log = logging.getLogger(__name__)

COUNTRIES = {
    "United States": "USA", "Germany": "Deutschland", "United Kingdom": "Großbritannien", "France": "Frankreich",
    "Switzerland": "Schweiz", "Netherlands": "Niederlande", "Denmark": "Dänemark", "Sweden": "Schweden",
    "Norway": "Norwegen", "Finland": "Finnland", "Spain": "Spanien", "Italy": "Italien", "Austria": "Österreich",
    "Belgium": "Belgien", "Ireland": "Irland", "Japan": "Japan", "China": "China", "Canada": "Kanada",
    "Australia": "Australien", "Taiwan": "Taiwan", "South Korea": "Südkorea", "Luxembourg": "Luxemburg",
}
# Yahoo-Ländername -> ISO-Code (für die Quellensteuer, wenn die ISIN fehlt oder offshore ist)
REVERSE_COUNTRIES = {
    "United States": "US", "Germany": "DE", "United Kingdom": "GB", "France": "FR", "Switzerland": "CH",
    "Netherlands": "NL", "Denmark": "DK", "Sweden": "SE", "Norway": "NO", "Finland": "FI", "Spain": "ES", "Italy": "IT",
    "Austria": "AT", "Belgium": "BE", "Ireland": "IE", "Japan": "JP", "China": "CN", "Hong Kong": "HK", "Canada": "CA",
    "Australia": "AU", "Taiwan": "TW", "South Korea": "KR", "Luxembourg": "LU", "Singapore": "SG", "India": "IN",
    "Brazil": "BR", "Mexico": "MX", "Israel": "IL", "Portugal": "PT", "Poland": "PL",
}
SOURCE_NAMES = {"SEC": "SEC EDGAR", "ESEF": "ESEF-Jahresberichte", "Yahoo": "Yahoo Finance"}
OFFSHORE_ISIN = {"KY", "BM", "VG", "JE", "GG", "IM"}  # Holding-Sitze; das Land steckt dann nicht in der ISIN
MATCH_DAYS = 20  # Toleranz beim Zusammenführen von Geschäftsjahresenden aus mehreren Quellen


def _clean(obj):
    """NaN/Inf -> None und numpy-Typen -> Python, damit das Ergebnis sauberes JSON ist."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return f if math.isfinite(f) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (pd.Timestamp, dt.date)):
        return obj.strftime("%Y-%m-%d")
    return obj


def _per_share_row(src: dict, end: str, flow_ccy: str | None, eps_ccy: str | None,
                   conv: fx.Converter, source: str, fin: fx.Converter) -> dict:
    """Werte je Aktie in Kurswährung (`conv`), Umsatz, Ergebnisse und F&E zusätzlich absolut in Bilanzwährung
    (`fin`, Felder fin_*): Wachstumsraten sollen nicht von Wechselkursen abhängen."""
    shares = src.get("shares")
    ocf, capex = src.get("ocf"), src.get("capex")
    fcf = src.get("fcf")
    if fcf is None and ocf is not None and capex is not None:
        fcf = ocf - abs(capex)

    def ps(amount):
        return conv.convert(amount / shares, flow_ccy, end) if amount is not None and shares else None

    def total(amount):
        return fin.convert(amount, flow_ccy, end)

    return {
        "end": pd.Timestamp(end),
        "source": source,
        "eps": conv.convert(src.get("eps"), eps_ccy or flow_ccy, end),
        "eps_adj": ps(src.get("normalized_income")),
        "ocf_ps": ps(ocf),
        "fcf_ps": ps(fcf),
        "rev_ps": ps(src.get("revenue")),
        "revenue": conv.convert(src.get("revenue"), flow_ccy, end),
        "shares": shares,
        "fin_revenue": total(src.get("revenue")),
        "fin_gross": total(src.get("gross_profit")),
        "fin_operating": total(src.get("operating_income")),
        "fin_net": total(src.get("net_income")),
        "fin_fcf": total(fcf),
        "fin_rnd": total(src.get("rnd")),
    }


def merge_annual(yahoo_annual: dict, fin_ccy: str | None, filings: list[tuple[str, list[dict]]],
                 conv: fx.Converter) -> list[dict]:
    """Jahreswerte aus Pflichtberichten (`filings`: [("SEC", rows), ("ESEF", rows)], in dieser Rangfolge) und Yahoo.
    Eine spätere Quelle füllt nur Lücken desselben Geschäftsjahres oder ergänzt fehlende Jahre."""
    fin = fx.Converter(fin_ccy)
    sources = [(name, [_per_share_row(r, r["end"], r.get("currency"), r.get("eps_currency"), conv, name, fin) for r in rows])
               for name, rows in filings]
    sources.append(("Yahoo", [_per_share_row(f, end, fin_ccy, fin_ccy, conv, "Yahoo", fin) for end, f in yahoo_annual.items()]))
    rows: list[dict] = []
    for name, new_rows in sources:
        for y in new_rows:
            match = next((r for r in rows if abs((r["end"] - y["end"]).days) <= MATCH_DAYS), None)
            if match is None:
                rows.append(y)
                continue
            filled = False
            for k, v in y.items():
                if match.get(k) is None and v is not None:
                    match[k] = v
                    filled = True
            if filled and name not in match["source"]:
                match["source"] = f"{match['source']} + {name}"
    horizon = pd.Timestamp.today() - pd.DateOffset(years=25)
    rows = [r for r in rows if r["end"] >= horizon and (r["eps"] is not None or r["ocf_ps"] is not None)]
    return sorted(rows, key=lambda r: r["end"])


def _ttm(raw: dict, info: dict, annual: list[dict], fin_ccy: str | None, conv: fx.Converter, price: float) -> dict:
    """Werte der letzten 12 Monate je Aktie in Kurswährung."""
    ttm_raw = raw.get("ttm", {})
    shares = next((r["shares"] for r in reversed(annual) if r.get("shares")), None)
    shares = shares or info.get("impliedSharesOutstanding") or info.get("sharesOutstanding")
    pe = info.get("trailingPE")
    # Kurs / KGV liefert den Gewinn je Aktie sicher in Kurswährung (auch bei ADRs und Pence-Kursen)
    eps = price / pe if pe and pe > 0 else conv.convert(info.get("trailingEps"), fin_ccy)

    def ps(amount):
        return conv.convert(amount / shares, fin_ccy) if amount is not None and shares else None

    ocf = ttm_raw.get("ocf", info.get("operatingCashflow"))
    capex = ttm_raw.get("capex")
    fcf = ttm_raw.get("fcf")
    if fcf is None and ocf is not None and capex is not None:
        fcf = ocf - abs(capex)
    return {"eps": eps, "eps_adj": ps(ttm_raw.get("normalized_income")), "ocf_ps": ps(ocf), "fcf_ps": ps(fcf),
            "rev_ps": ps(ttm_raw.get("revenue")), "fcf_total": fcf}


def _debt_years(info: dict, fcf_total: float | None, is_financial: bool) -> dict:
    debt, cash = info.get("totalDebt"), info.get("totalCash")
    if is_financial or debt is None:
        return {"years": None, "net_debt": None, "applicable": not is_financial}
    net = debt - (cash or 0)
    if net <= 0:
        years = 0.0
    elif not fcf_total or fcf_total <= 0:
        years = math.inf
    else:
        years = net / fcf_total
    # JSON kennt kein Unendlich: "infinite" markiert Schulden ohne positiven Free Cashflow
    return {"years": years, "infinite": math.isinf(years), "net_debt": net, "applicable": True}


def _unrated(val: dict) -> bool:
    """Fairer Wert vorhanden, aber ohne Einordnung (Kennzahl gerade eingebrochen oder zu kurze Historie)."""
    return bool(val.get("dip_now") or val.get("short_history"))


def _quality(annual: list[dict], estimates: dict, today: pd.Timestamp) -> dict:
    """Gewinnstabilität und -wachstum. Bereinigter Gewinn, wenn er mindestens so lange vorliegt wie der bilanzierte."""
    eps = [(r["end"], r["eps"]) for r in annual if r.get("eps") is not None]
    adj = [(r["end"], r["eps_adj"]) for r in annual if r.get("eps_adj") is not None]
    key, pts, label = ("eps_adj", adj, "bereinigten Gewinn") if adj and len(adj) >= len(eps) else ("eps", eps, "bilanzierten Gewinn")
    stats = metrics.trend_stats(pts)
    other = metrics.trend_stats(eps if key == "eps_adj" else adj)
    # überwiegend Verluste: keine Gewinnstabilität (zählt in Scorecard und Filtern wie ein fehlender Wert)
    loss_making = metrics.mostly_losses(stats)
    if loss_making:
        stats["stability"] = None
    e0 = estimates.get("0y") or {}
    forecast_growth = None
    if e0.get("avg") and e0.get("year_ago") and e0["year_ago"] > 0:
        forecast_growth = e0["avg"] / e0["year_ago"] - 1
    return {
        "basis": key, "basis_label": label, **stats,
        "short": stats["stability"] is not None and metrics.is_short(stats["years"]),
        "loss_making": loss_making,
        "other_stability": None if metrics.mostly_losses(other) else other["stability"],
        "forecast_growth": forecast_growth,
        "points": [[d, v] for d, v in pts],
        "forecasts": valuation.forecast_points(pts[-1] if pts else None, estimates, today),
    }


def _load_raw(symbol: str, refresh: bool, light: bool) -> dict:
    """Yahoo-Rohdaten aus dem Cache. Ein im Hintergrundlauf (light) geladener Datensatz reicht fürs Profil nicht
    (ohne Termine, ISIN, Insider) und wird dann vollständig nachgeladen."""
    key = f"yahoo_{symbol}"
    if light:
        # Hintergrundlauf: vorhandenen Cache nutzen, aber nichts speichern (6.000 Kurshistorien wären Gigabytes)
        age = cache_age(key)
        raw = peek(key) if not refresh and age is not None and age < config.TTL_YAHOO else None
        return raw if raw and raw.get("v") == yahoo.RAW_VERSION else yahoo.load(symbol, light=True)
    raw = cached(key, config.TTL_YAHOO, lambda: yahoo.load(symbol), refresh)
    if raw.get("v") != yahoo.RAW_VERSION or raw.get("light"):
        raw = cached(key, config.TTL_YAHOO, lambda: yahoo.load(symbol), refresh=True)
    return raw


def _isin(symbol: str, raw: dict, info: dict, known: str | None) -> str | None:
    """ISIN der Heimatnotierung. yfinance sucht sie bei Business Insider und erwischt dort manchmal ein Zertifikat
    (LVMH: kanadische, Snowflake: argentinische ISIN); die Weltauswahl hat sie direkt aus Yahoos Screener."""
    if known:
        return known
    try:
        from . import world  # erst hier: die Weltauswahl braucht service nicht, aber beim Start ist sie oft noch leer
        row = world.stock(symbol)
        if row and row.get("isin"):
            return row["isin"]
    except Exception as e:
        log.info("ISIN aus der Weltauswahl nicht verfügbar: %s", e)
    isin = raw.get("isin")
    expected = REVERSE_COUNTRIES.get(info.get("country"))
    if isin and (expected is None or isin[:2] == expected or isin[:2] in OFFSHORE_ISIN):
        return isin
    return None


def _filings(symbol: str, info: dict, isin: str | None, splits: list, warnings: list) -> tuple[list, int | None]:
    """Pflichtberichte: SEC (US-Firmen und Firmen mit US-Listing), sonst ESEF (europäische Firmen ab 2020)."""
    out, cik = [], None
    try:
        cik = sec.find_cik(symbol, info.get("longName") or info.get("shortName"))
        if cik:
            rows = sec.annual_rows(cik, splits)
            if rows:
                out.append(("SEC", rows))
    except Exception as e:  # SEC nicht erreichbar: mit den übrigen Daten weitermachen
        log.warning("SEC-Daten für %s nicht verfügbar: %s", symbol, e)
        warnings.append("SEC EDGAR war nicht erreichbar; es werden nur die übrigen Jahresabschlüsse verwendet.")
    if not out and esef.covers(isin):
        fye = info.get("lastFiscalYearEnd")
        fy_month = dt.datetime.fromtimestamp(fye, dt.timezone.utc).month if isinstance(fye, (int, float)) else None
        try:
            rows = esef.annual_rows(isin, splits, fy_month)
            if rows:
                out.append(("ESEF", rows))
        except Exception as e:
            log.warning("ESEF-Daten für %s nicht verfügbar: %s", symbol, e)
            warnings.append("Die ESEF-Jahresberichte (filings.xbrl.org) waren nicht erreichbar.")
    return out, cik


def _country_code(isin: str | None, info: dict) -> str | None:
    """Sitzland für die Quellensteuer: laut ISIN, bei Offshore-Holdings (Kaimaninseln …) laut Yahoo-Land."""
    cc = (isin or "")[:2].upper()
    if cc and cc not in OFFSHORE_ISIN:
        return cc
    return REVERSE_COUNTRIES.get(info.get("country"))


def build_profile(symbol: str, refresh: bool = False, light: bool = False, isin: str | None = None) -> dict:
    """Vollständiges Profil. `light` (Hintergrundlauf): weniger Yahoo-Abfragen; `isin` hilft, wenn Yahoo keine liefert."""
    symbol = symbol.strip().upper()
    raw = _load_raw(symbol, refresh, light)
    info = raw["info"]
    isin = _isin(symbol, raw, info, isin)
    quote_ccy = info.get("currency")
    fin_ccy = info.get("financialCurrency") or fx.split_currency(quote_ccy)[0]
    conv = fx.Converter(quote_ccy)

    prices = pd.DataFrame(raw["prices"], columns=["date", "close", "adj"])
    prices.index = pd.to_datetime(prices.pop("date"))
    close, adj = prices["close"], prices["adj"]
    today = close.index[-1]
    price = info.get("currentPrice") or info.get("regularMarketPrice") or float(close.iloc[-1])
    is_financial = info.get("sector") == "Financial Services"

    warnings = []
    filings, sec_cik = _filings(symbol, info, isin, raw.get("splits", []), warnings)
    annual = merge_annual(raw.get("annual", {}), fin_ccy, filings, conv)
    ttm = _ttm(raw, info, annual, fin_ccy, conv, price)

    # Analystenschätzungen in Kurswährung umrechnen
    estimates = {}
    for k, e in (raw.get("estimates") or {}).items():
        factor = conv.rate(e.get("currency") or fin_ccy) or 1.0
        estimates[k] = {**e, **{f: (e[f] * factor if e.get(f) is not None else None)
                                for f in ("avg", "low", "high", "year_ago")}}

    quality = _quality(annual, estimates, today)
    div = dividends_mod.build(raw.get("dividends", []), close, price, ttm["eps"], ttm["fcf_ps"])
    div_yield = div.get("yield") if div.get("pays") else 0.0
    val = valuation.build(close, price, annual, ttm, estimates, div_yield or 0.0)
    debt = _debt_years(info, ttm["fcf_total"], is_financial)
    mom = metrics.momentum(close)

    period = val.get("periods", {}).get(val.get("default_period")) if val.get("available") else None
    # bei gerade eingebrochener Kennzahl oder kurzer Historie ist die Abweichung vom fairen Wert nicht aussagekräftig
    deviation = period["deviation"] if period and not _unrated(val) else None
    score_values = {
        "earnings_stability": quality["stability"], "earnings_growth": quality["growth"],
        "debt_years": debt["years"], "momentum": mom, "discount": scorecard.discount_score(deviation),
        "div_yield": div_yield,
        "div_stability": div.get("stability") if div.get("pays") else 0.0,
        "div_growth": div.get("growth") if div.get("pays") else 0.0,
    }
    cards = scorecard.build(score_values, years={
        "earnings_stability": quality["years"], "earnings_growth": quality["years"],
        "div_stability": div.get("stats_years"), "div_growth": div.get("stats_years"),
    })

    fund_years = sorted({r["end"].year for r in annual})
    if len(fund_years) < 6:
        warnings.append(f"Nur {len(fund_years)} Jahre Fundamentaldaten verfügbar (kostenlose Quelle). Gewinnstabilität "
                        "und -wachstum zählen in der Scorecard deshalb höchstens neutral, und die Aktie wird nicht als "
                        "über- oder unterbewertet eingeordnet.")
    quote_major = fx.split_currency(quote_ccy)[0]
    if fin_ccy and quote_major and fin_ccy != quote_major:
        warnings.append(f"Bilanzwährung {fin_ccy}, Kurswährung {quote_major}: Fundamentaldaten wurden zum Wechselkurs "
                        "am jeweiligen Stichtag umgerechnet. Bei ADRs kann das Bezugsverhältnis die Werte je Aktie verzerren.")
    if is_financial:
        warnings.append("Bei Banken und Versicherungen sind operativer Cashflow und Verschuldung kaum aussagekräftig.")

    country_code = _country_code(isin, info)
    short_positions = None
    if not light and isin:
        try:
            short_positions = shorts.for_isin(isin)
        except Exception as e:  # Bundesanzeiger nicht erreichbar: Profil trotzdem liefern
            log.info("Leerverkaufspositionen nicht verfügbar: %s", e)

    prev = info.get("regularMarketPreviousClose")
    target = info.get("targetMeanPrice")
    statements = raw.get("annual", {})
    sources = [name for name, _ in filings] + ["Yahoo"]
    profile = {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or symbol,
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "currency": quote_ccy,
        "facts": {
            "country": COUNTRIES.get(info.get("country"), info.get("country")),
            "country_code": country_code,
            "sector": SECTORS.get(info.get("sector"), info.get("sector")),
            "industry": industry_de(info.get("industry")),
            "employees": info.get("fullTimeEmployees"),
            "website": info.get("website"),
            "isin": isin,
            "market_cap": info.get("marketCap"),
            "price": price,
            "change": price / prev - 1 if prev else None,
            "dividend_yield": div_yield,
            "earnings_date": raw.get("earnings_date"),
            "ex_dividend_date": raw.get("ex_dividend_date"),
            "dividend_pay_date": raw.get("dividend_pay_date"),
            "description": info.get("longBusinessSummary"),
        },
        "data": {
            "fundamentals_source": " + ".join(SOURCE_NAMES[s] for s in sources),
            "sec_cik": sec_cik,
            "fundamental_years": [fund_years[0], fund_years[-1]] if fund_years else None,
            "financial_currency": fin_ccy,
            "price_start": close.index[0].strftime("%Y-%m-%d"),
            "last_price_date": today.strftime("%Y-%m-%d"),
            "age_seconds": cache_age(f"yahoo_{symbol}"),
            "warnings": warnings,
        },
        "annual": [{k: v for k, v in r.items() if k != "shares"} for r in annual],
        "ttm": {k: v for k, v in ttm.items() if k != "fcf_total"},
        "quality": quality,
        "business": business.build(annual, raw, info, ttm["fcf_total"], fin_ccy, fx.Converter(fin_ccy).rate, is_financial),
        "fundamentals": {
            "roic": fundamentals.roic(statements, is_financial),
            "piotroski": fundamentals.piotroski(statements),
            "shares": fundamentals.share_trend(annual),
            "fcf_yield": ttm["fcf_ps"] / price if ttm.get("fcf_ps") is not None and price else None,
        },
        "price": {
            "series": raw["prices"],
            "returns": metrics.period_returns(close, adj, today),
            "ath": metrics.all_time_high(close),
            "momentum": mom,
            "momentum_12_1": metrics.momentum_12_1(close),
        },
        "valuation": val,
        "dcf": dcf.build(ttm.get("fcf_ps"), [r["fcf_ps"] for r in annual if r.get("fcf_ps") is not None], price, is_financial),
        "dividends": div,
        "tax": tax.for_country(country_code),
        "debt": debt,
        "analysts": {
            "target_mean": target, "target_low": info.get("targetLowPrice"), "target_high": info.get("targetHighPrice"),
            "count": info.get("numberOfAnalystOpinions"), "recommendation": info.get("recommendationKey"),
            "upside": target / price - 1 if target and price else None,
            "revisions": fundamentals.revisions(raw.get("revisions")),
            "surprises": fundamentals.surprises(raw.get("surprises")),
        },
        "insider": raw.get("insider"),
        "shorts": short_positions,
        "scorecard": cards,
        "summary": summary.build(quality, period["rating"] if period else None, mom, cards),
    }
    return _clean(profile)


def summary_row(symbol: str, refresh: bool = False, light: bool = False, isin: str | None = None) -> dict:
    """Kompakte Zeile für Screener, Watchlist, Depot und den Hintergrundlauf über die Weltauswahl."""
    p = build_profile(symbol, refresh, light, isin)
    val = p["valuation"]
    period = val["periods"].get(val["default_period"]) if val.get("available") and val.get("default_period") else None
    div = p["dividends"]
    f = p["fundamentals"]
    unrated = _unrated(val)
    return {
        "symbol": p["symbol"], "name": p["name"], "currency": p["currency"],
        "country": p["facts"]["country"], "country_code": p["facts"]["country_code"], "sector": p["facts"]["sector"],
        "industry": p["facts"]["industry"], "isin": p["facts"]["isin"],
        "market_cap": p["facts"]["market_cap"], "price": p["facts"]["price"],
        "earnings_stability": p["quality"]["stability"], "earnings_growth": p["quality"]["growth"],
        "fundamental_points": p["quality"]["count"], "quality_years": p["quality"]["years"],
        "quality_short": p["quality"]["short"],
        "fundamentals_source": p["data"]["fundamentals_source"],
        "div_yield": p["facts"]["dividend_yield"],
        "div_ttm": div.get("ttm") if div.get("pays") else 0.0,
        "div_growth": div.get("growth") if div.get("pays") else None,
        "div_stability": div.get("stability") if div.get("pays") else None,
        "div_streak": div.get("increase_streak") if div.get("pays") else 0,
        "div_payment_months": sorted({int(d[5:7]) for d, _ in div.get("payments", [])
                                      if d >= (pd.Timestamp.today() - pd.DateOffset(years=1)).strftime("%Y-%m-%d")}),
        "payout": div.get("payout_eps") if div.get("pays") else None,
        "net_dividend_share": p["tax"]["net_share"],
        "debt_years": p["debt"]["years"],
        "debt_infinite": p["debt"].get("infinite", False),
        "momentum": p["price"]["momentum"],
        "momentum_12_1": p["price"]["momentum_12_1"],
        "fair_value": period["fair_value"] if period else None,
        "valuation_basis": val.get("metric_key") if val.get("available") else None,
        "deviation": period["deviation"] if period and not unrated else None,
        "rating": period["rating"] if period else None,
        "expected_return": (val.get("expected") or {}).get("by_period", {}).get(val.get("default_period"))
        if period and not unrated else None,
        "implied_growth": (p["dcf"].get("rates") or {}).get("0.09"),
        "fcf_yield": f["fcf_yield"],
        "roic": f["roic"]["latest"],
        "piotroski": f["piotroski"]["score"],
        "share_cagr": f["shares"]["cagr"],
        "revisions_90d": p["analysts"]["revisions"]["change90"],
        "earnings_date": p["facts"]["earnings_date"],
        "ex_dividend_date": p["facts"]["ex_dividend_date"],
        "dividend_pay_date": p["facts"]["dividend_pay_date"],
        "scores": {s["key"]: s["score"] for s in p["scorecard"]},
    }
