"""Geschäftsentwicklung: Umsatz, Margen, Finanzkraft, Aktionäre und Analystenschätzungen.

Alle Beträge in Bilanzwährung, damit Wachstumsraten nicht von Wechselkursen abhängen. Umsatz, Nettoergebnis und
Free Cashflow reichen so weit zurück wie die Jahresberichte (SEC/ESEF bis über 15 Jahre); Brutto- und operative Marge
sowie F&E-Aufwand kommen nur aus den Yahoo-Abschlüssen (rund 4 Jahre).
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from .metrics import trend_stats

MAX_YEARS = 12  # so viele Geschäftsjahre in Diagramm und Tabelle
YEAR_GAP = (330, 400)  # Abstand zweier Geschäftsjahresenden in Tagen, damit ein Wachstum gegenüber Vorjahr gilt


def _ratio(a, b):
    return a / b if a is not None and b else None


def _margins(revenue, gross, operating, net, fcf, rnd, is_financial: bool) -> dict:
    rev = revenue if revenue and revenue > 0 else None
    return {
        "gross_margin": _ratio(gross, rev),
        "operating_margin": _ratio(operating, rev),
        "net_margin": _ratio(net, rev),
        # bei Banken und Versicherungen ist der Cashflow kaum aussagekräftig (siehe Hinweis im Profil)
        "fcf_margin": None if is_financial else _ratio(fcf, rev),
        "rnd_ratio": _ratio(rnd, rev),
    }


def _years(annual: list[dict], is_financial: bool) -> list[dict]:
    rows, prev = [], None
    for r in annual:
        if r.get("fin_revenue") is None and r.get("fin_net") is None:
            continue
        growth = None
        if prev is not None and prev.get("fin_revenue") and prev["fin_revenue"] > 0 and r.get("fin_revenue") is not None:
            gap = (r["end"] - prev["end"]).days
            if YEAR_GAP[0] <= gap <= YEAR_GAP[1]:
                growth = r["fin_revenue"] / prev["fin_revenue"] - 1
        rows.append({
            "end": r["end"].strftime("%Y-%m-%d"), "revenue": r.get("fin_revenue"), "growth": growth,
            "net_income": r.get("fin_net"), "fcf": None if is_financial else r.get("fin_fcf"),
            **_margins(r.get("fin_revenue"), r.get("fin_gross"), r.get("fin_operating"), r.get("fin_net"),
                       r.get("fin_fcf"), r.get("fin_rnd"), is_financial),
        })
        prev = r
    return rows[-MAX_YEARS:]


def _balance(statements: dict, info: dict, fcf_ttm: float | None, is_financial: bool) -> dict:
    """Kasse, Schulden und Eigenkapitalquote. Kasse und Schulden nach dem letzten Quartal (Yahoo-Stammdaten),
    Eigenkapitalquote aus der letzten Jahresbilanz. Reichweite: so viele Jahre deckt die Kasse einen negativen
    Free Cashflow der letzten 12 Monate."""
    last = next(((end, s) for end, s in sorted(statements.items(), reverse=True) if s.get("total_assets")), (None, {}))
    end, s = last
    cash = info.get("totalCash") if info.get("totalCash") is not None else s.get("cash")
    debt = info.get("totalDebt") if info.get("totalDebt") is not None else s.get("total_debt")
    runway = None
    if not is_financial and fcf_ttm is not None and fcf_ttm < 0 and cash is not None:
        runway = cash / -fcf_ttm
    return {
        "date": end, "cash": cash, "debt": debt,
        # bei Banken und Versicherungen gehören Kundengelder und Kapitalanlagen zur Kasse: keine sinnvolle Nettoliquidität
        "net_cash": cash - debt if cash is not None and debt is not None and not is_financial else None,
        "equity": s.get("equity"), "equity_ratio": _ratio(s.get("equity"), s.get("total_assets")),
        "fcf_ttm": None if is_financial else fcf_ttm, "runway_years": runway,
    }


def _fiscal_year(key: str, info: dict, annual: list[dict]) -> int | None:
    """Kalenderjahr, in dem das Geschäftsjahr der Schätzung endet („0y“ = laufendes, „+1y“ = nächstes)."""
    offset = 0 if key == "0y" else 1
    nxt = info.get("nextFiscalYearEnd")
    if isinstance(nxt, (int, float)):
        return dt.datetime.fromtimestamp(nxt, dt.timezone.utc).year + offset
    if annual:
        return annual[-1]["end"].year + 1 + offset
    return None


def _estimates(revenue_est: dict, eps_est: dict, info: dict, annual: list[dict], fin_rate) -> list[dict]:
    out = []
    for key in ("0y", "+1y"):
        r, e = revenue_est.get(key) or {}, eps_est.get(key) or {}
        if not r.get("avg") and e.get("avg") is None:
            continue
        factor = fin_rate(r.get("currency")) if r else 1.0

        def conv(x):
            return x * factor if x is not None and factor is not None else None

        out.append({
            "key": key, "year": _fiscal_year(key, info, annual),
            "revenue": conv(r.get("avg")), "revenue_low": conv(r.get("low")), "revenue_high": conv(r.get("high")),
            "revenue_growth": r.get("growth"), "revenue_analysts": r.get("analysts"),
            # Gewinn je Aktie in der Währung der Schätzung (bei ADRs oft nicht die Bilanzwährung)
            "eps": e.get("avg"), "eps_low": e.get("low"), "eps_high": e.get("high"), "eps_year_ago": e.get("year_ago"),
            "eps_analysts": e.get("analysts"), "eps_currency": e.get("currency"),
        })
    return out


def build(annual: list[dict], raw: dict, info: dict, ttm_fcf: float | None, fin_ccy: str | None,
          fin_rate, is_financial: bool) -> dict:
    """`annual`: zusammengeführte Jahreswerte (mit fin_*-Feldern), `raw`: Yahoo-Rohdaten, `ttm_fcf`: Free Cashflow
    der letzten 12 Monate in Bilanzwährung, `fin_rate(ccy)`: Umrechnungsfaktor einer Währung in die Bilanzwährung."""
    years = _years(annual, is_financial)
    t = raw.get("ttm") or {}
    ttm_revenue = t.get("revenue")
    ttm = {"revenue": ttm_revenue, "net_income": t.get("net_income"), "fcf": None if is_financial else ttm_fcf,
           **_margins(ttm_revenue, t.get("gross_profit"), t.get("operating_income"), t.get("net_income"), ttm_fcf,
                      t.get("rnd"), is_financial)}
    revenue_pts = [(pd.Timestamp(y["end"]), y["revenue"]) for y in years if y["revenue"] and y["revenue"] > 0]
    trend = trend_stats(revenue_pts)
    profits = [y["net_income"] for y in years if y["net_income"] is not None]
    return {
        "currency": fin_ccy,
        "years": years,
        "ttm": ttm,
        "revenue_trend": {"growth": trend["growth"], "stability": trend["stability"], "years": trend["years"]},
        "loss_years": sum(v <= 0 for v in profits), "profit_years": len(profits),
        "balance": _balance(raw.get("annual") or {}, info, ttm_fcf, is_financial),
        "holders": raw.get("holders") or {},
        "estimates": _estimates(raw.get("revenue_estimates") or {}, raw.get("estimates") or {}, info, annual, fin_rate),
    }
