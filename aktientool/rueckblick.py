"""Rückblick für den Score-Check: Haben Kursfaktoren in den letzten Jahren Rendite gebracht?

Die Tagesstände der Weltauswahl (snapshots.py) reichen nur so weit zurück, wie das Tool sie schon speichert. Für
Kennzahlen, die sich allein aus Kursen berechnen lassen (Momentum 12-1, Abstand zum Hoch …), geht mehr: Die
Tiefenanalyse lädt ohnehin jede Kurshistorie und legt hier die Monatsschlusskurse der letzten elf Jahre ab. Daraus
wird für jeden Monat der Vergangenheit berechnet, wie die Aktien mit hohem und mit niedrigem Faktorwert in den
folgenden 1, 3, 6 und 12 Monaten abgeschnitten haben.

Grenzen (stehen auch auf der Seite): Betrachtet werden die Aktien der heutigen Weltauswahl. Firmen, die inzwischen
geschrumpft, übernommen oder insolvent sind, fehlen (Survivorship Bias); alle Renditen fallen dadurch zu hoch aus,
und auch der Abstand zwischen den Gruppen kann verzerrt sein. Fundamentale Scores lassen sich so nicht prüfen, weil
dafür die damals bekannten Bilanzen nötig wären.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
import time

import numpy as np
import pandas as pd

from . import config
from .cache import cache_mtime, peek, store

log = logging.getLogger(__name__)

MONTHS = 132  # so viele Monatsschlusskurse je Aktie (11 Jahre)
HORIZONS = (1, 3, 6, 12)  # Haltedauern in Monaten
GROUPS = 5
MIN_STOCKS = 200  # so viele Aktien mit Faktor und Folgerendite braucht ein Monat, um zu zählen
MIN_MONTHS = 12  # so viele Monate braucht eine Auswertung
RETURN_RANGE = (-0.95, 10.0)  # Folgerenditen außerhalb gelten als Datenfehler (wie im Score-Check der Tagesstände)
FLUSH_EVERY = 250
REBUILD_AFTER = 3600  # lokaler Server: so lange gilt ein berechneter Rückblick mindestens

# Faktor -> (Bezeichnung, benötigte Vormonate)
FACTORS = {
    "mom121": ("Momentum 12-1", 12),
    "perf12": ("Kursentwicklung 12 Monate", 12),
    "sma10": ("Abstand zum 10-Monats-Durchschnitt (≈ 200-Tage-Linie)", 9),
    "high12": ("Abstand zum 12-Monats-Hoch", 11),
}

_lock = threading.Lock()
_prices: dict | None = None  # {symbol: {"e": "JJJJ-MM", "v": [Monatsschlusskurse, ältester zuerst]}}
_dirty = 0
_memo: tuple[float, dict] | None = None


def monthly_closes(prices: list, today: dt.date | None = None) -> dict | None:
    """Monatsschlusskurse (bereinigt um Splits und Dividenden) der letzten `MONTHS` abgeschlossenen Monate.
    `prices`: [[Datum, Schluss, bereinigter Schluss], …] wie in den Yahoo-Rohdaten."""
    if not prices:
        return None
    s = pd.Series([p[2] if p[2] is not None else p[1] for p in prices], index=pd.to_datetime([p[0] for p in prices]), dtype=float)
    s = s[s > 0].dropna()
    if s.empty:
        return None
    m = s.groupby(s.index.to_period("M")).last()
    # der laufende Monat ist noch nicht abgeschlossen
    current = pd.Period(today or dt.date.today(), "M")
    m = m[m.index < current]
    if len(m) < 2:
        return None
    # Monate ohne Handel (Aussetzung) mit dem letzten Kurs füllen, damit das Raster lückenlos ist
    m = m.reindex(pd.period_range(m.index[0], m.index[-1], freq="M")).ffill().iloc[-MONTHS:]
    return {"e": str(m.index[-1]), "v": [float(f"{x:.5g}") for x in m.values]}


def _load() -> dict:
    global _prices
    if _prices is None:
        _prices = peek(config.MONTHLY_KEY) or {}
    return _prices


def put(symbol: str, monthly: dict | None) -> None:
    """Monatskurse einer Aktie ablegen (Tiefenanalyse); gespeichert wird gesammelt."""
    global _dirty
    if not monthly:
        return
    with _lock:
        _load()[symbol] = monthly
        _dirty += 1
        due = _dirty >= FLUSH_EVERY
    if due:
        flush()


def flush() -> None:
    global _dirty
    with _lock:
        if not _dirty:
            return
        data = dict(_load())
        _dirty = 0
    store(config.MONTHLY_KEY, data)


def reset() -> None:
    """Zwischenstand vergessen (Tests, neu eingespielte Daten)."""
    global _prices, _dirty, _memo
    with _lock:
        _prices, _dirty, _memo = None, 0, None


def _month_index(ym: str) -> int:
    return int(ym[:4]) * 12 + int(ym[5:7]) - 1


def _matrix(prices: dict, symbols: set | None = None) -> tuple[np.ndarray, list[str]]:
    """Kurse aller Aktien auf ein gemeinsames Monatsraster legen (Zeile = Aktie, Spalte = Monat, NaN = kein Kurs)."""
    items = [(_month_index(p["e"]), p["v"]) for s, p in prices.items() if p.get("v") and (symbols is None or s in symbols)]
    if not items:
        return np.empty((0, 0)), []
    last = max(e for e, _ in items)
    grid = [f"{m // 12}-{m % 12 + 1:02d}" for m in range(last - MONTHS + 1, last + 1)]
    mat = np.full((len(items), MONTHS), np.nan)
    for i, (e, values) in enumerate(items):
        end = MONTHS - (last - e)  # Aktien mit älterem Stand enden früher
        v = values[-end:] if end > 0 else []
        if v:
            mat[i, end - len(v):end] = v
    return mat, grid


def _factor(mat: np.ndarray, key: str, t: int) -> np.ndarray:
    """Faktorwert jeder Aktie im Monat `t` (nur aus Kursen bis einschließlich `t`)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        if key == "mom121":
            return mat[:, t - 1] / mat[:, t - 12] - 1
        if key == "perf12":
            return mat[:, t] / mat[:, t - 12] - 1
        if key == "sma10":
            return mat[:, t] / mat[:, t - 9:t + 1].mean(axis=1) - 1
        if key == "high12":
            return mat[:, t] / mat[:, t - 11:t + 1].max(axis=1) - 1
    raise KeyError(key)


