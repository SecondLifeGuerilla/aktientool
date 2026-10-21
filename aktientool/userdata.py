"""Eigene Daten des Nutzers: Depot, Notizen und Alarme, je als JSON-Datei im Datenordner.

Schreiben läuft über eine temporäre Datei, damit ein Absturz keine halbe Datei hinterlässt.
"""

from __future__ import annotations

import datetime as dt
import json
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


def add_position(symbol: str, data: dict) -> list[dict]:
    """Ein Kauf: Stückzahl, Kaufkurs in Kurswährung der Aktie, Kaufdatum (optional) und Notiz."""
    item = {
        "id": uuid.uuid4().hex[:10], "symbol": symbol,
        "shares": _number(data.get("shares"), "Stückzahl"),
        "price": _number(data.get("price"), "Kaufkurs"),
        "date": _day(data.get("date")),
        "note": str(data.get("note") or "")[:500],
    }
    with _lock:
        items = positions()
        items.append(item)
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
            "created": _now(), "triggered": None, "message": None, "seen": True, "baseline": data.get("baseline")}
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


def remove_alert(item_id: str) -> list[dict]:
    with _lock:
        items = [a for a in alerts() if a["id"] != item_id]
        _write(config.ALERTS_FILE, items)
    return items
