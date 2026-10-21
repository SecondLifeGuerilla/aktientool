"""Lokaler Webserver: liefert die Oberfläche aus und stellt die JSON-API bereit."""

from __future__ import annotations

import json
import logging
import re
import socket
import threading

from flask import Flask, Response, jsonify, request, send_from_directory

from . import alerts, config, deep, service, snapshots, userdata, world
from .cache import cached
from .sources import news, wiki, yahoo, yahoo_screener

log = logging.getLogger(__name__)
app = Flask(__name__, static_folder=None)
_watchlist_lock = threading.Lock()
SYMBOL_RE = re.compile(r"^[A-Za-z0-9.\-^=]{1,20}$")


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@app.errorhandler(ApiError)
def _api_error(e: ApiError):
    return jsonify({"error": str(e)}), e.status


@app.errorhandler(yahoo.SymbolNotFound)
def _not_found(e):
    return jsonify({"error": f"Zu „{e}“ wurden keine Kursdaten gefunden."}), 404


@app.errorhandler(userdata.InvalidInput)
def _invalid(e):
    return jsonify({"error": str(e)}), 400


@app.errorhandler(Exception)
def _unexpected(e):
    name = type(e).__name__
    if "RateLimit" in name:
        return jsonify({"error": "Yahoo Finance begrenzt gerade die Anfragen. Bitte in ein paar Minuten erneut versuchen.",
                        "rate_limited": True}), 429
    if hasattr(e, "code") and isinstance(getattr(e, "code"), int):  # HTTP-Fehler von Flask selbst
        return jsonify({"error": str(e)}), e.code
    log.exception("Fehler bei %s", request.path)
    return jsonify({"error": f"{name}: {e}"}), 500


@app.after_request
def _no_store_for_api(resp):
    # Der Server cacht selbst; der Browser soll immer den aktuellen Stand abfragen
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


def _symbol(raw: str) -> str:
    sym = raw.strip().upper()
    if not SYMBOL_RE.match(sym):
        raise ApiError("Ungültiges Tickersymbol.")
    return sym


def _read_watchlist() -> list[str]:
    try:
        return json.loads(config.WATCHLIST_FILE.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write_watchlist(items: list[str]) -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.WATCHLIST_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=2), "utf-8")


@app.get("/")
def index():
    return send_from_directory(config.STATIC_DIR, "index.html")


@app.get("/static/<path:path>")
def static_files(path: str):
    resp = send_from_directory(config.STATIC_DIR, path)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if len(q) < 1:
        return jsonify([])
    return jsonify(yahoo.search(q))


@app.get("/api/profile/<symbol>")
def api_profile(symbol: str):
    return jsonify(service.build_profile(_symbol(symbol), refresh=request.args.get("refresh") == "1"))


@app.get("/api/summary/<symbol>")
def api_summary(symbol: str):
    return jsonify(service.summary_row(_symbol(symbol), refresh=request.args.get("refresh") == "1"))


@app.get("/api/news/<symbol>")
def api_news(symbol: str):
    sym = _symbol(symbol)
    lang = request.args.get("lang", "de")
    if lang == "en":
        items = cached(f"news_en_{sym}", config.TTL_NEWS, lambda: news.yahoo(sym))
    else:
        name = request.args.get("name", "").strip()[:120] or sym
        items = cached(f"news_de_{sym}", config.TTL_NEWS, lambda: news.google(name))
    return jsonify(items)


@app.get("/api/wiki")
def api_wiki():
    title, lang = request.args.get("title", ""), request.args.get("lang", "de")
    try:
        return jsonify(cached(f"wiki_{lang}_{title}", config.TTL_WIKI, lambda: wiki.summary(title, lang)))
    except wiki.NotFound:
        raise ApiError("Zu diesem Begriff gibt es keinen Wikipedia-Artikel.", 404)


