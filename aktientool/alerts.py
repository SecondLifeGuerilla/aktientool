"""Alarme prüfen. Die Alarme speichert der Browser; er schickt die offenen alle 30 Minuten (solange das Tool geöffnet
ist) oder auf Knopfdruck zum Prüfen und merkt sich, welche ausgelöst haben.

Kursalarme nutzen den aktuellen Kurs (eine Sammelabfrage für alle Aktien), Bewertungs- und Dividendenalarme die
Kennzahlen aus dem Profil (höchstens 6 Stunden alt), der Score-Alarm die Weltauswahl.

Kursschwellen gelten in Euro (Feld "currency": "EUR"); der Kurs wird zum aktuellen Wechselkurs umgerechnet. Alarme
ohne dieses Feld stammen aus der Zeit vor der Euro-Anzeige und vergleichen weiter in der Kurswährung.
"""

from __future__ import annotations

import datetime as dt
import logging

from . import service, userdata, world
from .sources import fx, yahoo_screener

log = logging.getLogger(__name__)


def _fmt(x: float) -> str:
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def evaluate(alert: dict, price: float | None, row: dict | None, world_row: dict | None,
             rate: float | None = None) -> str | None:
    """Meldungstext, wenn der Alarm auslöst, sonst None. `price` und `row` sind in Kurswährung, `rate` = Euro je
    Einheit der Kurswährung (ohne Kurs: Beträge in der Kurswährung)."""
    kind, value, sym = alert["type"], alert.get("value"), alert["symbol"]

    def money(x: float) -> str:
        return f"{_fmt(x * rate)} €" if rate else _fmt(x)

    if kind in ("price_below", "price_above") and price is not None:
        in_eur = alert.get("currency") == "EUR"
        if in_eur and not rate:
            return None  # ohne Wechselkurs lässt sich eine Euro-Schwelle nicht prüfen
        now = price * rate if in_eur else price
        unit = " €" if in_eur else ""
        if kind == "price_below" and now <= value:
            return f"{sym}: Kurs {_fmt(now)}{unit} ist unter {_fmt(value)}{unit} gefallen."
        if kind == "price_above" and now >= value:
            return f"{sym}: Kurs {_fmt(now)}{unit} ist über {_fmt(value)}{unit} gestiegen."
    if kind == "below_fair" and row and row.get("fair_value") and row.get("deviation") is not None and price:
        dev = price / row["fair_value"] - 1
        if dev <= -value / 100:
            return f"{sym}: Kurs {money(price)} liegt {abs(dev) * 100:.0f} % unter dem fairen Wert von {money(row['fair_value'])}."
    if kind == "dividend_cut" and row and alert.get("baseline"):
        if (row.get("div_ttm") or 0) < alert["baseline"] * 0.95:
            return (f"{sym}: Die Dividende der letzten 12 Monate ist auf {money(row.get('div_ttm') or 0)} gesunken "
                    f"(beim Anlegen des Alarms {money(alert['baseline'])}).")
    if kind == "score_below" and world_row and world_row.get("score_total") is not None:
        if world_row["score_total"] < value:
            return f"{sym}: Der Gesamt-Score ist auf {world_row['score_total']} gefallen (Schwelle {value:.0f})."
    return None


MAX_ALERTS = 300


def check(items: list[dict]) -> dict[str, dict]:
    """Prüft die übergebenen offenen Alarme (der Browser speichert sie) und gibt die ausgelösten zurück:
    {Kennung: {"triggered": Zeitpunkt, "message": Text}}. Der Server merkt sich nichts."""
    pending = [a for a in items if isinstance(a, dict) and not a.get("triggered") and a.get("type") in userdata.ALERT_TYPES
               and isinstance(a.get("symbol"), str) and userdata.SYMBOL_RE.match(a["symbol"])][:MAX_ALERTS]
    triggered: dict[str, dict] = {}
    if not pending:
        return triggered
    symbols = sorted({a["symbol"] for a in pending})
    quotes = {q["symbol"]: q for q in yahoo_screener.quotes(symbols)}
    rates = fx.eur_quotes(list({q.get("currency") for q in quotes.values() if q.get("currency")}))
    rows: dict[str, dict | None] = {}
    for a in pending:
        sym = a["symbol"]
        if a["type"] != "dividend_cut" and not isinstance(a.get("value"), (int, float)):
            continue
        quote = quotes.get(sym) or {}
        price = quote.get("regularMarketPrice")
        rate = (rates.get(quote.get("currency")) or {}).get("rate")
        row = None
        if a["type"] in ("below_fair", "dividend_cut"):
            if sym not in rows:
                try:
                    rows[sym] = service.summary_row(sym)
                except Exception as e:
                    log.info("Alarm %s: Profil nicht verfügbar: %s", sym, e)
                    rows[sym] = None
            row = rows[sym]
        world_row = world.stock(sym) if a["type"] == "score_below" else None
        try:
            msg = evaluate(a, price, row, world_row, rate)
        except (TypeError, ValueError, KeyError) as e:  # unvollständiger Alarm aus dem Browser
            log.info("Alarm %s nicht prüfbar: %s", a.get("id"), e)
            continue
        if msg:
            triggered[str(a.get("id"))] = {"triggered": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                                           "message": msg}
    return triggered
