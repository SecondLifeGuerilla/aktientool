"""Tiefenanalyse der Weltauswahl: Gewinnstabilität, fairer Wert, Scorecard & Co. für jede Aktie, im Hintergrund.

Die Weltauswahl selbst kennt nur die Kennzahlen der letzten 12 Monate aus Yahoos Screener. Für Filter wie
„Gewinnstabilität ab 0,9 und mindestens 10 % unter dem fairen Wert“ braucht es das vollständige Profil jeder Aktie
(Kurshistorie, Jahresabschlüsse, Dividenden). Das sind je Aktie rund zehn Abfragen; Yahoo drosselt bei zu vielen.
Der Lauf arbeitet deshalb eine Aktie nach der anderen ab (größte zuerst), mit Pause dazwischen, und speichert
regelmäßig. Ein Ergebnis bleibt eine Woche gültig; danach wird die Aktie beim nächsten Durchgang erneuert.
Nach einem Neustart setzt der Lauf dort fort, wo er war.
"""

from __future__ import annotations

import logging
import math
import threading
import time

from . import config, service
from .cache import cache_mtime, peek, store

log = logging.getLogger(__name__)

FLUSH_EVERY = 25  # nach so vielen Aktien speichern (die Weltauswahl lädt dann die neuen Werte)
RATE_LIMIT_PAUSE = 180  # Sekunden Pause, wenn Yahoo drosselt
ERROR_RETRY = 24 * 3600  # fehlgeschlagene Aktien erst nach einem Tag erneut versuchen
# 2: keine Gewinnstabilität bei überwiegenden Verlusten. Ältere Einträge mit Stabilität, aber ohne Gewinnwachstum
# (typisch für Verlustreihen) werden beim nächsten Durchgang sofort erneuert statt erst nach einer Woche
VERSION = 2

_lock = threading.Lock()
_state = {"running": False, "paused": False, "done": 0, "total": 0, "fresh": 0, "current": None, "errors": 0,
          "started": None, "finished": None, "last_error": None, "throttled_until": None}
_store: dict | None = None  # {"rows": {symbol: {...}}, "paused": bool}
_stop = threading.Event()


def _load() -> dict:
    global _store
    if _store is None:
        _store = peek(config.DEEP_KEY) or {"rows": {}, "paused": False}
        _state["paused"] = bool(_store.get("paused"))
    return _store


def _flush() -> None:
    with _lock:
        data = {"rows": dict(_load()["rows"]), "paused": _state["paused"], "updated": time.time()}
    store(config.DEEP_KEY, data)


def compact(row: dict) -> dict:
    """Die Felder einer Screener-Zeile, die die Weltauswahl zum Filtern braucht (kurze Schlüssel, gerundet)."""
    def r(x, digits=4):
        if not isinstance(x, (int, float)) or isinstance(x, bool) or not math.isfinite(x):
            return None
        return round(float(x), digits)

    scores = row.get("scores") or {}
    rating = (row.get("rating") or {}).get("label")
    return {k: v for k, v in {
        "t": int(time.time()), "v": VERSION,
        "p": r(row.get("price"), 6),
        "stab": r(row.get("earnings_stability")), "growth": r(row.get("earnings_growth")),
        "years": r(row.get("quality_years"), 1), "short": bool(row.get("quality_short")),
        # „SEC EDGAR + Yahoo Finance“ -> „SEC“, „ESEF-Jahresberichte + …“ -> „ESEF“
        "src": (row.get("fundamentals_source") or "").split(" ")[0].split("-")[0] or None,
        "fair": r(row.get("fair_value"), 6), "rated": row.get("deviation") is not None, "rating": rating,
        "exp": r(row.get("expected_return")), "dy": r(row.get("div_yield")),
        "div_growth": r(row.get("div_growth")), "div_stab": r(row.get("div_stability")),
        "streak": row.get("div_streak"), "payout": r(row.get("payout")),
        "debt": None if row.get("debt_infinite") else r(row.get("debt_years"), 2), "debt_inf": bool(row.get("debt_infinite")),
        "sc_inc": scores.get("dividend_income"), "sc_dg": scores.get("dividend_growth"), "sc_eg": scores.get("earnings_growth"),
        "roic": r(row.get("roic")), "pio": row.get("piotroski"), "shares": r(row.get("share_cagr")),
        "rev90": r(row.get("revisions_90d")), "mom121": r(row.get("momentum_12_1")), "fcfy": r(row.get("fcf_yield")),
        "dcf": r(row.get("implied_growth")), "net_div": r(row.get("net_dividend_share")),
    }.items() if v is not None}


