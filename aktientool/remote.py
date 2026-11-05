"""Vorberechnete Daten für den serverlosen Betrieb (Vercel).

Ein täglicher GitHub-Workflow (scripts/daten.py) baut Weltauswahl, Tiefenanalyse, Handelsliste der LS Exchange,
Closed-End-Fonds und Tagesstände und legt sie auf den Branch „data“:

- bundle.tar.gz   Cache-Dateien (cache/<Schlüssel>.json) samt Änderungszeit, dazu snapshots/abschlag_holdings.json
- snapshots/      ein Tagesstand pro Tag (JJJJ-MM-TT.json.gz) und index.json mit allen Tagen

Der Server lädt das Bündel beim ersten Aufruf und danach höchstens alle DATA_CHECK_EVERY Sekunden neu (nur wenn es
sich geändert hat, per ETag) und entpackt es in seinen Cache-Ordner. Die übrigen Module lesen die Daten dort wie im
lokalen Betrieb. Tagesstände werden erst geladen, wenn die Auswertung sie braucht.
"""

from __future__ import annotations

import io
import json
import logging
import os
import tarfile
import threading
import time
import urllib.error
import urllib.request

from . import cache, config

log = logging.getLogger(__name__)

BUNDLE = "bundle.tar.gz"
USER_AGENT = "Aktientool (serverlos)"
TIMEOUT = 30

_lock = threading.Lock()
_state = {"checked": 0.0, "etag": None, "loaded": None, "error": None, "built": None}


def _get(path: str, etag: str | None = None) -> tuple[int, bytes, str | None]:
    headers = {"User-Agent": USER_AGENT}
    if etag:
        headers["If-None-Match"] = etag
    req = urllib.request.Request(f"{config.DATA_URL}/{path}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read(), resp.headers.get("ETag")
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return 304, b"", etag
        raise


def _safe_member(name: str) -> str | None:
    """Nur cache/<Datei> und snapshots/<Datei>, keine Pfade nach außen."""
    parts = name.split("/")
    if len(parts) != 2 or parts[0] not in ("cache", "snapshots") or parts[1] in ("", ".", ".."):
        return None
    return name


def extract(data: bytes) -> dict:
    """Entpackt ein Bündel in den Daten- bzw. Tagesstand-Ordner; Änderungszeiten bleiben erhalten (der Cache
    entscheidet danach, wie alt die Daten sind). Gibt das Manifest zurück."""
    manifest: dict = {}
    targets = {"cache": cache.CACHE_DIR, "snapshots": config.SNAPSHOT_DIR}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if member.name == "manifest.json" and member.isfile():
                manifest = json.loads(tar.extractfile(member).read())
                continue
            name = _safe_member(member.name)
            if not name or not member.isfile():
                continue
            folder, filename = name.split("/")
            target = targets[folder] / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".part")
            tmp.write_bytes(tar.extractfile(member).read())
            os.utime(tmp, (member.mtime, member.mtime))
            tmp.replace(target)
    return manifest


def ensure(force: bool = False) -> None:
    """Holt das Bündel, wenn es noch fehlt oder die letzte Prüfung länger her ist. Fehler werden gemerkt, nicht
    geworfen: dann gelten die zuletzt geladenen Daten (oder die Seite meldet, dass noch keine da sind)."""
    if not config.SERVERLESS:
        return
    now = time.time()
    with _lock:
        if not force and now - _state["checked"] < config.DATA_CHECK_EVERY:
            return
        _state["checked"] = now
        try:
            status, body, etag = _get(BUNDLE, _state["etag"] if _state["loaded"] else None)
            if status == 200 and body:
                manifest = extract(body)
                _state.update(etag=etag, loaded=now, error=None, built=manifest.get("built"))
            else:
                _state["error"] = None
        except Exception as e:  # GitHub nicht erreichbar oder noch keine Daten
            log.warning("Vorberechnete Daten nicht geladen: %s", e)
            _state["error"] = ("Die täglich vorberechneten Daten sind noch nicht verfügbar. Läuft der GitHub-Workflow "
                               "„Daten aktualisieren“? (" + f"{type(e).__name__}: {e}"[:160] + ")")
            if not _state["loaded"]:
                _state["checked"] = now - config.DATA_CHECK_EVERY + 60  # ohne Daten nach einer Minute erneut versuchen


def status() -> dict:
    with _lock:
        return {"serverless": config.SERVERLESS, "source": config.DATA_URL if config.SERVERLESS else None,
                "loaded": _state["loaded"], "built": _state["built"], "error": _state["error"]}


# ---------------------------------------------------------------- Tagesstände

_index = {"checked": 0.0, "dates": []}


def snapshot_dates() -> list[str]:
    now = time.time()
    with _lock:
        if now - _index["checked"] < config.DATA_CHECK_EVERY:
            return list(_index["dates"])
    try:
        _, body, _ = _get("snapshots/index.json")
        dates = sorted(d for d in json.loads(body).get("dates", []) if isinstance(d, str))
    except Exception as e:
        log.info("Tagesstände nicht abrufbar: %s", e)
        dates = list(_index["dates"])
    with _lock:
        _index.update(checked=now, dates=dates)
    return dates


def snapshot_file(day: str) -> bytes:
    """Ein Tagesstand (gzip); im Datenordner zwischengespeichert, er ändert sich nicht mehr."""
    path = config.SNAPSHOT_DIR / f"{day}.json.gz"
    if path.exists():
        return path.read_bytes()
    try:
        _, body, _ = _get(f"snapshots/{day}.json.gz")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise FileNotFoundError(day) from None
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return body
