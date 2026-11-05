"""Lokaler Webserver: liefert die Oberfläche aus und stellt die JSON-API bereit."""

from __future__ import annotations

import http.client
import json
import logging
import re
import socket
import threading
import urllib.request
import webbrowser
from datetime import datetime, timezone

from flask import Flask, Response, jsonify, request, send_from_directory

from . import alerts, config, deep, derivate, eur, outlook, service, snapshots, trusts, userdata, world
from .analysis import metrics
from .cache import cached
from .sources import fx, news, onvista, wiki, yahoo, yahoo_screener

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
    results = yahoo.search(q)
    flags = world.tradable_flags([r["symbol"] for r in results])  # nur für Ticker aus der Weltauswahl bekannt
    for r in results:
        if r["symbol"] in flags:
            r["tr"] = flags[r["symbol"]]
    return jsonify(results)


@app.get("/api/profile/<symbol>")
def api_profile(symbol: str):
    # Anzeige in Euro (siehe eur.py); intern rechnet alles weiter in der Kurswährung
    sym = _symbol(symbol)
    prof = eur.profile(service.build_profile(sym, refresh=request.args.get("refresh") == "1"))
    prof["trade_republic"] = world.trade_republic(sym, prof["facts"].get("isin"))
    try:  # Trust oder Holding: Abschlag zum inneren Wert (das Profil soll daran nie scheitern)
        prof["trust"] = trusts.find(sym, prof["facts"].get("isin"))
    except Exception as e:
        log.info("Innerer Wert für %s nicht verfügbar: %s", sym, e)
        prof["trust"] = None
    return jsonify(prof)


@app.get("/api/summary/<symbol>")
def api_summary(symbol: str):
    sym = _symbol(symbol)
    row = eur.summary(service.summary_row(sym, refresh=request.args.get("refresh") == "1"))
    row["tr"] = world.trade_republic(sym, row.get("isin"))["tradable"]
    return jsonify(row)


@app.get("/api/outlook/<symbol>")
def api_outlook(symbol: str):
    """Redaktionelle Zukunftseinordnung; ohne Kursabruf oder Änderung der Scores."""
    isin = request.args.get("isin", "").strip().upper()
    if isin and not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}\d", isin):
        raise ApiError("Ungültige ISIN.")
    return jsonify(outlook.for_company(_symbol(symbol), isin))


@app.get("/api/beschreibung/<symbol>")
def api_description(symbol: str):
    """Deutsche Firmenbeschreibung aus Wikipedia (über Wikidata gefunden); leer, wenn es keinen Artikel gibt."""
    sym = _symbol(symbol)
    isin = request.args.get("isin", "").strip().upper()
    name = request.args.get("name", "").strip()[:120]
    try:
        found = cached(f"beschreibung_de_{sym}", config.TTL_WIKI * 4, lambda: wiki.company(isin, name) or {})
    except Exception as e:  # Wikimedia nicht erreichbar: nicht zwischenspeichern, die englische Beschreibung bleibt
        log.info("Beschreibung für %s nicht verfügbar: %s", sym, e)
        found = {}
    return jsonify(found)


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


@app.get("/api/world/stocks")
def api_world_stocks():
    """Mehrere Aktien aus der Weltauswahl auf einmal (Startseite); fehlende Ticker fehlen im Ergebnis."""
    return jsonify({s: row for s in _symbols(request.args.get("s", ""), limit=200) if (row := world.stock(s))})


@app.put("/api/handelbar/<symbol>")
def api_tradable(symbol: str):
    """Eigene Korrektur zur Handelbarkeit bei Trade Republic: true/false, null = wieder laut Handelsliste."""
    sym = _symbol(symbol)
    data = _body()
    userdata.set_tradable(sym, data.get("tradable"))
    return jsonify(world.trade_republic(sym, str(data.get("isin") or "").strip().upper() or None))


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


@app.get("/api/watchgruppen")
def api_watch_groups():
    return jsonify(userdata.watch_groups())


@app.put("/api/watchgruppen")
def api_watch_groups_save():
    return jsonify(userdata.save_watch_groups(_body().get("groups")))


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
    return jsonify(eur.quotes([{"symbol": q.get("symbol"), "price": q.get("regularMarketPrice"), "currency": q.get("currency"),
                     "change": (q.get("regularMarketChangePercent") or 0) / 100, "name": q.get("longName") or q.get("shortName"),
                     # nächster (oder letzter) Zahlentermin und Dividenden-Zahltag, für die Startseite
                     "earnings_date": _day(q.get("earningsTimestampStart") or q.get("earningsTimestamp")),
                     "earnings_estimate": bool(q.get("isEarningsDateEstimate")),
                     "dividend_date": _day(q.get("dividendDate"))}
                    for q in yahoo_screener.quotes(syms)]))


def _day(ts) -> str | None:
    """Unix-Zeitstempel von Yahoo als Datum (JJJJ-MM-TT, UTC)."""
    if not isinstance(ts, (int, float)) or ts <= 0:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()


