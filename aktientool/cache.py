"""Einfacher Datei-Cache: ein JSON pro Schlüssel, gültig solange die Datei jünger als die TTL ist."""

import json
import re
import threading
import time
from collections import defaultdict
from typing import Any, Callable

from .config import CACHE_DIR

_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()


def _path(key: str):
    safe = re.sub(r"[^A-Za-z0-9._=-]", "_", key)
    return CACHE_DIR / f"{safe}.json"


def _lock(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks[key]


def cached(key: str, ttl: int, loader: Callable[[], Any], refresh: bool = False) -> Any:
    """Liefert den Cache-Inhalt zu `key` oder lädt ihn neu, wenn er fehlt, abgelaufen ist oder `refresh` gesetzt ist.

    Parallele Anfragen auf denselben Schlüssel warten aufeinander, damit eine Quelle nicht doppelt abgefragt wird.
    """
    path = _path(key)
    with _lock(key):
        if not refresh and path.exists() and time.time() - path.stat().st_mtime < ttl:
            try:
                return json.loads(path.read_text("utf-8"))
            except json.JSONDecodeError:
                pass
        data = loader()
        _write(path, data)
        return data


def _write(path, data: Any) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
    tmp.replace(path)


def store(key: str, data: Any) -> None:
    """Schreibt `data` unter `key` in den Cache (für Daten, die im Hintergrund aufgebaut werden)."""
    with _lock(key):
        _write(_path(key), data)


def peek(key: str) -> Any:
    """Cache-Inhalt zu `key` unabhängig vom Alter, oder None. Lädt nie nach."""
    try:
        return json.loads(_path(key).read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def cache_mtime(key: str) -> float | None:
    path = _path(key)
    return path.stat().st_mtime if path.exists() else None


def cache_age(key: str) -> float | None:
    mtime = cache_mtime(key)
    return time.time() - mtime if mtime is not None else None
