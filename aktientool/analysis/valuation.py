"""Bewertung und fairer Wert nach dem Aktienfinder-Prinzip.

1. Für Gewinn (bilanziert), Gewinn (bereinigt) und operativen Cashflow je Aktie wird die Stabilität berechnet.
2. Die stabilste Kennzahl dient zur Bewertung (KGV bzw. KCV). Sie muss überwiegend positiv sein: in den letzten
   12 Monaten und im letzten Geschäftsjahr positiv, in mindestens drei Vierteln der letzten 5 Geschäftsjahre
   positiv (also höchstens ein negatives Jahr) und mit mindestens 2 Jahren verwertbaren Kursdaten (siehe 4.).
   Eine kürzere Reihe (z. B. 4 Jahre bereinigter Gewinn) ersetzt keine längere, die an diesen Regeln scheitert.
   Sonst gibt es keinen fairen Wert (z. B. bei Firmen, die gerade erst die Gewinnschwelle erreichen).
3. Für jeden Handelstag wird das Multiple berechnet: Kurs / Kennzahl. Die Kennzahl wird zwischen den
   Geschäftsjahresenden linear interpoliert, der jüngste Punkt sind die letzten 12 Monate (TTM).
4. Fairer Wert = durchschnittliches Multiple der letzten 3/5/10 Jahre × aktuelle Kennzahl. Der Durchschnitt ist
   das harmonische Mittel (= Kehrwert der durchschnittlichen Gewinnrendite). Tage mit vorübergehend eingebrochener
   Kennzahl (unter 60 % ihres Höchststands im Umkreis von ±1 Jahr, also Verlust- und Erholungsjahre) zählen nicht
   mit: Dort ist das KGV künstlich hoch (adidas 2023: 180) und würde den fairen Wert aufblähen.
5. Die Prognose schreibt die Kennzahl mit den Wachstumsraten der Analysten-Gewinnschätzungen fort.
6. Reicht die Kennzahl weniger als rund 5 Jahre zurück (meist Firmen ohne SEC-Berichte), hängt der Durchschnitt an
   einer einzigen Phase (BASF 2022–2025: Ø-KGV 33 nach dem Gewinneinbruch). Der faire Wert bleibt sichtbar, die
   Aktie wird aber nicht als über- oder unterbewertet eingeordnet.
7. Zykliker: Schwankt die beste Kennzahl stark (Stabilität unter 0,5) und gibt es mindestens 8 Jahreswerte, wird
   zusätzlich der normalisierte Gewinn geprüft (Durchschnitt der letzten 5 Geschäftsjahre, wie beim Shiller-KGV).
   Verläuft er gleichmäßiger, ist er die Bewertungsgrundlage: Ein Spitzengewinn im Boom lässt die Aktie dann nicht
   mehr billig erscheinen.
8. Ersatz Umsatz: Taugen weder Gewinn noch Cashflow (Wachstumsfirmen mit Verlusten), wird über das KUV bewertet.
9. Erwartete Rendite: fairer Wert in 5 Jahren (Ø-Multiple × Kennzahl, fortgeschrieben mit dem erwarteten Wachstum)
   gegenüber dem Kurs, als Rendite pro Jahr plus Dividendenrendite.
"""

from __future__ import annotations

import pandas as pd

from .metrics import is_short, trend_stats