def _ranks(a: np.ndarray) -> np.ndarray:
    order = np.argsort(a, kind="stable")
    ranks = np.empty(len(a))
    ranks[order] = np.arange(len(a))
    return ranks


def evaluate(prices: dict, factor: str, horizon: int, symbols: set | None = None) -> dict:
    """Fünftel nach Faktorwert in jedem Monat, Folgerendite über `horizon` Monate, gemittelt über alle Monate."""
    if factor not in FACTORS:
        raise KeyError(f"Unbekannter Faktor: {factor}")
    lookback = FACTORS[factor][1]
    mat, grid = _matrix(prices, symbols)
    months = []
    for t in range(lookback, mat.shape[1] - horizon if mat.size else 0):
        f = _factor(mat, factor, t)
        with np.errstate(divide="ignore", invalid="ignore"):
            fwd = mat[:, t + horizon] / mat[:, t] - 1
        ok = np.isfinite(f) & np.isfinite(fwd) & (fwd > RETURN_RANGE[0]) & (fwd < RETURN_RANGE[1])
        if ok.sum() < MIN_STOCKS:
            continue
        f, fwd = f[ok], fwd[ok]
        rank = _ranks(f)
        group = np.minimum(GROUPS - 1, (rank * GROUPS / len(f)).astype(int))
        means = [float(fwd[group == g].mean()) for g in range(GROUPS)]
        medians = [float(np.median(fwd[group == g])) for g in range(GROUPS)]
        positive = [float((fwd[group == g] > 0).mean()) for g in range(GROUPS)]
        ic = float(np.corrcoef(rank, _ranks(fwd))[0, 1])
        months.append({"month": grid[t], "n": int(ok.sum()), "means": means, "medians": medians, "positive": positive,
                       "all_mean": float(fwd.mean()), "all_median": float(np.median(fwd)), "ic": ic})
    if len(months) < MIN_MONTHS:
        return {"available": False, "months": len(months), "factor": factor, "horizon": horizon}
    avg = lambda key: [float(np.mean([m[key][g] for m in months])) for g in range(GROUPS)]  # noqa: E731
    means, medians, positive = avg("means"), avg("medians"), avg("positive")
    spreads = [m["means"][-1] - m["means"][0] for m in months]
    return {
        "available": True, "factor": factor, "label": FACTORS[factor][0], "horizon": horizon,
        "months": len(months), "from": months[0]["month"], "to": months[-1]["month"],
        "count": int(round(float(np.mean([m["n"] for m in months])))),
        "groups": [{"group": g + 1, "mean": means[g], "median": medians[g], "positive": positive[g]} for g in range(GROUPS)],
        "all": {"mean": float(np.mean([m["all_mean"] for m in months])),
                "median": float(np.mean([m["all_median"] for m in months]))},
        "spread": float(np.mean(spreads)),
        # Anteil der Monate, in denen das stärkste Fünftel vor dem schwächsten lag
        "hit_rate": float(np.mean([s > 0 for s in spreads])),
        "rank_correlation": float(np.mean([m["ic"] for m in months])),
    }


