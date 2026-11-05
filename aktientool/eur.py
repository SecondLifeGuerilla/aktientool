"""Anzeige in Euro: Profile, Kennzahlenzeilen und Kurse für die Oberfläche umrechnen.

Intern rechnet das Tool weiter in der Kurswährung (Bewertung, Scores, Weltauswahl, Tiefenanalyse); erst die API
rechnet für die Anzeige um:
- Kurse und alles, was im selben Diagramm wie der Kurs steht (Linie des fairen Werts), zum Wechselkurs des
  jeweiligen Tages, wie ein Euro-Chart beim Broker. Renditen und Allzeithoch werden daraus neu berechnet.
- Aktuelle Werte (Kurs, Börsenwert, fairer Wert, Kursziel, Schätzungen) zum aktuellen Wechselkurs.
- Jahreswerte (Gewinn, Umsatz, Cashflow, Dividende je Jahr) ebenfalls zum aktuellen Wechselkurs, damit die
  Wachstumsraten im Bild zu den berechneten passen und nicht von Wechselkursschwankungen verzerrt werden.
Momentum und Scores bleiben in der Kurswährung, damit sie zur Weltauswahl passen.
Ist kein Wechselkurs zu bekommen, bleibt alles in der Originalwährung und `eur` ist None.
"""

from __future__ import annotations

import copy

import pandas as pd

from .analysis import metrics
from .service import _clean
from .sources import fx

PER_SHARE = ("eps", "eps_adj", "ocf_ps", "fcf_ps", "rev_ps")


def _scale(obj: dict | None, keys, rate: float | None) -> None:
    if not obj:
        return
    for k in keys:
        if obj.get(k) is not None:
            obj[k] = obj[k] * rate if rate is not None else None


def _scale_points(points, rate: float, index: int = 1) -> list:
    return [[*p[:index], p[index] * rate if p[index] is not None else None, *p[index + 1:]] for p in points or []]


