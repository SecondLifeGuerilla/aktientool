"""Webserver: liefert die Oberfläche aus und stellt die JSON-API bereit.

Läuft lokal (python run.py) oder serverlos auf Vercel (api/index.py). Der Server speichert nichts über Nutzer:
Depot, Watchlist, Notizen und Alarme liegen im Browser. Was davon in Berechnungen einfließt (Korrekturen zur
Handelbarkeit, eigene Holdings), schickt die Oberfläche als Kontext mit (siehe ContextMiddleware).
"""

from __future__ import annotations

import http.client
import io
import json
import logging
import re
import socket
import threading
import urllib.request
import webbrowser
from datetime import datetime, timezone

from flask import Flask, Response, jsonify, request, send_from_directory

from . import alerts, config, deep, derivate, eur, outlook, remote, rueckblick, service, snapshots, trusts, userdata, world
from .analysis import metrics
from .cache import cached
from .sources import fx, news, onvista, tradegate, wiki, yahoo, yahoo_screener

log = logging.getLogger(__name__)
app = Flask(__name__, static_folder=None)
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


class ContextMiddleware:
    """GET-Anfragen mit Kontext kommen als POST mit dem Kopf „X-HTTP-Method-Override: GET“ und dem Kontext als
    JSON im Körper (ein Kopf wäre für viele eigene Holdings zu klein). Die Middleware merkt sich den Körper und reicht
    die Anfrage als GET weiter; userdata.context() liest ihn."""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        if environ.get("REQUEST_METHOD") == "POST" and environ.get("HTTP_X_HTTP_METHOD_OVERRIDE", "").upper() == "GET":
            try:
                length = int(environ.get("CONTENT_LENGTH") or 0)
            except ValueError:
                length = 0
            environ["aktientool.context"] = environ["wsgi.input"].read(min(length, userdata.MAX_CONTEXT_BYTES))
            environ.update({"REQUEST_METHOD": "GET", "CONTENT_LENGTH": "0", "wsgi.input": io.BytesIO(b"")})
        return self.wsgi_app(environ, start_response)


app.wsgi_app = ContextMiddleware(app.wsgi_app)


@app.before_request
def _remote_data():
    # serverlos: täglich vorberechnete Daten bei Bedarf nachladen (höchstens alle paar Minuten eine kurze Prüfung)
    if config.SERVERLESS and request.path.startswith("/api/"):
        remote.ensure()


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


@app.get("/")
def index():
    return send_from_directory(config.STATIC_DIR, "index.html")


@app.get("/static/<path:path>")
def static_files(path: str):
    resp = send_from_directory(config.STATIC_DIR, path)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/info")
def api_info():
    """Betriebsart: lokal oder serverlos (dann mit Stand der vorberechneten Daten)."""
    return jsonify(remote.status())