METRICS = [
    ("eps", "Bilanzierter Gewinn", "KGV"),
    ("eps_adj", "Bereinigter Gewinn", "KGV"),
    ("ocf_ps", "Operativer Cash-Flow", "KCV"),
]
PRIMARY = {key for key, _, _ in METRICS}
NORMALIZED = ("eps_norm", "Normalisierter Gewinn", "KGV")
FALLBACK = ("rev_ps", "Umsatz", "KUV")
NORM_YEARS = 5  # normalisierter Gewinn: Durchschnitt so vieler Geschäftsjahre
NORM_MIN_POINTS = 8  # mindestens so viele Jahreswerte (ergibt 4 Durchschnittswerte)
CYCLICAL_STABILITY = 0.5  # darunter gilt die Gewinnentwicklung als zyklisch …
NORM_MIN_GAIN = 0.2  # … und der Durchschnittsgewinn muss um so viel stabiler sein
# Bezeichnung im Umschalter des Multiple-Diagramms (zwei Kennzahlen heißen „KGV“)
SWITCH_LABELS = {"eps": "KGV", "eps_adj": "KGV bereinigt", "ocf_ps": "KCV", "eps_norm": "KGV normalisiert", "rev_ps": "KUV"}
EXPECTED_YEARS = 5  # Horizont der erwarteten Rendite
GROWTH_RANGE = (-0.10, 0.15)  # erwartetes Wachstum für die Rendite-Rechnung, gekappt (über 5 Jahre selten haltbar)
PERIODS = (3, 5, 10)
RECENT_YEARS = 5  # betrachtete letzte Geschäftsjahre
MIN_POSITIVE_SHARE = 0.75  # davon mindestens positiv (bei 5 und 4 Jahren: höchstens ein negatives)
MIN_AVG_DAYS = 500  # ≈ 2 Jahre verwertbare Handelstage für ein Durchschnitts-Multiple
DIP_RATIO = 0.6  # Kennzahl unter 60 % ihres Höchststands im Umkreis …
DIP_WINDOW = 505  # … von ±1 Jahr (Handelstage) gilt als vorübergehend eingebrochen


DISTORTED = {"label": "nicht aussagekräftig", "status": "neutral"}
SHORT = {"label": "unsicher (kurze Historie)", "status": "neutral"}


def rating(deviation: float | None) -> dict | None:
    """Einordnung der Abweichung Kurs vs. fairer Wert. `status` steuert die Farbe im Frontend."""
    if deviation is None:
        return None
    if deviation > 0.30:
        return {"label": "stark überbewertet", "status": "critical"}
    if deviation > 0.10:
        return {"label": "überbewertet", "status": "serious"}
    if deviation >= -0.10:
        return {"label": "fair bewertet", "status": "neutral"}
    if deviation >= -0.30:
        return {"label": "unterbewertet", "status": "good"}
    return {"label": "stark unterbewertet", "status": "good"}


def forecast_points(last: tuple[pd.Timestamp, float] | None, estimates: dict, today: pd.Timestamp) -> list[dict]:
    """Schreibt den letzten Jahreswert mit dem von Analysten erwarteten Gewinnwachstum fort.

    Basis ist der Vorjahresgewinn aus den Schätzungen (`year_ago` des laufenden Geschäftsjahres), damit
    bereinigte Analystenzahlen und unsere Kennzahl nicht direkt vermischt werden.
    """
    if not last or last[1] is None or last[1] <= 0:
        return []
    e0 = estimates.get("0y") or {}
    base = e0.get("year_ago")
    if not base or base <= 0:
        return []
    last_end, last_val = last
    if last_end + pd.DateOffset(years=1) < today - pd.Timedelta(days=400):
        return []  # Schätzungen gehören offenbar zu einem späteren Geschäftsjahr als unsere Daten
    out = []
    for i, key in enumerate(("0y", "+1y"), start=1):
        e = estimates.get(key) or {}
        if not e.get("avg"):
            continue

        def scale(x):
            return last_val * x / base if x is not None else None

        out.append({
            "date": (last_end + pd.DateOffset(years=i)).strftime("%Y-%m-%d"),
            "avg": scale(e["avg"]), "low": scale(e.get("low")), "high": scale(e.get("high")),
            "analysts": e.get("analysts"),
        })
    return out


def _weekly(s: pd.Series) -> list[list]:
    w = s.dropna().resample("W-FRI").last().dropna()
    return [[d.strftime("%Y-%m-%d"), round(float(v), 4)] for d, v in w.items()]


def _multiple_series(close: pd.Series, points: list, current: float) -> tuple[pd.Series, pd.Series]:
    """Tägliches Multiple: Kurs / Kennzahl, die Kennzahl zwischen den Geschäftsjahresenden interpoliert.

    Gibt die tägliche Kennzahl und das Multiple zurück."""
    today = close.index[-1]
    actual = pd.Series({d: v for d, v in points}, dtype=float)
    actual[today] = current
    actual = actual[~actual.index.duplicated(keep="last")].sort_index()
    idx = close.index.union(actual.index)
    metric = actual.reindex(idx).interpolate(method="time", limit_area="inside").reindex(close.index)
    multiple = close / metric.where(metric > 0)
    return metric, multiple.where((multiple > 0) & (multiple < 500))