def merge_into(world_row: dict, d: dict) -> None:
    """Tiefenwerte an eine Zeile der Weltauswahl hängen. Abweichung vom fairen Wert und erwartete Rendite hängen
    vom Kurs ab und werden mit dem aktuellen Kurs der Weltauswahl neu berechnet."""
    if not d or "err" in d:
        return
    price, then = world_row.get("price"), d.get("p")
    out = {"d_stab": d.get("stab"), "d_growth": d.get("growth"), "d_years": d.get("years"), "d_div_growth": d.get("div_growth"),
           "d_div_stab": d.get("div_stab"), "d_streak": d.get("streak"), "d_payout": d.get("payout"), "d_debt": d.get("debt"),
           "d_sc_inc": d.get("sc_inc"), "d_sc_dg": d.get("sc_dg"), "d_sc_eg": d.get("sc_eg"), "d_roic": d.get("roic"),
           "d_pio": d.get("pio"), "d_shares": d.get("shares"), "d_rev90": d.get("rev90"), "d_mom121": d.get("mom121"),
           "d_fcfy": d.get("fcfy"), "d_dcf": d.get("dcf"), "d_src": d.get("src"), "d_t": d.get("t")}
    if d.get("short"):
        out["d_short"] = 1
    if d.get("debt_inf"):
        out["d_debt"] = 99.0  # „nie tilgbar“ als sehr großer Wert, damit Filter „höchstens x Jahre“ greifen
    if d.get("dy") is not None and d.get("net_div") is not None:
        out["d_net_yield"] = round(d["dy"] * d["net_div"], 4)
    if d.get("rated") and d.get("fair") and price:
        out["d_dev"] = round(price / d["fair"] - 1, 4)
        if d.get("exp") is not None and then:
            dy = d.get("dy") or 0.0
            base = 1 + d["exp"] - dy
            if base > 0:
                out["d_exp"] = round(base * (then / price) ** (1 / 5) - 1 + dy, 4)
    elif d.get("rating"):
        out["d_rating"] = d["rating"]
    world_row.update({k: v for k, v in out.items() if v is not None})


def rows() -> dict:
    with _lock:
        return dict(_load()["rows"])


def mtime() -> float:
    return cache_mtime(config.DEEP_KEY) or 0.0


def _is_fresh(entry: dict | None, now: float) -> bool:
    if not entry:
        return False
    if "err" not in entry and entry.get("v", 1) < VERSION and entry.get("stab") is not None and entry.get("growth") is None:
        return False
    ttl = ERROR_RETRY if "err" in entry else config.TTL_DEEP
    return now - entry.get("t", 0) < ttl


def _run(universe: list[dict]) -> None:
    from yfinance.exceptions import YFRateLimitError

    since_flush = 0
    try:
        for item in universe:
            if _stop.is_set():
                break
            sym = item["symbol"]
            now = time.time()
            with _lock:
                entry = _load()["rows"].get(sym)
                _state["current"] = sym
            if _is_fresh(entry, now):
                with _lock:
                    _state["done"] += 1
                continue
            for attempt in range(2):
                try:
                    result = compact(service.summary_row(sym, light=True, isin=item.get("isin")))
                    break
                except YFRateLimitError:
                    with _lock:
                        _state["throttled_until"] = time.time() + RATE_LIMIT_PAUSE
                    if _stop.wait(RATE_LIMIT_PAUSE):
                        return
                    result = None
                except Exception as e:  # einzelne Aktie fehlerhaft: merken und weiter
                    log.info("Tiefenanalyse %s: %s", sym, e)
                    result = {"t": int(time.time()), "err": f"{type(e).__name__}: {e}"[:200]}
                    with _lock:
                        _state["errors"] += 1
                        _state["last_error"] = f"{sym}: {type(e).__name__}"
                    break
                finally:
                    with _lock:
                        _state["throttled_until"] = None
            if result is not None:
                with _lock:
                    _load()["rows"][sym] = result
                    _state["done"] += 1
                since_flush += 1
            if since_flush >= FLUSH_EVERY:
                _flush()
                since_flush = 0
            if _stop.wait(config.DEEP_DELAY):
                break
    finally:
        _flush()
        with _lock:
            _state.update(running=False, current=None, finished=time.time())


def start(universe: list[dict], manual: bool = False) -> bool:
    """Startet den Lauf über `universe` ([{symbol, isin}], wichtigste zuerst); False, wenn er schon läuft
    oder pausiert ist (eine Pause hebt nur ein manueller Start auf)."""
    with _lock:
        _load()
        if _state["running"] or (_state["paused"] and not manual) or not universe:
            return False
        now = time.time()
        fresh = sum(_is_fresh(_store["rows"].get(u["symbol"]), now) for u in universe)
        _state.update(running=True, paused=False, done=0, total=len(universe), fresh=fresh, errors=0,
                      started=now, finished=None, last_error=None)
        _stop.clear()
    if manual:
        _flush()  # Pause aufgehoben
    threading.Thread(target=_run, args=(universe,), name="tiefenanalyse", daemon=True).start()
    return True


def pause() -> None:
    with _lock:
        _state["paused"] = True
    _stop.set()
    _flush()


def status(universe_size: int | None = None) -> dict:
    with _lock:
        _load()
        st = dict(_state)
        now = time.time()
        valid = [r for r in _store["rows"].values() if "err" not in r]
        st["analysed"] = len(valid)
        st["stale"] = sum(now - r.get("t", 0) >= config.TTL_DEEP for r in valid)
    st["universe"] = universe_size
    return st
