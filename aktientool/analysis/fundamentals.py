"""Weitere Qualitätssignale: Kapitalrendite (ROIC), Piotroski F-Score, Aktienrückkäufe, Analysten-Revisionen und
Gewinnüberraschungen. Grundlage sind die Jahresabschlüsse von Yahoo (rund 4 Jahre) bzw. die Jahreswerte."""

from __future__ import annotations

from .metrics import cagr

DEFAULT_TAX = 0.25  # wenn Yahoo keinen Steuersatz liefert


def _years(statements: dict) -> list[tuple[str, dict]]:
    return sorted(statements.items())


def roic(statements: dict, is_financial: bool) -> dict:
    """Rendite auf das eingesetzte Kapital: operativer Gewinn nach Steuern ÷ (Eigenkapital + Schulden − Kasse).

    Sie zeigt, wie viel ein Unternehmen mit jedem investierten Euro verdient. Dauerhaft über rund 15 % gilt als Zeichen
    eines Burggrabens (Marke, Netzwerk, Patente), unter den Kapitalkosten von etwa 8 % wird Wert vernichtet."""
    if is_financial:
        return {"latest": None, "average": None, "years": [], "reason": "bei Banken und Versicherungen nicht sinnvoll"}
    rows = []
    for end, s in _years(statements):
        ebit, capital = s.get("ebit"), s.get("invested_capital")
        if ebit is None or not capital or capital <= 0:
            continue
        tax = s.get("tax_rate")
        tax = DEFAULT_TAX if tax is None else min(0.5, max(0.0, tax))
        rows.append([end, ebit * (1 - tax) / capital])
    if not rows:
        return {"latest": None, "average": None, "years": []}
    return {"latest": rows[-1][1], "average": sum(v for _, v in rows) / len(rows), "years": rows}


PIOTROSKI = [
    ("roa_positive", "Gewinn positiv (Gesamtkapitalrendite > 0)"),
    ("ocf_positive", "Operativer Cashflow positiv"),
    ("roa_up", "Gesamtkapitalrendite gestiegen"),
    ("accruals", "Cashflow höher als der Gewinn (keine Buchgewinne)"),
    ("leverage_down", "Langfristige Schulden im Verhältnis zur Bilanz gesunken"),
    ("liquidity_up", "Liquidität (Umlaufvermögen ÷ kurzfristige Schulden) gestiegen"),
    ("no_dilution", "Keine neuen Aktien ausgegeben"),
    ("margin_up", "Bruttomarge gestiegen"),
    ("turnover_up", "Umsatz im Verhältnis zur Bilanz gestiegen"),
]


def _ratio(a, b):
    return a / b if a is not None and b else None


def piotroski(statements: dict) -> dict:
    """Piotroski F-Score (0–9): neun Ja/Nein-Prüfungen der Bilanzqualität im letzten gegenüber dem Vorjahr.

    8–9 gilt als stark, 0–2 als schwach. Fehlen Angaben (z. B. bei Banken die Bruttomarge), zählt der Score nur
    die prüfbaren Punkte; unter 7 prüfbaren Punkten gibt es keinen Score."""
    years = [s for _, s in _years(statements) if s.get("total_assets")]
    if len(years) < 2:
        return {"score": None, "checked": 0, "tests": []}
    prev, cur = years[-2], years[-1]
    roa = _ratio(cur.get("net_income"), cur.get("total_assets"))
    roa_prev = _ratio(prev.get("net_income"), prev.get("total_assets"))
    lev = _ratio(cur.get("long_term_debt") or 0.0, cur.get("total_assets"))
    lev_prev = _ratio(prev.get("long_term_debt") or 0.0, prev.get("total_assets"))
    liq = _ratio(cur.get("current_assets"), cur.get("current_liabilities"))
    liq_prev = _ratio(prev.get("current_assets"), prev.get("current_liabilities"))
    margin = _ratio(cur.get("gross_profit"), cur.get("revenue"))
    margin_prev = _ratio(prev.get("gross_profit"), prev.get("revenue"))
    turn = _ratio(cur.get("revenue"), cur.get("total_assets"))
    turn_prev = _ratio(prev.get("revenue"), prev.get("total_assets"))
    shares, shares_prev = cur.get("shares_out") or cur.get("shares"), prev.get("shares_out") or prev.get("shares")

    def cmp(a, b, op):
        return None if a is None or b is None else op(a, b)

    results = {
        "roa_positive": None if roa is None else roa > 0,
        "ocf_positive": None if cur.get("ocf") is None else cur["ocf"] > 0,
        "roa_up": cmp(roa, roa_prev, lambda a, b: a > b),
        "accruals": cmp(cur.get("ocf"), cur.get("net_income"), lambda a, b: a > b),
        "leverage_down": cmp(lev, lev_prev, lambda a, b: a <= b),
        "liquidity_up": cmp(liq, liq_prev, lambda a, b: a > b),
        "no_dilution": cmp(shares, shares_prev, lambda a, b: a <= b * 1.005),
        "margin_up": cmp(margin, margin_prev, lambda a, b: a > b),
        "turnover_up": cmp(turn, turn_prev, lambda a, b: a > b),
    }
    tests = [{"key": k, "label": label, "passed": results[k]} for k, label in PIOTROSKI]
    checked = [t for t in tests if t["passed"] is not None]
    score = sum(t["passed"] for t in checked) if len(checked) >= 7 else None
    return {"score": score, "checked": len(checked), "tests": tests}