def _eur_rates(wanted: list[str]) -> dict[str, float]:
    """Euro je Einheit der angefragten Währungen (Pence & Co. werden umgerechnet)."""
    return {c: v["rate"] for c, v in fx.eur_quotes(wanted).items()}


@app.get("/api/fx")
def api_fx():
    return jsonify(_eur_rates([c.strip() for c in request.args.get("c", "").split(",") if re.fullmatch(r"[A-Za-z]{3}", c.strip())]))


@app.get("/api/basiswert/<symbol>")
def api_underlying(symbol: str):
    """Basiswert für den Call/Put-Rechner: Kurs, historische Volatilität (1 Jahr, 3 Monate), Dividendenrendite und
    Euro-Kurs der Währung (Hebelprodukte auf ausländische Aktien notieren in Euro)."""
    sym = _symbol(symbol)
    q = next(iter(yahoo_screener.quotes([sym])), None)
    if not q or not q.get("regularMarketPrice"):
        raise yahoo.SymbolNotFound(sym)
    closes = cached(f"schluss_1j_{sym}", config.TTL_YAHOO, lambda: yahoo.closes(sym))
    ccy = q.get("currency") or "EUR"
    div = q.get("dividendYield")
    rate = fx.eur_quotes([ccy]).get(ccy) or {}
    change = (q.get("regularMarketChangePercent") or 0) / 100
    return jsonify({
        "symbol": q.get("symbol") or sym, "name": q.get("longName") or q.get("shortName") or sym,
        "currency": ccy, "price": q.get("regularMarketPrice"),
        # Tagesveränderung in Euro (mit Wechselkurs), wie überall in der Oberfläche
        "change": (1 + change) * (1 + rate.get("change", 0.0)) - 1,
        "div_yield": div / 100 if isinstance(div, (int, float)) else None,  # Yahoo liefert hier Prozent
        "vola_1y": metrics.volatility(closes, 250), "vola_3m": metrics.volatility(closes, 63),
        "eur": rate.get("rate"),
    })


def _onvista(fn):
    """onvista nicht erreichbar: verständliche Meldung statt eines Python-Fehlers."""
    try:
        return fn()
    except onvista.NotFound:
        raise ApiError("Zu dieser ISIN bzw. WKN kennt onvista kein Hebelprodukt.", 404) from None
    except (OSError, http.client.HTTPException, ValueError) as e:
        if isinstance(e, userdata.InvalidInput):
            raise
        log.warning("onvista: %s", e)
        raise ApiError("onvista ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.", 502) from None


@app.get("/api/derivat/<query>")
def api_derivative(query: str):
    """Ein Hebelprodukt per ISIN oder WKN: Stammdaten, Geld- und Briefkurs des Emittenten, Basiswert mit Yahoo-Ticker
    und ob Trade Republic es handelt."""
    return jsonify(_onvista(lambda: derivate.product(query)))


@app.get("/api/derivate/<symbol>/ueberblick")
def api_derivatives_overview(symbol: str):
    """Für das Aktienprofil: Anzahl der Optionsscheine und Knock-outs je Richtung und typische Produkte."""
    sym = _symbol(symbol)
    return jsonify(_onvista(lambda: derivate.overview(sym, request.args.get("tr", "1") != "0")))


@app.get("/api/derivate/<symbol>/alle")
def api_derivatives_all(symbol: str):
    """Alle Optionsscheine oder Knock-outs auf eine Aktie (höchstens 6.000) für die große Tabelle; Filter wie bei
    /api/derivate/<symbol>, die Oberfläche schickt sie nur, wenn es mehr Produkte gibt."""
    sym = _symbol(symbol)
    kind = request.args.get("art", "os")
    if kind not in ("os", "ko"):
        raise ApiError("Produktart muss os (Optionsschein) oder ko (Knock-out) sein.")
    filters = derivate.filters_from(request.args, kind)
    return jsonify(_onvista(lambda: derivate.listing_all(sym, kind, request.args.get("typ") != "put", filters)))


@app.get("/api/derivate/<symbol>")
def api_derivatives(symbol: str):
    """Optionsscheine (art=os) oder Knock-outs (art=ko) auf eine Aktie, Call oder Put, gefiltert (siehe
    derivate.filters_from), sortiert, 100 je Seite; tr=0 zeigt auch Produkte, die Trade Republic nicht handelt."""
    sym = _symbol(symbol)
    kind = request.args.get("art", "os")
    if kind not in ("os", "ko"):
        raise ApiError("Produktart muss os (Optionsschein) oder ko (Knock-out) sein.")
    page = request.args.get("seite", "0")
    filters = derivate.filters_from(request.args, kind)
    return jsonify(_onvista(lambda: derivate.listing(
        sym, kind, request.args.get("typ") != "put", filters, request.args.get("sort"),
        request.args.get("order", "ASC").upper(), int(page) if page.isdigit() else 0)))


# ---------------------------------------------------------------- Trusts, Closed-End-Fonds und Holdings