@app.get("/api/world/stock/<symbol>")
def api_world_stock(symbol: str):
    """Datensatz einer Aktie aus der Weltauswahl (Scores, Themen) für das Profil; leer, wenn nicht enthalten."""
    return jsonify(world.stock(_symbol(symbol)) or {})


@app.get("/api/world/status")
def api_world_status():
    return jsonify(world.status())


@app.post("/api/world/refresh")
def api_world_refresh():
    world.start()
    return jsonify(world.status(auto_refresh=False))


@app.get("/api/world/data")
def api_world_data():
    # mehrere MB JSON: komprimiert ausliefern, wenn der Browser es kann (tut er immer)
    gz = "gzip" in request.headers.get("Accept-Encoding", "")
    body = world.payload(compressed=gz)
    if body is None:
        raise ApiError("Die Weltauswahl wird noch geladen.", 404)
    resp = Response(body, mimetype="application/json")
    resp.headers["Vary"] = "Accept-Encoding"
    if gz:
        resp.headers["Content-Encoding"] = "gzip"
    return resp


@app.get("/api/presets")
def api_presets():
    data = json.loads(config.PRESETS_FILE.read_text("utf-8"))
    return jsonify(data["lists"])


@app.get("/api/watchlist")
def api_watchlist():
    return jsonify(_read_watchlist())


@app.post("/api/watchlist/<symbol>")
def api_watchlist_add(symbol: str):
    sym = _symbol(symbol)
    with _watchlist_lock:
        items = _read_watchlist()
        if sym not in items:
            items.append(sym)
            _write_watchlist(items)
    return jsonify(items)


@app.delete("/api/watchlist/<symbol>")
def api_watchlist_remove(symbol: str):
    sym = _symbol(symbol)
    with _watchlist_lock:
        items = [s for s in _read_watchlist() if s != sym]
        _write_watchlist(items)
    return jsonify(items)


def _body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Erwartet wird ein JSON-Objekt.")
    return data


def _symbols(raw: str, limit: int = 100) -> list[str]:
    out = [_symbol(s) for s in raw.split(",") if s.strip()]
    if len(out) > limit:
        raise ApiError(f"Höchstens {limit} Ticker auf einmal.")
    return list(dict.fromkeys(out))


# ---------------------------------------------------------------- Kurse und Wechselkurse (schnell, eine Sammelabfrage)

@app.get("/api/quotes")
def api_quotes():
    syms = _symbols(request.args.get("s", ""))
    if not syms:
        return jsonify([])
    return jsonify([{"symbol": q.get("symbol"), "price": q.get("regularMarketPrice"), "currency": q.get("currency"),
                     "change": (q.get("regularMarketChangePercent") or 0) / 100, "name": q.get("longName") or q.get("shortName")}
                    for q in yahoo_screener.quotes(syms)])


@app.get("/api/fx")
def api_fx():
    """Euro je Einheit der angefragten Währungen (Pence & Co. werden umgerechnet)."""
    from .sources import fx
    wanted = [c.strip() for c in request.args.get("c", "").split(",") if re.fullmatch(r"[A-Za-z]{3}", c.strip())]
    majors = sorted({fx.split_currency(c)[0] for c in wanted} | {"EUR"})
    rates = cached(f"fxnow_{'_'.join(majors)}", 3600, lambda: yahoo_screener.usd_rates(majors))
    out = {}
    for c in wanted:
        major, factor = fx.split_currency(c)
        if major in rates and "EUR" in rates:
            out[c] = rates[major] / rates["EUR"] / factor
    return jsonify(out)


# ---------------------------------------------------------------- Notizen

@app.get("/api/notes/<symbol>")
def api_note(symbol: str):
    return jsonify(userdata.note(_symbol(symbol)))


@app.put("/api/notes/<symbol>")
def api_note_save(symbol: str):
    return jsonify(userdata.save_note(_symbol(symbol), str(_body().get("text", ""))))


