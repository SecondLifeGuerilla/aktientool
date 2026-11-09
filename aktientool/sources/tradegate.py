"""Live-Kurse in Euro von Tradegate (Handel werktags 8–22 Uhr, fast alle Aktien, die auch Trade Republic anbietet).

Yahoo kennt für ausländische Aktien nur den Kurs der Heimatbörse: Vor US-Börsenbeginn steht dort für NVIDIA noch der
Schlusskurs vom Vortag, obwohl die Aktie in Deutschland längst in Euro gehandelt wird. Tradegate liefert je ISIN den
letzten Kurs, Geld/Brief und die Veränderung zum Vortag (öffentlicher Abruf, den auch die Tradegate-Webseite nutzt).
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger(__name__)

URL = "https://www.tradegatebsx.com/refresh.php?isin={isin}"
USER_AGENT = "Mozilla/5.0 (compatible; Aktientool)"
TIMEOUT = 6
TTL = 60  # Sekunden: so lange gilt ein abgerufener Kurs
MAX_PER_CALL = 60  # mehr ISINs auf einmal fragen wir nicht ab (Rücksicht auf Tradegate)
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")

_cache: dict[str, tuple[float, dict | None]] = {}
_lock = threading.Lock()


def _num(value) -> float | None:
    """Zahl aus Tradegate: mal echte Zahl, mal deutscher Text („1.234,56“)."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        f = float(value)
    else:
        text = str(value).strip().replace(" ", "")
        if not text or text in ("-", "--"):
            return None
        if "," in text:
            text = text.replace(".", "").replace(",", ".")
        try:
            f = float(text)
        except ValueError:
            return None
    return f if math.isfinite(f) else None


def parse(data: dict) -> dict | None:
    """Antwort von refresh.php -> {price, change, bid, ask, prev_close, high, low, trades}; None ohne Handel heute."""
    last = _num(data.get("last"))
    prev = _num(data.get("close"))
    trades = _num(data.get("executions")) or 0
    if not last or last <= 0 or trades <= 0:
        return None
    delta = _num(data.get("delta"))
    change = delta / 100 if delta is not None else (last / prev - 1 if prev else None)
    return {"price": last, "change": change, "bid": _num(data.get("bid")), "ask": _num(data.get("ask")),
            "prev_close": prev, "high": _num(data.get("high")), "low": _num(data.get("low")), "trades": int(trades),
            "currency": "EUR", "source": "Tradegate", "time": time.time()}


def _fetch(isin: str) -> dict | None:
    req = urllib.request.Request(URL.format(isin=urllib.parse.quote(isin)),
                                 headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(20000)
        data = json.loads(raw.decode("utf-8", "replace"))
        return parse(data) if isinstance(data, dict) else None
    except Exception as e:  # Tradegate kennt die ISIN nicht, ist nicht erreichbar o. Ä.: dann ohne Live-Kurs
        log.info("Tradegate %s: %s", isin, e)
        return None


def quotes(isins: list[str]) -> dict[str, dict]:
    """{ISIN: Live-Kurs} für die ISINs, die Tradegate heute gehandelt hat (höchstens MAX_PER_CALL neue Abrufe)."""
    wanted = list(dict.fromkeys(i for i in (str(x or "").upper() for x in isins) if ISIN_RE.match(i)))
    now = time.time()
    out: dict[str, dict] = {}
    missing = []
    with _lock:
        for isin in wanted:
            hit = _cache.get(isin)
            if hit and now - hit[0] < TTL:
                if hit[1]:
                    out[isin] = hit[1]
            else:
                missing.append(isin)
    missing = missing[:MAX_PER_CALL]
    if missing:
        with ThreadPoolExecutor(max_workers=min(8, len(missing))) as pool:
            results = list(pool.map(_fetch, missing))
        with _lock:
            for isin, q in zip(missing, results):
                _cache[isin] = (now, q)
                if q:
                    out[isin] = q
            if len(_cache) > 5000:
                for k in [k for k, (t, _) in _cache.items() if now - t > TTL]:
                    _cache.pop(k, None)
    return out


def quote(isin: str | None) -> dict | None:
    return quotes([isin]).get(str(isin or "").upper()) if isin else None
