"""Fazit in Worten, abgeleitet aus den Kennzahlen."""

from __future__ import annotations


def earnings_reliability(stability: float | None) -> str | None:
    if stability is None:
        return None
    if stability < 0:
        return "rückläufig"
    if stability >= 0.9:
        return "äußerst zuverlässig"
    if stability >= 0.75:
        return "zuverlässig"
    if stability >= 0.5:
        return "schwankend"
    return "unzuverlässig"


def growth_label(growth: float | None) -> str | None:
    if growth is None:
        return None
    if growth >= 0.12:
        return "dynamisches Gewinnwachstum"
    if growth >= 0.06:
        return "solides Gewinnwachstum"
    if growth >= 0:
        return "geringes Gewinnwachstum"
    return "schrumpfende Gewinne"


def sentiment(momentum: float | None) -> dict | None:
    if momentum is None:
        return None
    if momentum > 0.10:
        return {"label": "sehr positiv", "status": "good"}
    if momentum > 0:
        return {"label": "positiv", "status": "good"}
    if momentum > -0.10:
        return {"label": "negativ", "status": "serious"}
    return {"label": "sehr negativ", "status": "critical"}


SHORT_RELIABILITY = "kaum beurteilbar"
LOSS_RELIABILITY = "von Verlusten geprägt"


def build(quality: dict, valuation_rating: dict | None, momentum: float | None, scorecard: list[dict],
          warning_signs: dict | None = None) -> dict:
    short = quality.get("short", False)  # weniger als ~5 Jahre: kein Urteil über Zuverlässigkeit und Wachstum
    reliability = (LOSS_RELIABILITY if quality.get("loss_making")
                   else SHORT_RELIABILITY if short else earnings_reliability(quality.get("stability")))
    growth = None if short else growth_label(quality.get("growth"))
    mood = sentiment(momentum)
    positive_outlook = not short and (quality.get("stability") or 0) >= 0.75 and (quality.get("growth") or 0) > 0.03

    best = max(scorecard, key=lambda s: s["score"]) if scorecard else None
    fans = {"dividend_income": "Fans hoher Dividenden", "dividend_growth": "Fans steigender Dividenden",
            "earnings_growth": "Fans hoher Kursgewinne"}

    parts = []
    if best and best["score"] >= 6 and reliability in ("äußerst zuverlässig", "zuverlässig"):
        parts.append(f"Dank der {reliability.replace('äußerst ', '')}en Gewinnentwicklung scheint die Aktie als "
                     f"langfristiges Investment besonders für {fans[best['key']]} interessant.")
    elif best and best["score"] >= 6:
        parts.append(f"Die Aktie passt am ehesten zu {fans[best['key']]}, die Gewinnentwicklung ist aber {reliability or 'unklar'}.")
    else:
        parts.append("Für keine der drei Strategien erreicht die Aktie einen guten Score.")
    if valuation_rating and valuation_rating["label"] == "nicht aussagekräftig":
        parts.append("Die Bewertung ist derzeit nicht aussagekräftig, weil Gewinn bzw. Cashflow gerade vorübergehend "
                     "eingebrochen sind.")
    elif valuation_rating and valuation_rating["label"] == "unsicher (kurze Historie)":
        parts.append("Die Bewertung ist unsicher, weil nur wenige Jahre Bilanzdaten vorliegen; der faire Wert ist "
                     "deshalb nur ein grober Anhaltspunkt.")
    elif valuation_rating:
        label = valuation_rating["label"]
        if "über" in label:
            parts.append(f"Die Bewertung ({label}) spricht jedoch für einen ungünstigen Kaufzeitpunkt.")
        elif "unter" in label and (warning_signs or {}).get("trap"):
            # billig gemessen an der eigenen Vergangenheit, aber die Vergangenheit setzt sich womöglich nicht fort
            parts.append(f"Die Aktie wirkt günstig ({label}), {warning_signs['count']} Warnzeichen sprechen aber für "
                         "Vorsicht: Sie könnte zu Recht billig sein (mögliche Value-Falle).")
        elif "unter" in label:
            parts.append(f"Die Bewertung ({label}) spricht für einen günstigen Kaufzeitpunkt.")
        else:
            parts.append("Die Aktie ist aktuell fair bewertet.")
    else:
        parts.append("Eine verlässliche Bewertung ist nicht möglich, weil Gewinn und Cashflow zuletzt nicht "
                     "überwiegend positiv waren.")

    return {
        "earnings": {"reliability": reliability, "growth": growth,
                     "outlook": "langfristig ist mit einer positiven Rendite zu rechnen" if positive_outlook else None},
        "scores": [{"label": s["label"], "score": s["score"]} for s in scorecard],
        "valuation": valuation_rating,
        "sentiment": mood,
        "text": " ".join(parts),
    }