@app.get("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if len(q) < 1:
        return jsonify([])
    results = yahoo.search(q)
    symbols = [r["symbol"] for r in results]
    flags = world.tradable_flags(symbols)  # nur für Ticker aus der Weltauswahl bekannt
    for r in results:
        if r["symbol"] in flags:
            r["tr"] = flags[r["symbol"]]
    # Notierungen aus der Weltauswahl zuerst: Nur dort gibt es Scores, und Yahoo stellt oft das US-Zertifikat
    # (NVO, SAP, TM) vor die Heimatbörse. Die Reihenfolge innerhalb beider Gruppen bleibt die von Yahoo.
    known = world.members(symbols)
    results.sort(key=lambda r: r["symbol"] not in known)
    return jsonify(results)


@app.get("/api/profile/<symbol>")
def api_profile(symbol: str):
    # Anzeige in Euro (siehe eur.py); intern rechnet alles weiter in der Kurswährung
    sym = _symbol(symbol)
    prof = eur.profile(service.build_profile(sym, refresh=request.args.get("refresh") == "1"))
    # Zweitnotierung (ADR …): auf die Heimatnotierung in der Weltauswahl verweisen, dort gibt es die Scores
    home = world.home_listing(sym, prof.get("name"))
    prof["home_listing"] = home
    prof["trade_republic"] = world.trade_republic(sym, prof["facts"].get("isin"), home["symbol"] if home else None)
    isin = prof["trade_republic"].get("isin") or prof["facts"].get("isin")
    prof["live"] = _live(isin, prof["facts"].get("price") if prof.get("currency") == "EUR" else None)
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


@app.get("/api/handelbar/<symbol>")
def api_tradable(symbol: str):
    """Handelbarkeit bei Trade Republic laut Handelsliste, mit der eigenen Korrektur aus dem Kontext (die speichert
    der Browser)."""
    sym = _symbol(symbol)
    return jsonify(world.trade_republic(sym, request.args.get("isin", "").strip().upper() or None))


@app.get("/api/world/status")
def api_world_status():
    return jsonify(world.status())


@app.post("/api/world/refresh")
def api_world_refresh():
    world.start()  # serverlos: tut nichts, der tägliche Workflow baut die Daten
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

def _live(isin: str | None, eur_price: float | None = None) -> dict | None:
    """Live-Kurs in Euro von Tradegate, wenn dort heute gehandelt wurde. Weicht er vom Yahoo-Kurs (in Euro) um mehr als
    ein Drittel ab, gehört die ISIN wohl zu einer anderen Gattung: dann lieber ohne."""
    try:
        q = tradegate.quote(isin)
    except Exception as e:
        log.info("Live-Kurs %s: %s", isin, e)
        return None
    if q and eur_price and not (0.67 < q["price"] / eur_price < 1.5):
        return None
    return q and {**q, "isin": isin}


def _with_live(quotes: list[dict], isins: dict[str, str]) -> list[dict]:
    """Euro-Kurse von Yahoo durch Tradegate ersetzen, wo es einen Live-Kurs gibt (vor US-Börsenbeginn ist der
    Yahoo-Kurs einer US-Aktie der Schlusskurs vom Vortag). Der Kurs an der Heimatbörse bleibt in original_price."""
    live = tradegate.quotes([isins[q["symbol"]] for q in quotes if q.get("symbol") in isins])
    out = []
    for q in quotes:
        t = live.get(isins.get(q.get("symbol"), ""))
        yahoo_eur = q.get("price") if q.get("currency") == "EUR" else None
        if t and (not yahoo_eur or 0.67 < t["price"] / yahoo_eur < 1.5):
            q = {**q, "price": t["price"], "change": t["change"], "currency": "EUR", "live_source": t["source"],
                 "bid": t["bid"], "ask": t["ask"]}
        out.append(q)
    return out


@app.get("/api/live")
def api_live():
    """Live-Kurse in Euro (Tradegate) je ISIN: ?i=ISIN,ISIN …  -> {ISIN: {price, change, bid, ask, …}}."""
    isins = [i.strip().upper() for i in request.args.get("i", "").split(",") if i.strip()][:tradegate.MAX_PER_CALL]
    return jsonify(tradegate.quotes(isins))


@app.get("/api/quotes")
def api_quotes():
    syms = _symbols(request.args.get("s", ""))
    if not syms:
        return jsonify([])
    rows = eur.quotes([{"symbol": q.get("symbol"), "price": q.get("regularMarketPrice"), "currency": q.get("currency"),
                     "change": (q.get("regularMarketChangePercent") or 0) / 100, "name": q.get("longName") or q.get("shortName"),
                     # nächster (oder letzter) Zahlentermin und Dividenden-Zahltag, für die Startseite
                     "earnings_date": _day(q.get("earningsTimestampStart") or q.get("earningsTimestamp")),
                     "earnings_estimate": bool(q.get("isEarningsDateEstimate")),
                     "dividend_date": _day(q.get("dividendDate"))}
                    for q in yahoo_screener.quotes(syms)])
    return jsonify(_with_live(rows, world.isins(syms)))


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


@app.post("/api/trusts/holding/<symbol>")
def api_trust_holding_check(symbol: str):
    """Eigene Holding prüfen und durchrechnen (Beteiligungen, Stichtag, Aktienzahl): {definition, detail}. Speichern
    tut der Browser die bereinigte Definition; weitere eigene Holdings stehen im Feld „context“."""
    sym = _symbol(symbol)
    body = _body()
    if body.get("context") is not None:
        request.environ["aktientool.context"] = json.dumps(body["context"])
    definition = userdata.clean_holding_def(sym, body.get("definition") or {})
    userdata.add_holding_to_context(sym, definition)
    return jsonify({"definition": definition, "detail": trusts.detail(sym)})


# ---------------------------------------------------------------- Alarme (gespeichert im Browser, geprüft hier)

@app.get("/api/alerts/types")
def api_alert_types():
    return jsonify(userdata.ALERT_TYPES)


@app.get("/api/alerts/baseline/<symbol>")
def api_alert_baseline(symbol: str):
    """Ausgangswert für „Dividende gekürzt“: Dividende der letzten 12 Monate (Kurswährung und, falls möglich, Euro)."""
    sym = _symbol(symbol)
    row = service.summary_row(sym)
    baseline = row.get("div_ttm") or None
    if not baseline:
        raise ApiError("Die Aktie zahlt derzeit keine Dividende.")
    shown = eur.summary(row)
    return jsonify({"baseline": baseline, "baseline_eur": shown.get("div_ttm") if shown.get("currency") == "EUR" else None})


@app.post("/api/alerts/check")
def api_alerts_check():
    """Offene Alarme aus dem Browser prüfen: {"alerts": [...]} -> {"triggered": {Kennung: {triggered, message}}}."""
    items = _body().get("alerts")
    if not isinstance(items, list):
        raise ApiError("Erwartet wird eine Liste von Alarmen.")
    if len(items) > alerts.MAX_ALERTS:
        raise ApiError(f"Höchstens {alerts.MAX_ALERTS} Alarme auf einmal.")
    return jsonify({"triggered": alerts.check(items), "checked": datetime.now(timezone.utc).timestamp()})


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


@app.get("/api/rueckblick")
def api_rueckblick():
    """Rückblick des Score-Checks: Kursfaktoren über die letzten Jahre (aus den Monatskursen der Tiefenanalyse)."""
    return jsonify(rueckblick.result())


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
    # Weltauswahl, Tiefenanalyse und Abschläge der Fonds auch ohne geöffnete Seite aktuell halten
    kick = threading.Timer(15, lambda: (world.status(), trusts.refresh_if_stale()))
    kick.daemon = True
    kick.start()
    if config.OPEN_BROWSER:
        opener = threading.Timer(1.0, lambda: webbrowser.open(url))
        opener.daemon = True
        opener.start()
    app.run(host=config.HOST, port=config.PORT, threaded=True, debug=False)
