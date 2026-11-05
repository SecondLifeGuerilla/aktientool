"""Handelsliste der LS Exchange (Lang & Schwarz): Welche Aktien sind bei Trade Republic handelbar?

Trade Republic hat bis Ende Juni 2026 alle Aktienorders über die LS Exchange ausgeführt; handelbar war dort also,
was die LS Exchange führt. Seit Juli 2026 vergleicht „Best Price“ zusätzlich die Kurse anderer Börsen, eine eigene
Liste der handelbaren Aktien veröffentlicht Trade Republic aber nicht. Die Liste der LS Exchange ist darum eine
Annäherung; Abweichungen lassen sich im Profil korrigieren (userdata.tradable_overrides).

Zwei kostenlose Quellen der LS Exchange, beide jeden Börsentag neu:
- Stammdaten als PDF (https://www.ls-x.de/de/handelsuniversum): WKN, ISIN, Name, Gattung. Das PDF ist eine Tabelle
  aus einfachen Textbefehlen und lässt sich ohne PDF-Bibliothek lesen: Spalten über die x-Position der Kopfzeile,
  Zeilen über die y-Position. Es ist aber unvollständig (BYD, Bureau Veritas und einige Tausend andere fehlen).
- Kursliste („Pre-Trade“, https://www.ls-x.de/de/download): alle Quotes eines 5-Minuten-Fensters, darin steht
  praktisch jedes Wertpapier, das an diesem Tag gehandelt wird. Sie enthält nur ISINs und ist rund 40 MB groß;
  gelesen wird nur die erste Spalte. Am Wochenende und vor Handelsbeginn gibt es sie nicht. Sie ergänzt das PDF nur
  um wenige Dutzend Werte, deshalb wird sie nur einmal pro Woche geladen (neue Aktien stehen sofort im PDF).
Handelbar ist, was in einer der beiden Quellen steht. Fällt eine Quelle aus, gilt ihr letzter Stand noch eine Weile.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import threading
import time
import urllib.error
import urllib.request
import zlib
from collections import defaultdict

from .. import config
from ..cache import cache_age, cache_mtime, peek, store

log = logging.getLogger(__name__)

BASE_URL = "https://www.ls-x.de"
PAGE_URL = f"{BASE_URL}/de/handelsuniversum"
QUOTES_URL = BASE_URL + "/_rpc/json/.lstc/instrument/list/lsxpretrades?time={:%H%M%S}"
PDF_RE = re.compile(r'href="(/media/lsx/stammdaten(\d{8})\.pdf)"')
USER_AGENT = "Mozilla/5.0 (Aktientool lokal)"
CACHE_KEY = "lsx_handelsliste"
MIN_LISTED = 2000  # weniger Zeilen im PDF: sein Aufbau hat sich geändert
MIN_QUOTED = 5000  # weniger ISINs in der Kursliste: Fenster unvollständig
LISTED_CARRY_DAYS = 7  # so lange gilt der letzte Stand der Stammdaten, wenn das PDF nicht geladen werden kann
QUOTED_EVERY_DAYS = 7  # Kursliste nur so oft neu laden
QUOTED_CARRY_DAYS = 14  # so lange gilt ihr letzter Stand
RETRY_AFTER = 30 * 60  # nach einem Fehler frühestens dann wieder laden
SKIPPED_KINDS = {"BONDS"}  # Anleihen braucht das Tool nicht
# Fenster der Kursliste (UTC), falls das jüngste fehlt: Mittag, kurz nach Handelsbeginn im Winter und im Sommer
FALLBACK_SLOTS = [dt.time(12, 0), dt.time(6, 45), dt.time(5, 45)]

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")
STREAM_RE = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.S)
# Textbefehl: Position (Tm), Schrift (Tf), dann der Text in Klammern (Tj)
TEXT_RE = re.compile(rb"1 0 0 1 ([\d.]+) ([\d.]+) Tm\s+/\w+ [\d.]+ Tf(?:(?!ET)[^()])*\((.*?)\)Tj", re.S)
ESCAPE_RE = re.compile(rb"\\([0-7]{1,3}|.)", re.S)
ESCAPES = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f"}
COLUMNS = {"ISIN": "isin", "WKN": "wkn", "Name": "name", "Gattung": "kind"}


# ---------------------------------------------------------------- Stammdaten-PDF lesen

def _unescape(raw: bytes) -> str:
    def sub(m: re.Match) -> bytes:
        c = m.group(1)
        return bytes([int(c, 8) & 0xFF]) if c[:1] in b"01234567" else ESCAPES.get(c, c)
    return ESCAPE_RE.sub(sub, raw).decode("cp1252", "replace").strip()


def _page_rows(content: bytes, header: dict[float, str] | None) -> tuple[list[dict], dict[float, str] | None]:
    """Zeilen einer Seite als {Spalte: Text}; die Kopfzeile (Spaltennamen) gilt auch für Folgeseiten ohne eigene."""
    cells: dict[float, list[tuple[float, str]]] = defaultdict(list)
    for x, y, raw in TEXT_RE.findall(content):
        text = _unescape(raw)
        if text:
            cells[float(y)].append((float(x), text))
    head_y = next((y for y, items in cells.items() if any(t == "ISIN" for _, t in items)), None)
    if head_y is not None:
        header = {x: COLUMNS[t] for x, t in cells.pop(head_y) if t in COLUMNS}
    if not header:
        return [], header
    rows = []
    for y in sorted(cells, reverse=True):
        row = {}
        for x, text in cells[y]:
            col_x = min(header, key=lambda hx: abs(hx - x))
            if abs(col_x - x) <= 5:
                row[header[col_x]] = text
        if ISIN_RE.match(row.get("isin", "")):
            rows.append(row)
    return rows, header


def parse(pdf: bytes) -> dict[str, list[str]]:
    """{ISIN: [WKN, Name, Gattung]} aus dem Stammdaten-PDF."""
    out: dict[str, list[str]] = {}
    header = None
    for m in STREAM_RE.finditer(pdf):
        try:
            content = zlib.decompress(m.group(1))
        except zlib.error:
            continue  # kein Flate-Strom (z. B. Schrift)
        if b"Tj" not in content:
            continue  # Bild
        rows, header = _page_rows(content, header)
        for r in rows:
            out[r["isin"]] = [r.get("wkn", ""), r.get("name", ""), r.get("kind", "")]
    return out


# ---------------------------------------------------------------- Laden

def _open(url: str, timeout: int):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=timeout)


def _listed() -> tuple[str, dict[str, list[str]]]:
    """Stammdaten: der Link auf das PDF steht auf der Seite „Handelsuniversum“ (mit Datum im Namen)."""
    with _open(PAGE_URL, 30) as resp:
        html = resp.read().decode("utf-8", "replace")
    m = PDF_RE.search(html)
    if not m:
        raise RuntimeError("Link auf die Stammdaten der LS Exchange nicht gefunden")
    path, day = m.groups()
    with _open(BASE_URL + path, 120) as resp:
        entries = parse(resp.read())
    if len(entries) < MIN_LISTED:
        raise RuntimeError(f"nur {len(entries)} Einträge in den Stammdaten gelesen; hat sich das PDF geändert?")
    return f"{day[:4]}-{day[4:6]}-{day[6:]}", entries


def _quote_isins(url: str) -> set[str]:
    """Erste Spalte der Kursliste ("DE0008479023";"52.994";…), Zeile für Zeile, ohne die 40 MB zu speichern."""
    out = set()
    with _open(url, 180) as resp:
        for line in resp:
            if line[:1] == b'"' and line[13:14] == b'"':
                out.add(line[1:13])
    return {s for s in (b.decode("ascii", "replace") for b in out) if ISIN_RE.match(s)}


def _quoted(now: dt.datetime) -> tuple[str, set[str]] | None:
    """ISINs aus dem jüngsten vollständigen Fenster des Tages (Zeiten in UTC); None, wenn heute nicht gehandelt wird."""
    end = now.astimezone(dt.timezone.utc) - dt.timedelta(minutes=10)
    latest = end.replace(minute=end.minute - end.minute % 5, second=0, microsecond=0)
    slots = [latest] + [s for t in FALLBACK_SLOTS if (s := latest.replace(hour=t.hour, minute=t.minute)) < latest]
    for slot in slots:
        try:
            isins = _quote_isins(QUOTES_URL.format(slot))
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):  # Fenster außerhalb der Handelszeit
                continue
            raise
        if len(isins) >= MIN_QUOTED:
            return slot.date().isoformat(), isins
    return None


def _age_days(day: str | None, today: dt.date) -> int | None:
    try:
        return (today - dt.date.fromisoformat(day)).days if day else None
    except ValueError:
        return None


def _recent(day: str | None, today: dt.date, days: int) -> bool:
    age = _age_days(day, today)
    return age is not None and age <= days


def combine(listed: tuple[str, dict] | None, quoted: tuple[str, set[str]] | None,
            previous: dict | None, today: dt.date) -> dict:
    """Beide Quellen zu {ISIN: [WKN, Name, Gattung]} zusammenführen; nur aus der Kursliste bekannte ISINs haben
    leere Angaben. Fehlt eine Quelle, gilt ihr Teil aus `previous`, solange er nicht zu alt ist."""
    prev = previous or {}
    prev_isins = prev.get("isins") or {}
    if listed is None and _recent(prev.get("listed_date"), today, LISTED_CARRY_DAYS):
        listed = prev["listed_date"], {i: e for i, e in prev_isins.items() if e[2]}
    if quoted is None and _recent(prev.get("quoted_date"), today, QUOTED_CARRY_DAYS):
        quoted = prev["quoted_date"], {i for i, e in prev_isins.items() if not e[2]}
    if listed is None and quoted is None:
        raise RuntimeError("weder Stammdaten noch Kursliste der LS Exchange verfügbar")
    entries = listed[1] if listed else {}
    isins = {i: e for i, e in entries.items() if e[2] not in SKIPPED_KINDS}
    for i in (quoted[1] if quoted else ()):
        if i not in entries:  # Anleihen stehen auch in der Kursliste, sie bleiben draußen
            isins[i] = ["", "", ""]
    dates = [d for d in (listed and listed[0], quoted and quoted[0]) if d]
    return {"date": max(dates), "listed_date": listed[0] if listed else None, "quoted_date": quoted[0] if quoted else None,
            "stocks": sum(1 for e in isins.values() if e[2] == "AKTIE"), "count": len(isins), "isins": isins}


def load(previous: dict | None = None) -> dict:
    listed = quoted = None
    today = dt.date.today()
    try:
        listed = _listed()
    except Exception as e:
        log.warning("Stammdaten der LS Exchange nicht geladen: %s", e)
    age = _age_days((previous or {}).get("quoted_date"), today)
    if age is None or age >= QUOTED_EVERY_DAYS:
        try:
            quoted = _quoted(dt.datetime.now(dt.timezone.utc))
        except Exception as e:
            log.warning("Kursliste der LS Exchange nicht geladen: %s", e)
    return combine(listed, quoted, previous, today)


# ---------------------------------------------------------------- Im Hintergrund aktuell halten

_lock = threading.Lock()
_state = {"running": False, "failed_at": 0.0, "error": None}
_memo: dict = {}


def _run() -> None:
    try:
        store(CACHE_KEY, load(peek(CACHE_KEY)))
        with _lock:
            _state["error"] = None
    except Exception as e:  # Liste bleibt beim letzten Stand
        log.warning("Handelsliste der LS Exchange nicht geladen: %s", e)
        with _lock:
            _state.update(failed_at=time.time(), error=f"{type(e).__name__}: {e}")
    finally:
        with _lock:
            _state["running"] = False


def refresh_if_stale() -> bool:
    """Lädt die Liste im Hintergrund neu, wenn sie fehlt oder veraltet ist; True, wenn ein Lauf gestartet wurde.
    Serverlos lädt sie der tägliche Workflow (remote.py)."""
    if config.SERVERLESS:
        return False
    age = cache_age(CACHE_KEY)
    if age is not None and age < config.TTL_LSX:
        return False
    with _lock:
        if _state["running"] or time.time() - _state["failed_at"] < RETRY_AFTER:
            return False
        _state["running"] = True
    threading.Thread(target=_run, name="lsx-handelsliste", daemon=True).start()
    return True


def refresh_now() -> None:
    """Liste sofort (im laufenden Thread) neu laden, wenn sie veraltet ist; für den täglichen Workflow."""
    age = cache_age(CACHE_KEY)
    if age is None or age >= config.TTL_LSX:
        _run()


def mtime() -> float:
    return cache_mtime(CACHE_KEY) or 0.0


def current() -> dict | None:
    """Zuletzt geladene Liste (auch eine veraltete) oder None; lädt nie nach."""
    stamp = cache_mtime(CACHE_KEY)
    if stamp is None:
        return None
    with _lock:
        if _memo.get("mtime") != stamp:
            _memo.clear()
            data = peek(CACHE_KEY)
            if data and data.get("isins"):
                _memo.update(mtime=stamp, data=data)
        return _memo.get("data")


def find(listing: dict | None, isins: list[str]) -> tuple[str, list[str]] | None:
    """Erste der ISINs (Heimatnotierung zuerst, dann ADRs und andere Notierungen), die auf der Liste steht."""
    if not listing:
        return None
    entries = listing["isins"]
    return next(((i, entries[i]) for i in isins if i in entries), None)


def status() -> dict:
    data = current()
    with _lock:
        st = dict(_state)
    return {"ready": data is not None, "date": data.get("date") if data else None,
            "count": data.get("count") if data else None, "loading": st["running"], "error": st["error"]}
