"""Warnzeichen für eine mögliche Value-Falle.

Eine Aktie, die gemessen an ihrer eigenen Vergangenheit billig aussieht, ist oft zu Recht billig: Das Wachstum bricht ab,
die Schätzungen fallen, der Markt hat sich schon abgewandt. Der faire Wert (Ø-Multiple × Kennzahl) sieht das nicht,
weil er die Vergangenheit fortschreibt. Die drei Warnzeichen hier prüfen genau diese Annahme.
"""

from __future__ import annotations

HISTORY_MIN = 0.06  # ab so viel bisherigem Wachstum zählt „Analysten erwarten weniger als die Hälfte“ als Bruch
REVISION_DROP = -0.03  # Gewinnschätzung in 90 Tagen um so viel gesenkt
CHEAP = -0.10  # Kurs so weit unter dem fairen Wert: „wirkt günstig“
TRAP_SIGNS = 2  # ab so vielen Warnzeichen bei günstig wirkender Aktie: mögliche Value-Falle


def _pct(x: float) -> str:
    return f"{x * 100:+.1f}".replace(".", ",").replace("-", "−") + " %"


def growth_break(analysts: float | None, history: float | None) -> bool:
    """Analysten erwarten sinkende Gewinne oder weniger als die Hälfte des bisherigen Wachstums."""
    if analysts is None:
        return False
    return analysts < 0 or (history is not None and history >= HISTORY_MIN and analysts < history / 2)


def revisions_falling(change90: float | None, trend: str | None = None) -> bool:
    return trend == "fallend" or (change90 is not None and change90 <= REVISION_DROP)


def trend_broken(momentum: float | None, momentum_12_1: float | None) -> bool:
    """Kurs unter der 200-Tage-Linie und negatives Momentum 12-1: Der Markt sieht es anders als der faire Wert."""
    return momentum is not None and momentum < 0 and momentum_12_1 is not None and momentum_12_1 < 0


def count(analysts: float | None, history: float | None, change90: float | None, momentum: float | None,
          momentum_12_1: float | None, trend: str | None = None) -> int:
    return (int(growth_break(analysts, history)) + int(revisions_falling(change90, trend))
            + int(trend_broken(momentum, momentum_12_1)))


def is_trap(deviation: float | None, signs: int | None) -> bool:
    """Wirkt günstig (Kurs deutlich unter dem fairen Wert) und hat mindestens zwei Warnzeichen."""
    return deviation is not None and deviation <= CHEAP and (signs or 0) >= TRAP_SIGNS


def build(deviation: float | None, sources: dict, revisions: dict | None, momentum: float | None,
          momentum_12_1: float | None) -> dict:
    """Warnzeichen mit Begründung fürs Profil. `sources`: Wachstumsquellen der erwarteten Rendite."""
    analysts, history = (sources or {}).get("analysts"), (sources or {}).get("history")
    rev = revisions or {}
    signs = []
    if growth_break(analysts, history):
        if analysts < 0:
            text = f"Analysten erwarten sinkende Gewinne ({_pct(analysts)} pro Jahr)"
        else:
            text = f"Analysten erwarten nur noch {_pct(analysts)} Gewinnwachstum pro Jahr"
        if history is not None:
            text += f", bisher waren es {_pct(history)}"
        signs.append({"key": "growth", "text": text + "."})
    if revisions_falling(rev.get("change90"), rev.get("trend")):
        change = rev.get("change90")
        signs.append({"key": "revisions", "text": "Die Gewinnschätzungen fallen"
                      + (f" ({_pct(change)} in 90 Tagen)." if change is not None else ".")})
    if trend_broken(momentum, momentum_12_1):
        signs.append({"key": "trend", "text": f"Der Kurs liegt unter der 200-Tage-Linie, das Momentum 12-1 ist negativ "
                                              f"({_pct(momentum_12_1)})."})
    return {"signs": signs, "count": len(signs), "trap": is_trap(deviation, len(signs)),
            "cheap": deviation is not None and deviation <= CHEAP}
