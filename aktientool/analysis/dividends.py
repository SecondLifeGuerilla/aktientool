"""Dividenden-Profil: Historie, Wachstum, Stabilität, Ausschüttungsquote und Rendite im historischen Vergleich."""

from __future__ import annotations

import pandas as pd

from .metrics import cagr, trend_stats


def _streak(per_year: pd.Series, tolerance: float) -> int:
    """Anzahl Jahre in Folge (vom letzten vollständigen Jahr rückwärts), in denen die Dividende
    mindestens um den Faktor `tolerance` gegenüber dem Vorjahr lag."""
    years = list(per_year.index)
    count = 0
    for i in range(len(years) - 1, 0, -1):
        prev, cur = per_year.iloc[i - 1], per_year.iloc[i]
        if prev > 0 and cur >= prev * tolerance and cur > 0:
            count += 1
        else:
            break
    return count


def build(dividends: list[list], close: pd.Series, price: float, eps_ttm: float | None,
          fcf_ps_ttm: float | None) -> dict:
    today = close.index[-1]
    if not dividends:
        return {"pays": False}
    s = pd.Series({pd.Timestamp(d): a for d, a in dividends}, dtype=float).sort_index()
    s = s.groupby(level=0).sum()

    per_year = s.groupby(s.index.year).sum()
    # Jahre ohne Zahlung als 0 einfügen, damit Lücken sichtbar bleiben
    per_year = per_year.reindex(range(int(per_year.index.min()), max(int(per_year.index.max()), today.year) + 1), fill_value=0.0)
    complete = per_year[per_year.index < today.year]
    if complete.empty:
        complete = per_year
    pts = [(pd.Timestamp(year=int(y), month=12, day=31), float(v)) for y, v in complete.items()]
    stats = trend_stats(pts)
    since = None  # Beginn der aktuellen, ununterbrochenen Zahlungsreihe
    for y in reversed(complete.index):
        if complete[y] <= 0:
            break
        since = int(y)

    last_payment = s.index[-1]
    suspended = (today - last_payment).days > 450
    ttm = 0.0 if suspended else float(s[s.index > today - pd.Timedelta(days=365)].sum())
    dividend_yield = ttm / price if price else None

    # Rendite-Historie: Dividenden der letzten 12 Monate / Kurs, ab einem Jahr nach der ersten Zahlung
    daily = s.reindex(close.index.union(s.index)).fillna(0.0)
    rolling = daily.rolling("365D").sum().reindex(close.index)
    yld = (rolling / close)[close.index >= s.index[0] + pd.Timedelta(days=365)]
    averages = {}
    for n in (5, 10):
        window = yld[yld.index >= today - pd.DateOffset(years=n)]
        if len(window) > 200 and (window.index[0] - (today - pd.DateOffset(years=n))).days < 60:
            averages[str(n)] = float(window.mean())
    ref = averages.get("10") or averages.get("5")
    turbo = dividend_yield / ref - 1 if ref and dividend_yield is not None else None

    last5 = complete.iloc[-6:] if len(complete) >= 6 else None
    weekly_yield = yld.resample("W-FRI").last().dropna()
    return {
        "pays": True,
        "suspended": suspended,
        "ttm": ttm,
        "yield": dividend_yield,
        "growth": stats["growth"],
        "growth_cagr_5y": cagr(float(last5.iloc[0]), float(last5.iloc[-1]), 5) if last5 is not None else None,
        "stability": stats["stability"],
        "stats_years": stats["years"],
        "payout_eps": ttm / eps_ttm if eps_ttm and eps_ttm > 0 else None,
        "payout_fcf": ttm / fcf_ps_ttm if fcf_ps_ttm and fcf_ps_ttm > 0 else None,
        "increase_streak": _streak(complete, 1.0001),
        "no_cut_streak": _streak(complete, 0.99),
        "first_year": int(per_year.index.min()),
        "uninterrupted_since": since,
        "last_payment": last_payment.strftime("%Y-%m-%d"),
        "per_year": [[int(y), float(v), bool(y == today.year)] for y, v in per_year.items()],
        "payments": [[d.strftime("%Y-%m-%d"), float(v)] for d, v in s.items()],
        "yield_series": [[d.strftime("%Y-%m-%d"), round(float(v), 5)] for d, v in weekly_yield.items()],
        "avg_yield": averages,
        "turbo": turbo,
    }
