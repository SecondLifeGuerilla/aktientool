"""Reverse-DCF: Welches Wachstum des Free Cashflows ist im aktuellen Kurs schon eingepreist?

Ein Discounted-Cashflow-Modell rechnet künftige Free Cashflows auf heute ab. Statt einen Kursziel-Wert zu
schätzen (der stark von unsicheren Annahmen abhängt), wird hier umgekehrt gefragt: Wie schnell müsste der Free
Cashflow in den nächsten 10 Jahren wachsen, damit der heutige Kurs bei einer geforderten Rendite gerechtfertigt
ist? Liegt das eingepreiste Wachstum deutlich über dem bisherigen und dem erwarteten Wachstum, ist viel
Optimismus im Kurs; liegt es darunter, ist die Aktie eher günstig.
"""

from __future__ import annotations

YEARS = 10
TERMINAL_GROWTH = 0.025  # ewiges Wachstum nach 10 Jahren (etwa Inflation plus etwas Realwachstum)
RATES = (0.08, 0.09, 0.10)  # geforderte Rendite (Eigenkapitalkosten)
BOUNDS = (-0.30, 0.60)


def present_value(fcf: float, growth: float, rate: float, terminal: float = TERMINAL_GROWTH, years: int = YEARS) -> float:
    value, cash = 0.0, fcf
    for t in range(1, years + 1):
        cash *= 1 + growth
        value += cash / (1 + rate) ** t
    terminal_value = cash * (1 + terminal) / (rate - terminal)
    return value + terminal_value / (1 + rate) ** years


def implied_growth(fcf: float | None, price: float | None, rate: float) -> float | None:
    """Wachstum pro Jahr, bei dem der Barwert dem Kurs entspricht (Bisektion); None außerhalb von −30 … +60 %."""
    if not fcf or fcf <= 0 or not price or price <= 0 or rate <= TERMINAL_GROWTH:
        return None
    lo, hi = BOUNDS
    if present_value(fcf, lo, rate) > price or present_value(fcf, hi, rate) < price:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if present_value(fcf, mid, rate) < price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def build(fcf_ttm: float | None, fcf_years: list[float], price: float, is_financial: bool) -> dict:
    """Basis ist der Ø Free Cashflow je Aktie aus den letzten 12 Monaten und den 2 letzten Geschäftsjahren,
    damit ein einzelnes Jahr mit hohen Investitionen das Ergebnis nicht verzerrt."""
    if is_financial:
        return {"available": False, "reason": "Bei Banken und Versicherungen ist der Free Cashflow nicht aussagekräftig."}
    values = [v for v in [fcf_ttm, *fcf_years[-2:]] if v is not None]
    if not values:
        return {"available": False, "reason": "Kein Free Cashflow verfügbar."}
    base = sum(values) / len(values)
    if base <= 0:
        return {"available": False, "reason": "Der Free Cashflow ist im Durchschnitt negativ; ein DCF ist nicht sinnvoll."}
    rates = {f"{r:.2f}": implied_growth(base, price, r) for r in RATES}
    return {"available": True, "fcf": base, "fcf_points": len(values), "fcf_yield": base / price,
            "years": YEARS, "terminal": TERMINAL_GROWTH, "rates": rates}
