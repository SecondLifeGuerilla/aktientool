"""Tagesstände der Weltauswahl archivieren und auswerten: Haben Aktien mit hohem Score danach besser abgeschnitten?

Rückwirkend lässt sich das mit kostenlosen Daten nicht prüfen (dafür bräuchte es die Kennzahlen, wie sie damals
bekannt waren). Deshalb speichert das Tool ab jetzt jeden Tag einen kompakten Stand (Kurs, Scores, Kennzahlen) als
gzip-Datei, rund 300 KB pro Tag. Nach einigen Wochen oder Monaten zeigt die Auswertung je Score, wie sich die
Aktien der fünf Gruppen (Quintile, vom schwächsten bis zum stärksten Fünftel) seitdem entwickelt haben.
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import math
import re
import statistics

from . import config, remote

KEEP = ["symbol", "isin", "country", "sector", "currency", "price", "market_cap",
        "score_total", "score_quality", "score_value", "score_growth", "score_momentum", "score_dividend", "magic_formula",
        "score_stability", "d_exp_lo", "d_warn", "d_trap",
        "pe", "pb", "div_yield", "perf_1y", "momentum", "roe", "net_margin", "revenue_growth",
        "d_stab", "d_growth", "d_dev", "d_exp", "d_sc_inc", "d_sc_dg", "d_sc_eg", "d_roic", "d_pio", "d_rev90", "d_mom121",
        "d_dcf", "d_short"]
NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})\.json\.gz$")


def _path(day: str):
    return config.SNAPSHOT_DIR / f"{day}.json.gz"


def save(rows: list[dict], day: str | None = None, overwrite: bool = False) -> bool:
    """Speichert den Stand des Tages; True, wenn eine Datei geschrieben wurde."""
    if config.SERVERLESS:
        return False  # serverlos schreibt der tägliche Workflow die Tagesstände
    day = day or dt.date.today().isoformat()
    path = _path(day)
    if path.exists() and not overwrite:
        return False
    config.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    data = {"day": day, "stocks": [{k: r[k] for k in KEEP if r.get(k) is not None} for r in rows]}
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(gzip.compress(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 6))
    tmp.replace(path)
    return True


def dates() -> list[str]:
    if config.SERVERLESS:
        return remote.snapshot_dates()
    if not config.SNAPSHOT_DIR.exists():
        return []
    return sorted(m.group(1) for p in config.SNAPSHOT_DIR.iterdir() if (m := NAME.match(p.name)))


def load(day: str) -> list[dict]:
    if not NAME.match(f"{day}.json.gz"):
        raise ValueError("Datum im Format JJJJ-MM-TT angeben")
    raw = remote.snapshot_file(day) if config.SERVERLESS else _path(day).read_bytes()
    return json.loads(gzip.decompress(raw))["stocks"]


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):  # Gleichstände bekommen den mittleren Rang
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2
        i = j + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """Rangkorrelation: +1 = je höher der Score, desto höher die Rendite; 0 = kein Zusammenhang."""
    if len(xs) < 10:
        return None
    rx, ry = _ranks(xs), _ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    var = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return cov / var if var else None


def evaluate(start: str, end: str, key: str, groups: int = 5, higher_is_better: bool = True) -> dict:
    """Kursrendite je Gruppe zwischen zwei Tagesständen (ohne Dividenden, in Kurswährung der jeweiligen Aktie)."""
    before = {r["symbol"]: r for r in load(start)}
    after = {r["symbol"]: r for r in load(end)}
    pairs = []
    for sym, r in before.items():
        a = after.get(sym)
        if a and r.get(key) is not None and r.get("price") and a.get("price"):
            ret = a["price"] / r["price"] - 1
            if -0.95 < ret < 10:  # Datenfehler (Splits ohne Bereinigung) aussortieren
                pairs.append((r[key] if higher_is_better else -r[key], ret))
    pairs.sort(key=lambda p: p[0])
    out = []
    n = len(pairs)
    for g in range(groups):
        chunk = pairs[g * n // groups:(g + 1) * n // groups]
        rets = [ret for _, ret in chunk]
        out.append({"group": g + 1, "count": len(chunk),
                    "score_from": chunk[0][0] if chunk else None, "score_to": chunk[-1][0] if chunk else None,
                    "mean": statistics.fmean(rets) if rets else None, "median": statistics.median(rets) if rets else None,
                    "positive": sum(r > 0 for r in rets) / len(rets) if rets else None})
    all_rets = [ret for _, ret in pairs]
    return {
        "start": start, "end": end, "key": key, "count": n,
        "days": (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days,
        "groups": out,
        "all": {"mean": statistics.fmean(all_rets) if all_rets else None,
                "median": statistics.median(all_rets) if all_rets else None},
        "spread": (out[-1]["mean"] - out[0]["mean"]) if out and out[-1]["mean"] is not None and out[0]["mean"] is not None else None,
        "rank_correlation": spearman([s for s, _ in pairs], all_rets),
    }