def _factor_list() -> list[list[str]]:
    """[[Schlüssel, Bezeichnung], …] in der Reihenfolge der Auswahl (eine Liste, weil JSON-Objekte sortiert ankommen)."""
    return [[k, v[0]] for k, v in FACTORS.items()]


def build(prices: dict, symbols: set | None = None) -> dict:
    """Alle Faktoren und Haltedauern auf einmal (kleines Ergebnis für die tägliche Datenlieferung)."""
    results = {f"{factor}:{h}": evaluate(prices, factor, h, symbols) for factor in FACTORS for h in HORIZONS}
    used = len([s for s in prices if symbols is None or s in symbols])
    return {"built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "stocks": used,
            "factors": _factor_list(), "horizons": list(HORIZONS), "results": results}


def build_now(symbols: set | None = None) -> dict:
    """Aus den abgelegten Monatskursen neu rechnen und speichern (täglicher Workflow, lokaler Server)."""
    flush()
    with _lock:
        prices = dict(_load())
    result = build(prices, symbols)
    store(config.RUECKBLICK_KEY, result)
    return result


def result(symbols: set | None = None) -> dict:
    """Fertiger Rückblick. Serverlos kommt er mit den täglichen Daten; lokal wird er aus den Monatskursen der
    Tiefenanalyse berechnet, sobald diese neuer sind als das letzte Ergebnis."""
    global _memo
    built = cache_mtime(config.RUECKBLICK_KEY)
    if not config.SERVERLESS:
        flush()  # noch nicht gespeicherte Monatskurse der laufenden Tiefenanalyse
        source = cache_mtime(config.MONTHLY_KEY)
        # während die Tiefenanalyse läuft, kommen laufend Kurse dazu: höchstens stündlich neu rechnen
        if source and (built is None or (source > built and time.time() - built > REBUILD_AFTER)):
            try:
                build_now(symbols)
                built = cache_mtime(config.RUECKBLICK_KEY)
            except Exception as e:  # Rückblick ist Beiwerk: nie die Seite daran scheitern lassen
                log.warning("Rückblick nicht berechenbar: %s", e)
    if built is None:
        return {"stocks": 0, "results": {}, "factors": _factor_list(), "horizons": list(HORIZONS)}
    if _memo is None or _memo[0] != built:
        _memo = (built, peek(config.RUECKBLICK_KEY) or {})
    return _memo[1]
