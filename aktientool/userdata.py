"""Eigene Daten des Nutzers: Depot, Notizen, Alarme, Korrekturen zur Handelbarkeit und eigene Holdings, je als
JSON-Datei im Datenordner.

Schreiben läuft über eine temporäre Datei, damit ein Absturz keine halbe Datei hinterlässt.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import re
import threading
import uuid
from pathlib import Path

from . import config

_lock = threading.RLock()


class InvalidInput(ValueError):
    pass


def _read(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(path)


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


# ---------------------------------------------------------------- Notizen

def note(symbol: str) -> dict:
    return _read(config.NOTES_FILE, {}).get(symbol, {"text": "", "updated": None})


def save_note(symbol: str, text: str) -> dict:
    text = (text or "").strip()[:20000]
    with _lock:
        notes = _read(config.NOTES_FILE, {})
        if text:
            notes[symbol] = {"text": text, "updated": _now()}
        else:
            notes.pop(symbol, None)
        _write(config.NOTES_FILE, notes)
    return notes.get(symbol, {"text": "", "updated": None})


def all_notes() -> dict:
    return _read(config.NOTES_FILE, {})


# ---------------------------------------------------------------- Depot

def positions() -> list[dict]:
    return _read(config.DEPOT_FILE, [])


def _lot(symbol: str, data: dict) -> dict:
    return {
        "id": uuid.uuid4().hex[:10], "symbol": symbol,
        "shares": _number(data.get("shares"), "Stückzahl"),
        "price": _number(data.get("price"), "Kaufkurs"), "currency": "EUR",
        "date": _day(data.get("date")),
        "note": str(data.get("note") or "")[:500],
    }


def add_position(symbol: str, data: dict) -> list[dict]:
    """Ein Kauf: Stückzahl, Kaufkurs je Aktie in Euro, Kaufdatum (optional) und Notiz. Käufe ohne "currency" stammen
    aus der Zeit vor der Euro-Anzeige; ihr Kaufkurs ist in der Kurswährung der Aktie."""
    item = _lot(symbol, data)
    with _lock:
        items = positions()
        items.append(item)
        _write(config.DEPOT_FILE, items)
    return items


def add_positions(entries: list[tuple[str, dict]]) -> list[dict]:
    """Mehrere Käufe auf einmal (CSV-Import): erst alle prüfen, dann alle oder keinen speichern."""
    new = []
    for i, (symbol, data) in enumerate(entries, 1):
        try:
            new.append(_lot(symbol, data))
        except InvalidInput as e:
            raise InvalidInput(f"Zeile {i} ({symbol}): {e}")
    with _lock:
        items = positions() + new
        _write(config.DEPOT_FILE, items)
    return items


def restore_position(symbol: str, data: dict) -> list[dict]:
    """Gelöschten Kauf zurückholen („Rückgängig“): mit derselben Kennung und Währung wie vorher."""
    item = _lot(symbol, data)
    item_id = str(data.get("id") or "")
    if re.fullmatch(r"[0-9a-f]{6,32}", item_id):
        item["id"] = item_id
    if data.get("currency") != "EUR":
        item.pop("currency")  # Kauf aus der Zeit vor der Euro-Anzeige: Kaufkurs in Kurswährung
    with _lock:
        items = positions()
        if not any(p["id"] == item["id"] for p in items):
            items.append(item)
            _write(config.DEPOT_FILE, items)
    return items


def update_position(item_id: str, data: dict) -> list[dict]:
    """Einen Kauf korrigieren: Stückzahl, Kaufkurs, Datum und Notiz; nur die übergebenen Felder ändern sich.
    Die Währung bleibt, wie sie war (alte Käufe ohne "currency" behalten ihren Kaufkurs in Kurswährung)."""
    with _lock:
        items = positions()
        item = next((p for p in items if p["id"] == item_id), None)
        if item is None:
            raise InvalidInput("Kauf nicht gefunden")
        if "shares" in data:
            item["shares"] = _number(data.get("shares"), "Stückzahl")
        if "price" in data:
            item["price"] = _number(data.get("price"), "Kaufkurs")
        if "date" in data:
            item["date"] = _day(data.get("date"))
        if "note" in data:
            item["note"] = str(data.get("note") or "")[:500]
        _write(config.DEPOT_FILE, items)
    return items


def remove_position(item_id: str) -> list[dict]:
    with _lock:
        items = [p for p in positions() if p["id"] != item_id]
        _write(config.DEPOT_FILE, items)
    return items


# ---------------------------------------------------------------- Alarme

ALERT_TYPES = {
    "price_below": "Kurs fällt unter",
    "price_above": "Kurs steigt über",
    "below_fair": "Kurs mindestens x % unter fairem Wert",
    "dividend_cut": "Dividende gekürzt",
    "score_below": "Gesamt-Score der Weltauswahl fällt unter",
}


def alerts() -> list[dict]:
    return _read(config.ALERTS_FILE, [])


def add_alert(symbol: str, data: dict) -> list[dict]:
    kind = data.get("type")
    if kind not in ALERT_TYPES:
        raise InvalidInput("Unbekannte Art von Alarm")
    value = None if kind == "dividend_cut" else _number(data.get("value"), "Schwelle", positive=kind != "below_fair")
    item = {"id": uuid.uuid4().hex[:10], "symbol": symbol, "type": kind, "value": value,
            "created": _now(), "triggered": None, "message": None, "seen": True, "baseline": data.get("baseline"),
            # Kursschwellen in Euro; die Dividende vergleicht intern in Kurswährung, angezeigt wird sie in Euro
            "currency": "EUR" if kind in ("price_below", "price_above") else None, "baseline_eur": data.get("baseline_eur")}
    with _lock:
        items = alerts()
        items.append(item)
        _write(config.ALERTS_FILE, items)
    return items


def update_alerts(changes: dict[str, dict]) -> list[dict]:
    with _lock:
        items = alerts()
        for a in items:
            if a["id"] in changes:
                a.update(changes[a["id"]])
        _write(config.ALERTS_FILE, items)
    return items


def restore_alert(symbol: str, data: dict, index: int | None = None) -> list[dict]:
    """Gelöschten Alarm zurückholen („Rückgängig“): unverändert samt Ausgangswert und Status, an seiner alten Stelle."""
    if data.get("type") not in ALERT_TYPES:
        raise InvalidInput("Unbekannte Art von Alarm")
    item_id = str(data.get("id") or "")
    if not re.fullmatch(r"[0-9a-f]{6,32}", item_id):
        raise InvalidInput("Ungültige Kennung")
    keys = ("type", "value", "created", "triggered", "message", "seen", "baseline", "currency", "baseline_eur")
    item = {"id": item_id, "symbol": symbol, **{k: data.get(k) for k in keys}}
    if item["value"] is not None:
        item["value"] = _number(item["value"], "Schwelle", positive=item["type"] != "below_fair")
    with _lock:
        items = alerts()
        if not any(a["id"] == item_id for a in items):
            at = len(items) if index is None else max(0, min(int(index), len(items)))
            items.insert(at, item)
            _write(config.ALERTS_FILE, items)
    return items


def remove_alert(item_id: str) -> list[dict]:
    with _lock:
        items = [a for a in alerts() if a["id"] != item_id]
        _write(config.ALERTS_FILE, items)
    return items


# ---------------------------------------------------------------- Handelbarkeit bei Trade Republic

def tradable_overrides() -> dict[str, bool]:
    """Eigene Korrekturen zur Handelsliste der LS Exchange: {Ticker: handelbar ja/nein}."""
    data = _read(config.TRADABLE_FILE, {})
    return {k: v for k, v in data.items() if isinstance(v, bool)} if isinstance(data, dict) else {}


def tradable_mtime() -> float:
    try:
        return config.TRADABLE_FILE.stat().st_mtime
    except FileNotFoundError:
        return 0.0


def set_tradable(symbol: str, value) -> dict[str, bool]:
    """True/False: eigene Angabe; None: zurück zur Handelsliste."""
    if value is not None and not isinstance(value, bool):
        raise InvalidInput("Erwartet wird true, false oder null")
    with _lock:
        items = tradable_overrides()
        if value is None:
            items.pop(symbol, None)
        else:
            items[symbol] = value
        _write(config.TRADABLE_FILE, items)
    return items


# ---------------------------------------------------------------- Eigene Holdings (innerer Wert aus den Beteiligungen)

SYMBOL_RE = re.compile(r"^[A-Z0-9.\-^=]{1,20}$")


def holding_defs() -> dict[str, dict]:
    """Selbst angelegte oder geänderte Holdings: {Ticker: Definition wie in aktientool/holdings.json}."""
    data = _read(config.USER_HOLDINGS_FILE, {})
    return data if isinstance(data, dict) else {}


def _text(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def save_holding_def(symbol: str, data: dict) -> dict:
    """Prüft und speichert eine Holding: Stichtag, Aktienzahl, börsennotierte Beteiligungen (Ticker mit Stückzahl
    oder Wert am Stichtag) und übrige Posten (Wert in der Währung der Holding, Schulden negativ)."""
    currency = _text(data.get("currency"), 10).upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise InvalidInput("Währung als dreistelliges Kürzel angeben (z. B. EUR, SEK)")
    as_of = _day(data.get("as_of"))
    if not as_of:
        raise InvalidInput("Stichtag des Berichts angeben")
    positions = []
    for p in data.get("positions") or []:
        sym = _text(p.get("symbol"), 20).upper()
        if not SYMBOL_RE.match(sym):
            raise InvalidInput(f"Ungültiger Ticker: {p.get('symbol')!r}")
        item = {"name": _text(p.get("name"), 120) or sym, "symbol": sym}
        if p.get("value") not in (None, ""):
            item["value"] = _number(p["value"], f"Wert von {sym}")
        else:
            item["shares"] = _number(p.get("shares"), f"Stückzahl von {sym}")
        positions.append(item)
    other = [{"name": _text(o.get("name"), 160) or "Sonstiges", "value": _number(o.get("value"), "Wert", positive=False)}
             for o in data.get("other") or []]
    if not positions and not other:
        raise InvalidInput("Mindestens eine Beteiligung oder einen Posten angeben")
    if len(positions) > 60 or len(other) > 40:
        raise InvalidInput("Zu viele Positionen")
    item = {"symbol": symbol, "name": _text(data.get("name"), 120) or symbol, "currency": currency, "as_of": as_of,
            "shares": _number(data.get("shares"), "Aktienzahl der Holding"),
            "source": _text(data.get("source"), 200), "url": _text(data.get("url"), 500),
            "positions": positions, "other": other, "updated": _now()}
    if data.get("nav_ps_reported") not in (None, ""):
        item["nav_ps_reported"] = _number(data["nav_ps_reported"], "NAV je Aktie laut Bericht")
    if data.get("aliases"):
        item["aliases"] = [a for a in (str(x).upper() for x in data["aliases"]) if SYMBOL_RE.match(a)][:5]
    with _lock:
        items = holding_defs()
        items[symbol] = item
        _write(config.USER_HOLDINGS_FILE, items)
    return item


def remove_holding_def(symbol: str) -> None:
    with _lock:
        items = holding_defs()
        if items.pop(symbol, None) is not None:
            _write(config.USER_HOLDINGS_FILE, items)


# ---------------------------------------------------------------- Gruppen der Watchlist

GROUP_MAX_DEPTH = 3  # Gruppe › Untergruppe › Unter-Untergruppe
_GROUP_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def watch_groups() -> list[dict]:
    """Gruppen der Watchlist in Anzeigereihenfolge: [{id, name, parent (Id oder None), symbols}].
    Eine Aktie kann in mehreren Gruppen stehen; Aktien einer Untergruppe zählen auch zur übergeordneten Gruppe."""
    data = _read(config.WATCH_GROUPS_FILE, [])
    return data if isinstance(data, list) else []


def save_watch_groups(groups) -> list[dict]:
    """Ersetzt alle Gruppen (die Oberfläche schickt immer den ganzen Baum). Prüft Namen, Eltern, Tiefe und Ticker."""
    if not isinstance(groups, list):
        raise InvalidInput("Erwartet wird eine Liste von Gruppen.")
    if len(groups) > 300:
        raise InvalidInput("Höchstens 300 Gruppen")
    clean, ids = [], set()
    for g in groups:
        if not isinstance(g, dict):
            raise InvalidInput("Ungültige Gruppe")
        gid = str(g.get("id") or "").strip() or uuid.uuid4().hex[:10]
        if not _GROUP_ID_RE.match(gid) or gid in ids:
            raise InvalidInput(f"Ungültige oder doppelte Gruppen-Id: {gid!r}")
        name = re.sub(r"\s+", " ", _text(g.get("name"), 200))[:60]
        if not name:
            raise InvalidInput("Jede Gruppe braucht einen Namen")
        symbols = []
        for s in g.get("symbols") or []:
            sym = _text(s, 20).upper()
            if not SYMBOL_RE.match(sym):
                raise InvalidInput(f"Ungültiger Ticker: {s!r}")
            if sym not in symbols:
                symbols.append(sym)
        parent = g.get("parent") or None
        ids.add(gid)
        clean.append({"id": gid, "name": name, "parent": str(parent) if parent else None, "symbols": symbols[:2000]})
    by_id = {g["id"]: g for g in clean}
    for g in clean:
        if g["parent"] and g["parent"] not in by_id:
            raise InvalidInput(f"Übergeordnete Gruppe von „{g['name']}“ fehlt")
        depth, seen, cur = 1, {g["id"]}, g
        while cur["parent"]:
            cur = by_id[cur["parent"]]
            if cur["id"] in seen:
                raise InvalidInput(f"„{g['name']}“ kann nicht in sich selbst liegen")
            seen.add(cur["id"])
            depth += 1
        if depth > GROUP_MAX_DEPTH:
            raise InvalidInput(f"„{g['name']}“: höchstens {GROUP_MAX_DEPTH} Ebenen (Gruppe › Untergruppe › Unter-Untergruppe)")
    siblings = set()
    for g in clean:
        key = (g["parent"], g["name"].casefold())
        if key in siblings:
            raise InvalidInput(f"Die Gruppe „{g['name']}“ gibt es an dieser Stelle schon")
        siblings.add(key)
    with _lock:
        _write(config.WATCH_GROUPS_FILE, clean)
    return clean
