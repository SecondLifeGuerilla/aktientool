"""Eigene Angaben des Nutzers, soweit der Server sie zum Rechnen braucht.

Der Server speichert nichts über Nutzer. Depot, Watchlist, Gruppen, Notizen und Alarme liegen im Browser
(static/js/store.js). Zwei Dinge fließen aber in Berechnungen des Servers ein und werden deshalb mit jeder Anfrage
mitgeschickt (Kontext, siehe server.py):

- Korrekturen zur Handelbarkeit bei Trade Republic: {Ticker: true/false}
- eigene oder geänderte Holdings: {Ticker: Definition wie in aktientool/holdings.json}

Außerhalb einer Anfrage (täglicher Daten-Workflow, Tests) ist der Kontext leer.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
from contextlib import contextmanager

try:
    from flask import g, has_request_context, request
except ImportError:  # pragma: no cover - Flask fehlt nur in Hilfsskripten
    g = request = None

    def has_request_context() -> bool:
        return False

MAX_CONTEXT_BYTES = 1_000_000
SYMBOL_RE = re.compile(r"^[A-Z0-9.\-^=]{1,20}$")

_outside: dict = {}  # Kontext außerhalb einer Anfrage (Tests, Hilfsskripte)


class InvalidInput(ValueError):
    pass


ALERT_TYPES = {
    "price_below": "Kurs fällt unter",
    "price_above": "Kurs steigt über",
    "below_fair": "Kurs mindestens x % unter fairem Wert",
    "dividend_cut": "Dividende gekürzt",
    "score_below": "Gesamt-Score der Weltauswahl fällt unter",
}


def _now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def _number(value, name: str, positive: bool = True) -> float:
    try:
        f = float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        raise InvalidInput(f"{name}: keine Zahl")
    if not math.isfinite(f):
        raise InvalidInput(f"{name}: keine Zahl")
    if positive and f <= 0:
        raise InvalidInput(f"{name} muss größer als 0 sein")
    return f


def _day(value) -> str | None:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        raise InvalidInput("Datum im Format JJJJ-MM-TT angeben")


def _text(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


# ---------------------------------------------------------------- Kontext der Anfrage

def _parse_context(raw) -> dict:
    """Prüft den mitgeschickten Kontext; Ungültiges fällt still heraus (der Browser kann alte Daten haben)."""
    if not raw:
        return {"tradable": {}, "holdings": {}}
    try:
        data = json.loads(raw) if isinstance(raw, (bytes, str)) else raw
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    tradable = data.get("tradable") if isinstance(data.get("tradable"), dict) else {}
    tradable = {str(k).upper(): v for k, v in tradable.items() if isinstance(v, bool) and SYMBOL_RE.match(str(k).upper())}
    holdings = {}
    raw_holdings = data.get("holdings") if isinstance(data.get("holdings"), dict) else {}
    for sym, d in list(raw_holdings.items())[:200]:
        sym = str(sym).upper()
        if not SYMBOL_RE.match(sym) or not isinstance(d, dict):
            continue
        try:
            holdings[sym] = clean_holding_def(sym, d, keep_updated=True)
        except InvalidInput:
            continue
    return {"tradable": tradable, "holdings": holdings}


def context() -> dict:
    """{"tradable": {...}, "holdings": {...}} der laufenden Anfrage."""
    if not has_request_context():
        return _parse_context(_outside) if _outside else {"tradable": {}, "holdings": {}}
    if "aktientool_context" not in g:
        g.aktientool_context = _parse_context(request.environ.get("aktientool.context"))
    return g.aktientool_context


@contextmanager
def use_context(data: dict):
    """Kontext außerhalb einer Anfrage setzen (Tests und Hilfsskripte)."""
    global _outside
    before = _outside
    _outside = data
    try:
        yield
    finally:
        _outside = before


def add_holding_to_context(symbol: str, definition: dict) -> None:
    """Für die laufende Anfrage eine (gerade geprüfte) Holding ergänzen oder ersetzen."""
    context()["holdings"][symbol] = definition


def tradable_overrides() -> dict[str, bool]:
    """Eigene Korrekturen zur Handelsliste der LS Exchange: {Ticker: handelbar ja/nein}."""
    return context()["tradable"]


def tradable_key() -> str:
    """Kurzer Fingerabdruck der Korrekturen (Teil der Datenversion der Weltauswahl)."""
    items = tradable_overrides()
    if not items:
        return "0"
    raw = json.dumps(sorted(items.items()), separators=(",", ":")).encode()
    return hashlib.sha1(raw).hexdigest()[:8]


def holding_defs() -> dict[str, dict]:
    """Selbst angelegte oder geänderte Holdings: {Ticker: Definition wie in aktientool/holdings.json}."""
    return context()["holdings"]


# ---------------------------------------------------------------- Eigene Holdings prüfen

def clean_holding_def(symbol: str, data: dict, keep_updated: bool = False) -> dict:
    """Prüft eine Holding: Stichtag, Aktienzahl, börsennotierte Beteiligungen (Ticker mit Stückzahl oder Wert am
    Stichtag) und übrige Posten (Wert in der Währung der Holding, Schulden negativ). Gibt die bereinigte Definition
    zurück, die der Browser speichert."""
    currency = _text(data.get("currency"), 10).upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise InvalidInput("Währung als dreistelliges Kürzel angeben (z. B. EUR, SEK)")
    as_of = _day(data.get("as_of"))
    if not as_of:
        raise InvalidInput("Stichtag des Berichts angeben")
    positions = []
    for p in data.get("positions") or []:
        if not isinstance(p, dict):
            raise InvalidInput("Ungültige Beteiligung")
        sym = _text(p.get("symbol"), 20).upper()
        if not SYMBOL_RE.match(sym):
            raise InvalidInput(f"Ungültiger Ticker: {p.get('symbol')!r}")
        item = {"name": _text(p.get("name"), 120) or sym, "symbol": sym}
        if p.get("value") not in (None, ""):
            item["value"] = _number(p["value"], f"Wert von {sym}")
        else:
            item["shares"] = _number(p.get("shares"), f"Stückzahl von {sym}")
        positions.append(item)
    other = []
    for o in data.get("other") or []:
        if not isinstance(o, dict):
            raise InvalidInput("Ungültiger Posten")
        other.append({"name": _text(o.get("name"), 160) or "Sonstiges", "value": _number(o.get("value"), "Wert", positive=False)})
    if not positions and not other:
        raise InvalidInput("Mindestens eine Beteiligung oder einen Posten angeben")
    if len(positions) > 60 or len(other) > 40:
        raise InvalidInput("Zu viele Positionen")
    updated = _text(data.get("updated"), 40) if keep_updated else ""
    item = {"symbol": symbol, "name": _text(data.get("name"), 120) or symbol, "currency": currency, "as_of": as_of,
            "shares": _number(data.get("shares"), "Aktienzahl der Holding"),
            "source": _text(data.get("source"), 200), "url": _text(data.get("url"), 500),
            "positions": positions, "other": other, "updated": updated or _now()}
    if data.get("nav_ps_reported") not in (None, ""):
        item["nav_ps_reported"] = _number(data["nav_ps_reported"], "NAV je Aktie laut Bericht")
    if data.get("aliases"):
        aliases = data["aliases"] if isinstance(data["aliases"], list) else []
        item["aliases"] = [a for a in (str(x).upper() for x in aliases) if SYMBOL_RE.match(a)][:5]
    if data.get("isin") and re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}\d", str(data["isin"]).upper()):
        item["isin"] = str(data["isin"]).upper()
    return item