def profile(p: dict) -> dict:
    quote_ccy = p.get("currency")
    fin_ccy = p["data"].get("financial_currency")
    biz = p.get("business") or {}
    # Schätzungen je Aktie kommen in der Währung der Analysten (bei ADRs oft nicht die Bilanzwährung)
    est_ccy = next((e.get("eps_currency") for e in biz.get("estimates") or [] if e.get("eps_currency")), None) or fin_ccy
    rates = fx.eur_quotes([c for c in {quote_ccy, fin_ccy, biz.get("currency"), est_ccy, "USD"} if c])
    to = fx.ToEur(quote_ccy, now=rates.get(quote_ccy) or {})
    if to.now is None:
        return {**p, "eur": None}
    original_price = p["facts"].get("price")
    # auch bei Euro-Kursen kann die Bilanz in einer anderen Währung sein (dann wird nur sie umgerechnet)
    p = copy.deepcopy(p)
    biz = p.get("business") or {}
    rate = to.now
    rate_of = lambda ccy: (rates.get(ccy) or {}).get("rate")  # noqa: E731
    fin_rate = rate_of(fin_ccy)

    f = p["facts"]
    _scale(f, ("price",), rate)
    _scale(f, ("market_cap",), rate * to.factor)  # Yahoo gibt den Börsenwert in der Hauptwährung an (Pfund, nicht Pence)
    if f.get("change") is not None:
        f["change"] = (1 + f["change"]) * (1 + to.change) - 1  # inklusive Bewegung des Wechselkurses seit gestern

    for row in p.get("annual") or []:
        _scale(row, (*PER_SHARE, "revenue"), rate)
        _scale(row, [k for k in row if k.startswith("fin_")], fin_rate)
    _scale(p.get("ttm"), PER_SHARE, rate)

    q = p.get("quality") or {}
    q["points"] = _scale_points(q.get("points"), rate)
    for fc in q.get("forecasts") or []:
        _scale(fc, ("avg", "low", "high"), rate)

    if biz:
        brate = rate_of(biz.get("currency")) or fin_rate
        for y in biz.get("years") or []:
            _scale(y, ("revenue", "net_income", "fcf"), brate)
        _scale(biz.get("ttm"), ("revenue", "net_income", "fcf"), brate)
        _scale(biz.get("balance"), ("cash", "debt", "net_cash", "equity", "fcf_ttm"), brate)
        for e in biz.get("estimates") or []:
            _scale(e, ("revenue", "revenue_low", "revenue_high"), brate)
            _scale(e, ("eps", "eps_low", "eps_high", "eps_year_ago"), rate_of(e.get("eps_currency")) or rate_of(est_ccy))
            e["eps_currency"] = "EUR"
        biz["currency"] = "EUR"

    # Kursverlauf zum Tageskurs; Renditen und Allzeithoch daraus neu
    pr = p["price"]
    series = pr.get("series") or []
    if series and not to.is_euro:
        day_rates = to.at([r[0] for r in series])
        pr["series"] = [[d, c * r, a * r] for (d, c, a), r in zip(series, day_rates)]
        idx = pd.to_datetime([r[0] for r in pr["series"]])
        close = pd.Series([r[1] for r in pr["series"]], index=idx)
        adj = pd.Series([r[2] for r in pr["series"]], index=idx)
        pr["returns"] = metrics.period_returns(close, adj, idx[-1])
        pr["ath"] = metrics.all_time_high(close)

    v = p.get("valuation") or {}
    _scale(v, ("current_value",), rate)
    for per in (v.get("periods") or {}).values():
        _scale(per, ("fair_value",), rate)
    if v.get("metric_series") and not to.is_euro:
        # im Diagramm neben dem Kurs: zum selben Tageskurs, damit Kurs und fairer Wert vergleichbar bleiben
        day_rates = to.at([d for d, _ in v["metric_series"]])
        v["metric_series"] = [[d, m * r if m is not None else None] for (d, m), r in zip(v["metric_series"], day_rates)]
    for m in v.get("multiples") or []:
        _scale(m, ("current_value",), rate)
    for fc in v.get("forecasts") or []:
        _scale(fc, ("avg", "low", "high"), rate)

    _scale(p.get("dcf"), ("fcf",), rate)
    d = p.get("dividends") or {}
    _scale(d, ("ttm",), rate)
    d["per_year"] = _scale_points(d.get("per_year"), rate)
    d["payments"] = _scale_points(d.get("payments"), rate)
    _scale(p.get("debt"), ("net_debt",), fin_rate)

    a = p.get("analysts") or {}
    _scale(a, ("target_mean", "target_low", "target_high"), rate)
    for per in ((a.get("revisions") or {}).get("periods") or {}).values():
        _scale(per, ("now",), rate_of(est_ccy))
    for sq in (a.get("surprises") or {}).get("quarters") or []:
        _scale(sq, ("actual", "estimate"), rate_of(est_ccy))
    for t in (p.get("insider") or {}).get("transactions") or []:
        _scale(t, ("value",), rate_of("USD"))  # Insidergeschäfte meldet Yahoo nur für US-Aktien, in Dollar

    p["currency"] = "EUR"
    hist = to.history()
    p["eur"] = {
        "original_currency": quote_ccy, "original_price": original_price, "rate": rate,
        "historical": not hist.empty, "history_start": hist.index[0].strftime("%Y-%m-%d") if not hist.empty else None,
        "financial_currency": fin_ccy,
    }
    return _clean(p)


def summary(row: dict) -> dict:
    """Kennzahlenzeile (Screener, Watchlist, Depot, Termine) zum aktuellen Kurs in Euro."""
    ccy = row.get("currency")
    info = fx.eur_quotes([ccy]).get(ccy)
    if not info:
        return {**row, "original_currency": ccy, "eur_rate": None}
    rate = info["rate"]
    out = {**row, "currency": "EUR", "original_currency": ccy, "eur_rate": rate}
    _scale(out, ("price", "fair_value", "div_ttm"), rate)
    _scale(out, ("market_cap",), rate * fx.split_currency(ccy)[1])  # Börsenwert in der Hauptwährung
    return out


def quotes(items: list[dict]) -> list[dict]:
    """Live-Kurse in Euro. Die Tagesveränderung enthält die Bewegung des Wechselkurses seit dem Vortag."""
    rates = fx.eur_quotes(list({q.get("currency") for q in items if q.get("currency")}))
    out = []
    for q in items:
        ccy = q.get("currency")
        info = rates.get(ccy)
        if not info:
            out.append({**q, "original_currency": ccy, "eur_rate": None})
            continue
        price = q.get("price")
        change = q.get("change")
        out.append({**q, "currency": "EUR", "original_currency": ccy, "original_price": price, "eur_rate": info["rate"],
                    "price": price * info["rate"] if price is not None else None,
                    "change": (1 + change) * (1 + info["change"]) - 1 if change is not None else None})
    return out