def dips(metric: pd.Series) -> pd.Series:
    """Tage, an denen die Kennzahl vorübergehend eingebrochen ist: unter 60 % ihres Höchststands im Umkreis von
    ±1 Jahr. Das trifft Verlust- und Erholungsjahre, aber auch Phasen, in denen sich der Gewinn binnen eines Jahres
    mehr als verdoppelt. In beiden Fällen ist das Multiple auf Basis der letzten 12 Monate künstlich hoch."""
    peak = metric.rolling(DIP_WINDOW, center=True, min_periods=1).max()
    return (metric < DIP_RATIO * peak).fillna(False)


def _average(multiple: pd.Series, years: int, dip: pd.Series | None = None) -> tuple[float, float, float] | None:
    """Harmonisches Mittel des Multiples der letzten `years` Jahre ohne Einbruch-Tage, die abgedeckten Jahre und
    der Anteil der ausgelassenen Tage."""
    today = multiple.index[-1]
    window = multiple[multiple.index >= today - pd.DateOffset(years=years)].dropna()
    clean = window[~dip.reindex(window.index, fill_value=False)] if dip is not None else window
    if len(clean) < MIN_AVG_DAYS:
        return None
    covered = round((window.index[-1] - window.index[0]).days / 365.25, 1)
    return float(1 / (1 / clean).mean()), covered, 1 - len(clean) / len(window)


def _ranges(mask: pd.Series) -> list[list[str]]:
    """Zusammenhängende Zeiträume von mindestens zwei Wochen, in denen `mask` gilt, als [Start, Ende]."""
    weekly = mask.resample("W-FRI").max().fillna(False).astype(bool)
    out, start, prev = [], None, None
    for day, on in weekly.items():
        if on and start is None:
            start = day
        elif not on and start is not None:
            if (prev - start).days >= 14:
                out.append([start.strftime("%Y-%m-%d"), prev.strftime("%Y-%m-%d")])
            start = None
        prev = day
    if start is not None and (prev - start).days >= 14:
        out.append([start.strftime("%Y-%m-%d"), prev.strftime("%Y-%m-%d")])
    return out


MIN_MULTIPLE_DAYS = 120  # so viele Handelstage mit positiver Kennzahl braucht ein Verlauf


def _multiples(close: pd.Series, price: float, candidates: list[dict],
               best: dict | None = None) -> tuple[list[dict], list[dict]]:
    """Verläufe aller Kennzahlen (KGV, KGV bereinigt, KCV) und Begründungen für die fehlenden.

    Auch bei aktuellem Verlust wird der Verlauf gezeigt, solange es früher Zeiträume mit Gewinn gab; er endet dann
    dort, wo die Kennzahl negativ wurde.
    """
    shown, missing = [], []
    for c in candidates:
        label = SWITCH_LABELS[c["key"]]
        positive_now = c["current"] is not None and c["current"] > 0
        # Umsatz und normalisierter Gewinn erscheinen nur, wenn es sie gibt (keine gesperrte Schaltfläche)
        extra = c["key"] not in PRIMARY
        if len(c["points"]) < 2:
            if not extra:
                missing.append({"key": c["key"], "label": label, "current_value": c["current"],
                                "reason": "keine Daten" if not c["points"] else "zu wenige Jahreswerte"})
            continue
        current = c["current"] if c["current"] is not None else c["points"][-1][1]
        metric, series = _multiple_series(close, c["points"], current)
        dip = dips(metric)
        if series.count() < MIN_MULTIPLE_DAYS:
            loss = "negativer operativer Cashflow" if c["key"] == "ocf_ps" else "Verlust"
            never_positive = not positive_now and all(v <= 0 for _, v in c["points"])
            if not extra:
                missing.append({"key": c["key"], "label": label, "current_value": c["current"],
                                "reason": f"{loss} in allen verfügbaren Jahren" if never_positive else "zu wenige Jahre mit positivem Wert"})
            continue
        shown.append({
            "key": c["key"], "label": label, "metric_label": c["label"], "multiple_label": c["multiple_label"],
            "used": c is best, "current": price / c["current"] if positive_now else None,
            "current_value": c["current"], "loss_now": not positive_now,
            "averages": {str(n): a[0] for n in PERIODS if (a := _average(series, n, dip))},
            "series": _weekly(series),
            "excluded": _ranges(dip & series.notna()),
        })
    return shown, missing