@app.get("/api/trusts")
def api_trusts():
    """Alle Fonds (Stand Vortag, wird im Hintergrund geladen) und Holdings (innerer Wert mit aktuellen Kursen)."""
    return jsonify(trusts.overview())


@app.get("/api/trusts/<symbol>")
def api_trust(symbol: str):
    """Ein Fonds oder eine Holding mit Positionen; die Positionen eines Fonds werden beim ersten Aufruf geladen."""
    found = trusts.detail(_symbol(symbol))
    if found is None:
        raise ApiError("Zu diesem Ticker gibt es keinen Trust und keine Holding.", 404)
    return jsonify(found)


@app.get("/api/trusts/<symbol>/verlauf")
def api_trust_history(symbol: str):
    """Abschlag je Tag mit Durchschnitt, Minimum und Maximum über 1, 3, 5, 10 Jahre und den ganzen Verlauf."""
    found = trusts.history(_symbol(symbol))
    if found is None:
        raise ApiError("Zu diesem Ticker gibt es keinen Trust und keine Holding.", 404)
    return jsonify(found)


@app.put("/api/trusts/holding/<symbol>")
def api_trust_holding_save(symbol: str):
    """Holding selbst anlegen oder die Angaben einer vorhandenen ändern (Beteiligungen, Stichtag, Aktienzahl)."""
    sym = _symbol(symbol)
    userdata.save_holding_def(sym, _body())
    return jsonify(trusts.detail(sym))


@app.delete("/api/trusts/holding/<symbol>")
def api_trust_holding_remove(symbol: str):
    """Eigene Angaben löschen; bei mitgelieferten Holdings gelten danach wieder die Werte aus holdings.json."""
    sym = _symbol(symbol)
    userdata.remove_holding_def(sym)
    return jsonify(trusts.detail(sym) or {})


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


@app.put("/api/depot/<item_id>")
def api_depot_update(item_id: str):
    return jsonify(userdata.update_position(item_id, _body()))


@app.post("/api/depot/restore")
def api_depot_restore():
    data = _body()
    return jsonify(userdata.restore_position(_symbol(str(data.get("symbol", ""))), data))


@app.post("/api/depot/import")
def api_depot_import():
    rows = _body().get("items")
    if not isinstance(rows, list) or not rows:
        raise ApiError("Keine Käufe zum Importieren.")
    if len(rows) > 500:
        raise ApiError("Höchstens 500 Käufe auf einmal.")
    if not all(isinstance(r, dict) for r in rows):
        raise ApiError("Jeder Kauf muss ein JSON-Objekt sein.")
    return jsonify(userdata.add_positions([(_symbol(str(r.get("symbol", ""))), r) for r in rows]))


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
        row = service.summary_row(sym)
        data["baseline"] = row.get("div_ttm") or None
        if not data["baseline"]:
            raise ApiError("Die Aktie zahlt derzeit keine Dividende.")
        shown = eur.summary(row)
        data["baseline_eur"] = shown.get("div_ttm") if shown.get("currency") == "EUR" else None
    return jsonify(userdata.add_alert(sym, data))


@app.post("/api/alerts/restore")
def api_alerts_restore():
    data = _body()
    index = data.get("index")
    return jsonify(userdata.restore_alert(_symbol(str(data.get("symbol", ""))), data,
                                          int(index) if isinstance(index, (int, float)) else None))


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


def _tool_running(url: str) -> bool:
    """Antwortet auf dem Port schon ein Aktientool (und nicht irgendein anderes Programm)?"""
    try:
        with urllib.request.urlopen(f"{url}/api/world/status", timeout=3) as resp:
            return "ready" in json.loads(resp.read())
    except (OSError, ValueError):
        return False


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    url = f"http://{config.HOST}:{config.PORT}"
    if not _port_free(config.HOST, config.PORT):
        # Doppelklick auf Aktientool.command, obwohl das Tool schon läuft: einfach die Seite öffnen
        if config.OPEN_BROWSER and _tool_running(url):
            print(f"\n  Das Aktientool läuft bereits: {url}\n")
            webbrowser.open(url)
            raise SystemExit(0)
        print(f"\n  Port {config.PORT} ist belegt – läuft das Aktientool schon? Dann einfach {url} öffnen.\n"
              f"  Sonst anderen Port wählen: AKTIENTOOL_PORT=5051 .venv/bin/python run.py\n")
        raise SystemExit(1)
    print(f"\n  Aktientool läuft: {url}\n  Beenden mit Strg+C\n")
    alerts.start_background()
    # Weltauswahl, Tiefenanalyse und Abschläge der Fonds auch ohne geöffnete Seite aktuell halten
    kick = threading.Timer(15, lambda: (world.status(), trusts.refresh_if_stale()))
    kick.daemon = True
    kick.start()
    if config.OPEN_BROWSER:
        opener = threading.Timer(1.0, lambda: webbrowser.open(url))
        opener.daemon = True
        opener.start()
    app.run(host=config.HOST, port=config.PORT, threaded=True, debug=False)
