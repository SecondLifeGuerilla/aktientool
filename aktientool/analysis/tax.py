"""Dividende nach Steuern für Anleger in Deutschland: ausländische Quellensteuer plus deutsche Abgeltungsteuer.

Die ausländische Quellensteuer wird bis zum Satz des Doppelbesteuerungsabkommens (meist 15 %) auf die deutsche
Abgeltungsteuer von 25 % angerechnet; der Solidaritätszuschlag (5,5 %) fällt auf den verbleibenden Betrag an.
Was über dem anrechenbaren Satz liegt (Schweiz: 35 % − 15 % = 20 %), ist ohne Antrag im Ausland verloren.
Kirchensteuer und Sparerpauschbetrag bleiben unberücksichtigt.
"""

from __future__ import annotations

import json

from .. import config

ABGELTUNG = 0.25
SOLI = 0.055
UNKNOWN = {"satz": 0.15, "anrechenbar": 0.15, "hinweis": "Satz unbekannt; angenommen werden 15 %"}


def load_rates() -> dict:
    try:
        return json.loads(config.WITHHOLDING_FILE.read_text("utf-8")).get("laender", {})
    except (OSError, ValueError):
        return {}


def for_country(country: str | None, rates: dict | None = None) -> dict:
    """Steuerlast auf eine Bruttodividende, als Anteile (0,26 = 26 %)."""
    rates = load_rates() if rates is None else rates
    entry = rates.get((country or "").upper()) or UNKNOWN
    withholding = float(entry.get("satz", 0.0))
    credited = min(withholding, float(entry.get("anrechenbar", 0.0)))
    german = max(0.0, ABGELTUNG - credited) * (1 + SOLI)
    total = withholding + german
    return {"country": country, "withholding": withholding, "creditable": credited,
            "refundable": withholding - credited, "german": german, "total": total, "net_share": 1 - total,
            "note": entry.get("hinweis", ""), "known": bool(rates.get((country or "").upper()))}