def basis_issue(c: dict) -> str | None:
    """Warum sich eine Kennzahl nicht als Bewertungsgrundlage eignet; None = geeignet."""
    values = [v for _, v in c["points"]]
    negative = {"ocf_ps": "negativer Cashflow", "rev_ps": "kein Umsatz"}.get(c["key"], "Verlust")
    if not values:
        return "keine Daten"
    if c["stability"] is None:
        return "zu wenige Jahreswerte"
    if not c["current"] or c["current"] <= 0:
        return f"aktuell {negative}"
    if values[-1] <= 0:
        return f"{negative} im letzten Geschäftsjahr"
    recent = values[-RECENT_YEARS:]
    bad = sum(v <= 0 for v in recent)
    if len(recent) - bad < MIN_POSITIVE_SHARE * len(recent):
        return f"{negative} in {bad} der letzten {len(recent)} Geschäftsjahre"
    return None


def _periods(multiple: pd.Series, dip: pd.Series, current: float, price: float) -> dict:
    periods, prev_covered = {}, None
    for n in PERIODS:
        avg = _average(multiple, n, dip)
        # Ein längerer Zeitraum ohne zusätzliche Daten (Historie nur 4 Jahre: 5 und 10 Jahre gleich) entfällt
        if avg is None or (prev_covered is not None and avg[1] < prev_covered + 0.5):
            periods[str(n)] = None
            continue
        prev_covered = avg[1]
        fair = avg[0] * current
        dev = price / fair - 1
        periods[str(n)] = {"avg_multiple": avg[0], "fair_value": fair, "deviation": dev, "rating": rating(dev),
                           "covered_years": avg[1], "excluded_share": avg[2]}
    return periods


NO_BASIS = ("Keine verlässliche Bewertung möglich: Für einen fairen Wert muss der Gewinn oder der operative Cashflow "
            "in den letzten 12 Monaten und im letzten Geschäftsjahr positiv sein, in den letzten 5 Geschäftsjahren "
            "höchstens einmal negativ gewesen sein und mindestens 2 Jahre verwertbare Kursdaten haben (ohne Phasen, in "
            "denen die Kennzahl vorübergehend eingebrochen war). Das trifft hier auf keine Kennzahl zu.")


def _candidate(key: str, label: str, multiple_label: str, pts: list, current: float | None) -> dict:
    if current is None and pts:
        current = pts[-1][1]
    return {"key": key, "label": label, "multiple_label": multiple_label, "points": pts, "n": len(pts),
            "current": current, **trend_stats(pts)}


def normalized_points(eps_points: list, eps_now: float | None) -> tuple[list, float | None]:
    """Gleitender Durchschnitt des Gewinns über NORM_YEARS Geschäftsjahre; aktuell: letzte 4 Jahre + 12 Monate."""
    values = [v for _, v in eps_points]
    if len(values) < NORM_MIN_POINTS:
        return [], None
    pts = [(eps_points[i][0], sum(values[i - NORM_YEARS + 1:i + 1]) / NORM_YEARS)
           for i in range(NORM_YEARS - 1, len(values))]
    recent = values[-(NORM_YEARS - 1):] + ([eps_now] if eps_now is not None else [values[-1]])
    return pts, sum(recent) / len(recent)


