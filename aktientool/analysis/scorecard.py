"""Scorecard: wie gut passt eine Aktie zu drei Anlagestrategien (Score 1–10)?

Kriterien und Bandbreiten folgen der Aktienfinder-Scorecard. Jedes Kriterium wird linear auf 0..1 abgebildet
(untere Grenze -> 0, obere Grenze -> 1). Der Score ist 1 + 9 × Mittelwert, gedämpft durch das Kernkriterium
der Strategie: liegt es unter der Hälfte seiner Bandbreite, sinkt der Score proportional. So bekommt eine Aktie
mit 0,3 % Dividendenrendite für die Dividendenertrags-Strategie keinen guten Score, egal wie stark der Rest ist.

Stabilität und Wachstum aus weniger als rund 5 Jahren zählen höchstens neutral (0,5): Eine kurze Reihe nach einem
Gewinneinbruch sieht sonst wie ein perfekter Wachstumswert aus.
"""

from __future__ import annotations

import math

from .metrics import is_short

LABELS = {
    "earnings_stability": "Gewinnstabilität",
    "earnings_growth": "Gewinnwachstum",
    "debt_years": "Max. Tilgungsjahre",
    "momentum": "Momentum",
    "discount": "Discount",
    "div_yield": "Dividendenrendite",
    "div_stability": "Dividendenstabilität",
    "div_growth": "Dividendenwachstum",
}
# Wachstum über bis zu 10 Jahre; bei kürzerer Historie steht die tatsächliche Zahl der Jahre im Namen
WITH_YEARS = {"earnings_growth", "div_growth"}
# Fehlende Werte: neutral (0,5) bei Kriterien, die nicht jede Aktie hat; sonst 0.
NEUTRAL_IF_MISSING = {"debt_years", "discount", "momentum"}

STRATEGIES = [
    {
        "key": "dividend_income", "label": "Dividendenertrag", "core": "div_yield",
        "text": "Hohe Dividenden von Anfang an. Wichtig sind die Höhe der Rendite und die Stabilität von Gewinn und Dividende.",
        "criteria": [("earnings_stability", 0, 1), ("earnings_growth", 0, 0.05), ("debt_years", None, None),
                     ("momentum", -0.15, 0.15), ("discount", 1, 10), ("div_yield", 0, 0.05),
                     ("div_stability", 0, 1), ("div_growth", 0, 0.05)],
    },
    {
        "key": "dividend_growth", "label": "Dividendenwachstum", "core": "div_growth",
        "text": "Niedrigere Startrendite, dafür stark steigende Dividenden. Das Wachstum zählt mehr als die Höhe.",
        "criteria": [("earnings_stability", 0, 1), ("earnings_growth", 0, 0.15), ("debt_years", None, None),
                     ("momentum", -0.15, 0.15), ("discount", 1, 10), ("div_yield", 0, 0.02),
                     ("div_stability", 0, 1), ("div_growth", 0, 0.15)],
    },
    {
        "key": "earnings_growth", "label": "Gewinnwachstum", "core": "earnings_growth",
        "text": "Kursgewinne statt Dividende. Entscheidend sind Gewinnwachstum, Gewinnstabilität, geringe Schulden und Bewertung.",
        "criteria": [("earnings_stability", 0, 1), ("earnings_growth", 0, 0.20), ("debt_years", None, None),
                     ("momentum", -0.15, 0.15), ("discount", 1, 10)],
    },
]


def discount_score(deviation: float | None) -> float | None:
    """Abweichung vom fairen Wert -> 1..10. Kurs 50 % über fairem Wert = 1, fair = 5,5, 50 % darunter = 10."""
    if deviation is None:
        return None
    ratio = 1 + deviation
    return max(1.0, min(10.0, 1 + 9 * (1.5 - ratio)))


def normalize(name: str, value: float | None, lo, hi) -> float | None:
    if value is None:
        return None
    if name == "debt_years":
        if math.isinf(value):
            return 0.0
        return 1.0 if value <= 2 else min(1.0, 2 / value)
    return max(0.0, min(1.0, (value - lo) / (hi - lo)))


def label(name: str, years: float | None) -> str:
    if name in WITH_YEARS:
        return f"{LABELS[name]} ({min(10, round(years)) if years else 10}J.)"
    return LABELS[name]


def build(values: dict, years: dict | None = None) -> list[dict]:
    """`years`: Länge der Reihe hinter einem Kriterium in Jahren (Stabilität, Wachstum), soweit bekannt."""
    years = years or {}
    out = []
    for strat in STRATEGIES:
        criteria = []
        norms = {}
        for name, lo, hi in strat["criteria"]:
            n = normalize(name, values.get(name), lo, hi)
            short = years.get(name) is not None and values.get(name) is not None and is_short(years[name])
            if n is None:
                n_used = 0.5 if name in NEUTRAL_IF_MISSING else 0.0
            else:
                n_used = min(n, 0.5) if short else n
            norms[name] = n_used
            criteria.append({"key": name, "label": label(name, years.get(name)), "value": values.get(name), "lo": lo,
                             "hi": hi, "norm": n, "short": short, "core": name == strat["core"]})
        mean = sum(norms.values()) / len(norms)
        damping = min(1.0, norms[strat["core"]] / 0.5)
        score = max(1, min(10, round(1 + 9 * mean * damping)))
        out.append({"key": strat["key"], "label": strat["label"], "text": strat["text"],
                    "score": score, "criteria": criteria})
    return out