def share_trend(annual: list[dict], max_years: int = 10) -> dict:
    """Veränderung der Aktienzahl pro Jahr: negativ = Rückkäufe (jeder Aktionär besitzt mehr vom Unternehmen),
    positiv = Verwässerung durch neue Aktien (z. B. Mitarbeiteraktien, Kapitalerhöhungen)."""
    pts = [(r["end"], r["shares"]) for r in annual if r.get("shares")][-(max_years + 1):]
    if len(pts) < 3:
        return {"cagr": None, "years": 0}
    years = (pts[-1][0] - pts[0][0]).days / 365.25
    return {"cagr": cagr(pts[0][1], pts[-1][1], years), "years": round(years, 1),
            "start": pts[0][0].strftime("%Y-%m-%d"), "points": [[d.strftime("%Y-%m-%d"), v] for d, v in pts]}


def revisions(raw: dict) -> dict:
    """Veränderung der Analystenschätzung für den Gewinn des laufenden und nächsten Geschäftsjahres.

    Steigende Schätzungen (Revisionen nach oben) gehören zu den am besten belegten kurzfristigen Renditetreibern."""
    out = {}
    for period, r in (raw or {}).items():
        now = r.get("now")
        item = {"now": now, "up30": r.get("up30"), "down30": r.get("down30")}
        for key, ago in (("change30", "d30"), ("change90", "d90")):
            base = r.get(ago)
            item[key] = now / base - 1 if now is not None and base and base > 0 else None
        out[period] = item
    # Richtung: jüngste 30 Tage beider Geschäftsjahre, bestätigt durch die Zahl der Anhebungen und Senkungen
    changes = [p["change30"] for p in out.values() if p.get("change30") is not None]
    net = sum((p.get("up30") or 0) - (p.get("down30") or 0) for p in out.values())
    trend = None
    if changes:
        avg = sum(changes) / len(changes)
        trend = ("steigend" if avg > 0.005 and net >= 0 else "fallend" if avg < -0.005 and net <= 0
                 else "uneinheitlich" if abs(avg) > 0.005 else "stabil")
    return {"periods": out, "trend": trend, "change90": (out.get("0y") or {}).get("change90"), "net30": net}


def surprises(rows: list[dict]) -> dict:
    """Gewinnüberraschungen der letzten Quartale: Wie oft lag der gemeldete Gewinn über der Erwartung?"""
    valid = [r for r in rows or [] if r.get("surprise") is not None]
    if not valid:
        return {"quarters": [], "beats": None, "average": None}
    return {"quarters": valid, "beats": sum(r["surprise"] > 0 for r in valid),
            "average": sum(r["surprise"] for r in valid) / len(valid)}