def expected_growth(best: dict, estimates: dict, short_history: bool) -> dict:
    """Wachstum für die erwartete Rendite: Mittel aus Analystenschätzung (2 Jahre) und eigener Historie, gekappt."""
    sources = {}
    e0, e1 = estimates.get("0y") or {}, estimates.get("+1y") or {}
    base = e0.get("year_ago")
    if best["key"] in PRIMARY and base and base > 0:
        if e1.get("avg") and e1["avg"] > 0:
            sources["analysts"] = (e1["avg"] / base) ** 0.5 - 1
        elif e0.get("avg") and e0["avg"] > 0:
            sources["analysts"] = e0["avg"] / base - 1
    if best.get("growth") is not None and not short_history:
        sources["history"] = best["growth"]
    if not sources:
        return {"growth": None, "sources": {}}
    g = sum(sources.values()) / len(sources)
    return {"growth": min(GROWTH_RANGE[1], max(GROWTH_RANGE[0], g)), "sources": sources}


def expected_returns(periods: dict, current: float, price: float, growth: float | None, div_yield: float) -> dict:
    """Rendite pro Jahr, wenn die Kennzahl mit `growth` wächst und das Multiple zum Durchschnitt zurückkehrt."""
    out = {}
    if growth is None or not price:
        return out
    for key, per in periods.items():
        if per:
            future = per["avg_multiple"] * current * (1 + growth) ** EXPECTED_YEARS
            out[key] = (future / price) ** (1 / EXPECTED_YEARS) - 1 + (div_yield or 0)
    return out