# ---------------------------------------------------------------- Depot

@app.get("/api/depot")
def api_depot():
    return jsonify(userdata.positions())


@app.post("/api/depot")
def api_depot_add():
    data = _body()
    return jsonify(userdata.add_position(_symbol(str(data.get("symbol", ""))), data))


@app.delete("/api/depot/<item_id>")
def api_depot_remove(item_id: str):
    return jsonify(userdata.remove_position(item_id))


# ---------------------------------------------------------------- Alarme

@app.get("/api/alerts")
def api_alerts():
    return jsonify({"alerts": userdata.alerts(), "types": userdata.ALERT_TYPES, "status": alerts.status()})


@app.post("/api/alerts")
def api_alerts_add():
    data = _body()
    sym = _symbol(str(data.get("symbol", "")))
    if data.get("type") == "dividend_cut":
        # Ausgangswert merken: ausgelöst wird, wenn die Dividende der letzten 12 Monate darunter fällt
        data["baseline"] = service.summary_row(sym).get("div_ttm") or None
        if not data["baseline"]:
            raise ApiError("Die Aktie zahlt derzeit keine Dividende.")
    return jsonify(userdata.add_alert(sym, data))


@app.delete("/api/alerts/<item_id>")
def api_alerts_remove(item_id: str):
    return jsonify(userdata.remove_alert(item_id))


@app.post("/api/alerts/<item_id>/reset")
def api_alerts_reset(item_id: str):
    """Ausgelösten Alarm wieder scharf schalten."""
    return jsonify(userdata.update_alerts({item_id: {"triggered": None, "message": None, "seen": True}}))


@app.post("/api/alerts/seen")
def api_alerts_seen():
    return jsonify(userdata.update_alerts({a["id"]: {"seen": True} for a in userdata.alerts() if a.get("triggered")}))


@app.post("/api/alerts/check")
def api_alerts_check():
    return jsonify({"triggered": alerts.check(), "status": alerts.status()})


# ---------------------------------------------------------------- Tiefenanalyse und Tagesstände

@app.post("/api/deep/start")
def api_deep_start():
    world.deep_start()
    return jsonify(world.status(auto_refresh=False)["deep"])


@app.post("/api/deep/pause")
def api_deep_pause():
    deep.pause()
    return jsonify(world.status(auto_refresh=False)["deep"])


@app.get("/api/snapshots")
def api_snapshots():
    return jsonify(snapshots.dates())


@app.get("/api/snapshots/eval")
def api_snapshots_eval():
    key = request.args.get("key", "score_total")
    if not re.fullmatch(r"[a-z0-9_]{2,30}", key):
        raise ApiError("Unbekannte Kennzahl.")
    try:
        return jsonify(snapshots.evaluate(request.args.get("from", ""), request.args.get("to", ""), key,
                                          higher_is_better=request.args.get("dir") != "asc"))
    except FileNotFoundError:
        raise ApiError("Für dieses Datum gibt es keinen Tagesstand.", 404)
    except ValueError as e:
        raise ApiError(str(e))


def _port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
        except OSError:
            return False
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    if not _port_free(config.HOST, config.PORT):
        print(f"\n  Port {config.PORT} ist belegt – läuft das Aktientool schon? Dann einfach http://{config.HOST}:{config.PORT} öffnen.\n"
              f"  Sonst anderen Port wählen: AKTIENTOOL_PORT=5051 .venv/bin/python run.py\n")
        raise SystemExit(1)
    print(f"\n  Aktientool läuft: http://{config.HOST}:{config.PORT}\n  Beenden mit Strg+C\n")
    alerts.start_background()
    # Weltauswahl und Tiefenanalyse auch ohne geöffnete Seite aktuell halten
    kick = threading.Timer(15, lambda: world.status())
    kick.daemon = True
    kick.start()
    app.run(host=config.HOST, port=config.PORT, threaded=True, debug=False)
