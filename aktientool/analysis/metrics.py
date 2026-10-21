"""Grundlegende Kennzahlen: Stabilität, Wachstum, Renditen, Momentum."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

# Unter rund 5 Jahren (6 Jahreswerten) sind Stabilität und Wachstum kaum aussagekräftig: Vier Werte nach einem
# Gewinneinbruch ergeben leicht R² 0,9 und +100 % Wachstum pro Jahr (BASF 2022–2025). Solche Werte werden angezeigt,
# zählen in Scorecard und Bewertung aber höchstens neutral.
MIN_RELIABLE_YEARS = 5


def is_short(years: float | None) -> bool:
    return years is None or years < MIN_RELIABLE_YEARS - 0.2


def trend_stats(points: list[tuple[pd.Timestamp, float]], max_years: int = 10) -> dict:
    """Stabilität und Wachstum einer Jahresreihe (z. B. Gewinn je Aktie) über die letzten `max_years` Jahre.

    Stabilität: Bestimmtheitsmaß R² einer linearen Regression gegen die Zeit, mit dem Vorzeichen der Steigung.
    1,0 heißt: die Werte liegen exakt auf einer steigenden Geraden; negative Werte bedeuten einen Abwärtstrend.

    Wachstum: jährliche Rate aus einer Regression der logarithmierten Werte, wenn alle Werte positiv sind.
    Das ist robuster als ein Vergleich von erstem und letztem Jahr, weil jeder Wert gleich zählt.
    Gibt es Verlustjahre, wird der Durchschnitt der ersten drei mit dem der letzten drei Jahre verglichen
    (sofern beide positiv sind).
    """
    pts = [(d, v) for d, v in points if v is not None and math.isfinite(v)]
    pts = pts[-(max_years + 1):]
    result = {"stability": None, "growth": None, "years": 0, "count": len(pts), "start": None, "end": None}
    if len(pts) < 3:
        return result
    t = np.array([(d - pts[0][0]).days / 365.25 for d, _ in pts])
    y = np.array([v for _, v in pts], dtype=float)
    result.update(years=round(float(t[-1]), 1), start=pts[0][0].strftime("%Y-%m-%d"), end=pts[-1][0].strftime("%Y-%m-%d"))

    ss_tot = float(((y - y.mean()) ** 2).sum())
    if ss_tot == 0:
        result["stability"] = 1.0 if y[0] > 0 else 0.0
    else:
        slope, intercept = np.polyfit(t, y, 1)
        ss_res = float(((y - (slope * t + intercept)) ** 2).sum())
        result["stability"] = math.copysign(max(0.0, 1 - ss_res / ss_tot), slope)

    if (y > 0).all():
        b = np.polyfit(t, np.log(y), 1)[0]
        result["growth"] = math.exp(b) - 1
    elif len(y) >= 6:
        result["growth"] = cagr(float(y[:3].mean()), float(y[-3:].mean()), float(t[-3:].mean() - t[:3].mean()))
    return result


def cagr(start: float | None, end: float | None, years: float) -> float | None:
    if not start or not end or start <= 0 or end <= 0 or years <= 0:
        return None
    return (end / start) ** (1 / years) - 1


def period_returns(close: pd.Series, adj: pd.Series, today: pd.Timestamp) -> list[dict]:
    """Kursentwicklung bei unterschiedlicher Haltedauer (wie die Tabelle im Aktienfinder) plus Gesamtrendite p. a."""
    rows = []
    last_close, last_adj = float(close.iloc[-1]), float(adj.iloc[-1])
    for label, years in (("20 Jahre", 20), ("15 Jahre", 15), ("10 Jahre", 10), ("5 Jahre", 5), ("1 Jahr", 1)):
        start = today - pd.DateOffset(years=years)
        if close.index[0] > start + pd.Timedelta(days=10):
            rows.append({"label": label, "years": years, "price": None, "price_pa": None, "total_pa": None})
            continue
        c0, a0 = float(close.asof(start)), float(adj.asof(start))
        rows.append({
            "label": label, "years": years,
            "price": last_close / c0 - 1,
            "price_pa": cagr(c0, last_close, years),
            "total_pa": cagr(a0, last_adj, years),
        })
    prev_year_end = pd.Timestamp(year=today.year - 1, month=12, day=31)
    if close.index[0] <= prev_year_end:
        rows.append({"label": "Lfd. Jahr", "years": None, "price": last_close / float(close.asof(prev_year_end)) - 1,
                     "price_pa": None, "total_pa": None})
    return rows


def sma(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window, min_periods=window).mean()


def momentum(close: pd.Series) -> float | None:
    """Abstand des Kurses zur 200-Tage-Linie."""
    line = sma(close, 200)
    if line.dropna().empty:
        return None
    return float(close.iloc[-1] / line.iloc[-1] - 1)


def momentum_12_1(close: pd.Series) -> float | None:
    """Kursentwicklung der letzten 12 Monate ohne den jüngsten Monat (das in der Forschung übliche Momentum:
    der letzte Monat neigt zur Gegenbewegung und wird deshalb ausgelassen)."""
    if len(close) < 260:
        return None
    today = close.index[-1]
    start = close.asof(today - pd.DateOffset(months=12))
    end = close.asof(today - pd.DateOffset(months=1))
    if not start or pd.isna(start) or pd.isna(end):
        return None
    return float(end / start - 1)


def all_time_high(close: pd.Series) -> dict:
    day = close.idxmax()
    return {"price": float(close.max()), "date": day.strftime("%Y-%m-%d"),
            "distance": float(close.iloc[-1] / close.max() - 1)}