def build(close: pd.Series, price: float, annual: list[dict], ttm: dict, estimates: dict,
          div_yield: float = 0.0) -> dict:
    today = close.index[-1]
    candidates = [_candidate(key, label, mult, [(r["end"], r[key]) for r in annual if r.get(key) is not None], ttm.get(key))
                  for key, label, mult in METRICS]
    primary = list(candidates)
    eps_points = [(r["end"], r["eps"]) for r in annual if r.get("eps") is not None]
    norm_pts, norm_now = normalized_points(eps_points, ttm.get("eps"))
    norm = _candidate(*NORMALIZED, norm_pts, norm_now) if norm_pts else None
    revenue = _candidate(*FALLBACK, [(r["end"], r["rev_ps"]) for r in annual if r.get("rev_ps") is not None],
                         ttm.get("rev_ps"))
    candidates += [c for c in (norm, revenue) if c and c["points"]]

    issues = {c["key"]: basis_issue(c) for c in candidates}
    # Kurze Reihen erreichen leicht hohe R²-Werte; deshalb nur Kennzahlen mit vergleichbar langer Historie.
    # Maßstab sind alle Reihen mit Daten, damit z. B. 4 Jahre bereinigter Gewinn keine 15 Jahre Verlustgeschichte ersetzen
    with_data = [c for c in primary if c["stability"] is not None]
    longest = min(11, max((c["n"] for c in with_data), default=0))
    for c in primary:
        if issues[c["key"]] is None and min(c["n"], 11) < longest - 2:
            issues[c["key"]] = "kürzere Historie, nicht verwendet"

    best = metric = multiple = dip = periods = None

    def attempt(c: dict) -> bool:
        nonlocal best, metric, multiple, dip, periods
        m, mult = _multiple_series(close, c["points"], c["current"])
        d = dips(m)
        per = _periods(mult, d, c["current"], price)
        if not any(per.values()):
            issues[c["key"]] = "weniger als 2 Jahre verwertbare Kursdaten"
            return False
        best, metric, multiple, dip, periods = c, m, mult, d, per
        return True

    for c in sorted((c for c in primary if issues[c["key"]] is None),
                    key=lambda c: (round(c["stability"], 2), c["n"]), reverse=True):
        if attempt(c):
            break
    basis_note = None
    if norm:
        # Zykliker: Die gewählte Kennzahl schwankt stark, der Durchschnittsgewinn verläuft deutlich gleichmäßiger.
        # Ohne verwendbare Kennzahl (aktuell Verlust) gibt es auch keinen normalisierten fairen Wert
        if best is None or best["stability"] >= CYCLICAL_STABILITY:
            issues[norm["key"]] = issues[norm["key"]] or "nur bei stark schwankendem Gewinn verwendet"
        elif issues[norm["key"]] is None and norm["stability"] < best["stability"] + NORM_MIN_GAIN:
            issues[norm["key"]] = "verläuft nicht deutlich gleichmäßiger als die gewählte Kennzahl"
        elif issues[norm["key"]] is None:
            previous = (best, metric, multiple, dip, periods)
            if attempt(norm):
                basis_note = "normalized"
            else:
                best, metric, multiple, dip, periods = previous
    if revenue["points"]:
        if best is not None:
            issues[revenue["key"]] = issues[revenue["key"]] or "nur Ersatz, wenn Gewinn und Cashflow nicht taugen"
        elif issues[revenue["key"]] is None and attempt(revenue):
            basis_note = "revenue"

    stabilities = [{"key": c["key"], "label": c["label"], "stability": c["stability"], "years": c["years"],
                    "issue": issues[c["key"]]} for c in candidates]
    if best is None:
        shown, missing = _multiples(close, price, candidates)
        return {"available": False, "stabilities": stabilities, "multiples": shown, "multiples_missing": missing,
                "reason": NO_BASIS}

    # Verläufe aller Kennzahlen, damit z. B. bei Bewertung über den Cashflow trotzdem der KGV-Verlauf sichtbar ist
    multiples, missing = _multiples(close, price, candidates, best)

    # Ist die Kennzahl gerade selbst eingebrochen, wäre der faire Wert zu niedrig und die Aktie erschiene
    # fälschlich als überbewertet; bei kurzer Historie hängt der Durchschnitt an einer einzigen Phase.
    # In beiden Fällen bleiben die Werte sichtbar, die Einordnung entfällt
    dip_now = bool(dip.iloc[-1])
    # der normalisierte Gewinn beginnt erst im 5. Jahr; maßgeblich ist die Länge der Gewinnreihe dahinter
    short_history = is_short(trend_stats(eps_points)["years"] if best is norm else best["years"])
    if dip_now or short_history:
        for per in periods.values():
            if per:
                per["rating"] = DISTORTED if dip_now else SHORT
    default_period = next((p for p in ("10", "5", "3") if periods.get(p)), None)
    last_point = best["points"][-1] if best["points"] else None
    # Analystenschätzungen gelten für den Gewinn; Umsatz und Durchschnittsgewinn schreiben sie nicht fort
    forecasts = forecast_points(last_point, estimates, today) if best["key"] in PRIMARY else []
    spread = None
    if forecasts and forecasts[-1].get("low") and forecasts[-1].get("high") and forecasts[-1]["avg"]:
        spread = (forecasts[-1]["high"] - forecasts[-1]["low"]) / forecasts[-1]["avg"]
    growth = expected_growth(best, estimates, short_history)

    return {
        "available": True,
        "metric_key": best["key"], "metric_label": best["label"], "multiple_label": best["multiple_label"],
        # "normalized": Zykliker, bewertet mit dem Ø-Gewinn; "revenue": Ersatz über den Umsatz
        "basis_note": basis_note,
        "expected": {"growth": growth["growth"], "sources": growth["sources"], "years": EXPECTED_YEARS,
                     "dividend_yield": div_yield or 0.0,
                     "by_period": expected_returns(periods, best["current"], price, growth["growth"], div_yield)},
        "stabilities": stabilities,
        "current_value": best["current"], "current_multiple": price / best["current"],
        # Kennzahl gerade selbst eingebrochen: der faire Wert (Ø-Multiple × aktuelle Kennzahl) fällt dann zu niedrig aus
        "dip_now": dip_now,
        # Kennzahl reicht weniger als ~5 Jahre zurück: keine Einordnung als über- oder unterbewertet
        "short_history": short_history,
        "history_years": round((today - best["points"][0][0]).days / 365.25, 1),
        "periods": periods, "default_period": default_period,
        "metric_series": _weekly(metric),
        "multiple_series": _weekly(multiple),
        "multiples": multiples,
        "multiples_missing": missing,
        "forecasts": forecasts,
        "forecast_spread": spread,
        "data_start": best["points"][0][0].strftime("%Y-%m-%d") if best["points"] else None,
    }
