"""Hebelprodukte für den Call/Put-Rechner: ein Produkt per ISIN oder WKN laden und die Produkte auf eine Aktie oder
einen Index auflisten, auf Wunsch nur die bei Trade Republic handelbaren (Daten von onvista, siehe sources/onvista.py).

Der Rechner kennt die Aktie als Yahoo-Ticker, onvista den Basiswert unter einer eigenen Kennung; verbunden werden
beide über die ISIN (Weltauswahl, Yahoo-Profil, feste Liste für Indizes). Diese Zuordnung ändert sich praktisch nie
und liegt 30 Tage im Cache, Fehltreffer werden nicht gespeichert. Kurse gelten nur wenige Minuten und bleiben im
Speicher statt im Datei-Cache (jede Filterkombination wäre sonst eine Datei).
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Mapping

from . import config, world
from .cache import cache_age, peek, store
from .sources import fx, onvista, yahoo
from .userdata import InvalidInput

log = logging.getLogger(__name__)

# Yahoo-Ticker der Indizes -> ISIN (onvista sucht Indizes wie Aktien über die ISIN)
INDEX_ISINS = {
    "^GDAXI": "DE0008469008", "^MDAXI": "DE0008467416", "^TECDAX": "DE0007203275", "^SDAXI": "DE0009653386",
    "^STOXX50E": "EU0009658145", "^GSPC": "US78378X1072", "^NDX": "US6311011026", "^DJI": "US2605661048",
    "^FCHI": "FR0003500008", "^SSMI": "CH0009980894", "^FTSE": "GB0001383545", "^ATX": "AT0000999982",
    "^HSI": "HK0000004322",
}
INDEX_SYMBOLS = {isin: sym for sym, isin in INDEX_ISINS.items()}
ID_RE = re.compile(r"^(?:[A-Z]{2}[A-Z0-9]{9}\d|[A-Z0-9]{6})$")  # ISIN oder WKN
# Auswahl der Filter in der Oberfläche -> Bereich (von, bis); Laufzeit in Monaten ab heute
MATURITIES = {"3m": (0, 3), "6m": (3, 6), "12m": (6, 12), "lang": (12, None)}
LEVERAGES = {"5": (None, 5), "10": (5, 10), "20": (10, 20), "20+": (20, None)}
KO_DISTANCES = {"5": (None, 0.05), "10": (0.05, 0.10), "20": (0.10, 0.20), "20+": (0.20, None)}
MAX_PAGE = onvista.LIMIT // onvista.PAGE - 1  # der Finder gibt nur die ersten 1.000 Zeilen heraus
MEMO_SIZE = 300
ALL_CAP = 6000  # alle Produkte auf einen Basiswert: höchstens so viele (der Dax hat über 20.000 Knock-outs)
ALL_MEMO = 12
# Felder, die die Liste aller Produkte nicht braucht (die Antwort wird so ein Drittel kleiner)
ALL_DROP = ("name", "url", "doc", "id", "gearing", "ccy")
# Überblick im Aktienprofil: vier Gruppen, darin typische Produkte (Laufzeit 3–12 Monate, Hebel 5–10)
OVERVIEW_GROUPS = [("os", True), ("os", False), ("ko", True), ("ko", False)]
OVERVIEW_LEVERAGE = (5, 10)
OVERVIEW_MONTHS = (3, 12)


# ---------------------------------------------------------------- Zwischenspeicher

def _lasting(key: str, loader: Callable[[], dict | None]) -> dict | None:
    """Zuordnungen: Datei-Cache für 30 Tage, aber nur Treffer (ein heute neues Produkt kennt onvista vielleicht erst morgen)."""
    age = cache_age(key)
    if age is not None and age < config.TTL_ONVISTA_IDS:
        hit = peek(key)
        if hit:
            return hit
    found = loader()
    if found:
        store(key, found)
    return found


_memo: dict = {}
_memo_all: dict = {}  # vollständige Listen (bis zu 6.000 Produkte): nur wenige auf einmal
_memo_lock = threading.Lock()


_loading: dict = {}  # Schlüssel -> Lock: dieselbe Abfrage zweimal gleichzeitig lädt nur einmal


def _fresh(key: tuple, loader: Callable[[], dict], memo: dict = _memo, size: int = MEMO_SIZE) -> dict:
    """Kurse und Produktlisten: im Speicher, solange sie jünger als TTL_DERIVATE sind."""
    def hit():
        with _memo_lock:
            found = memo.get(key)
            return found[1] if found and time.time() - found[0] < config.TTL_DERIVATE else None

    value = hit()
    if value is not None:
        return value
    with _memo_lock:
        lock = _loading.setdefault(key, threading.Lock())
    with lock:
        value = hit()  # hat inzwischen eine andere Anfrage geladen?
        if value is not None:
            return value
        value = loader()
        with _memo_lock:
            if len(memo) >= size:
                for k in sorted(memo, key=lambda k: memo[k][0])[: max(1, size // 2)]:
                    del memo[k]
            memo[key] = (time.time(), value)
            _loading.pop(key, None)
    return value


# ---------------------------------------------------------------- Ticker <-> Basiswert

def _candidate_isins(symbol: str) -> list[str]:
    if symbol in INDEX_ISINS:
        return [INDEX_ISINS[symbol]]
    out = world.isins(symbol)
    raw = peek(f"yahoo_{symbol}") or {}  # Profil schon einmal geöffnet: ISIN von Yahoo liegt im Cache
    if raw.get("isin"):
        out.append(raw["isin"])
    if not out:
        found = yahoo.isin(symbol)
        if found:
            out.append(found)
    return list(dict.fromkeys(out))


def underlying_for(symbol: str) -> dict | None:
    """Basiswert bei onvista zu einem Yahoo-Ticker: {type, id, name, isin} oder None. Eine falsche ISIN (Yahoo
    liefert manchmal die eines Zertifikats) fällt von selbst heraus, weil onvista dazu keine Aktie kennt."""
    def load():
        for isin in _candidate_isins(symbol):
            found = onvista.underlying(isin)
            if found:
                return found
        return None
    return _lasting(f"onvista_basiswert_{symbol}", load)


def symbol_for(isin: str | None) -> str | None:
    """Yahoo-Ticker zum Basiswert eines Produkts (für Kurs, Volatilität und Dividende)."""
    if not isin:
        return None
    if isin in INDEX_SYMBOLS:
        return INDEX_SYMBOLS[isin]
    found = world.symbol_for_isin(isin)
    if found:
        return found

    def load():
        hits = yahoo.search(isin, limit=5)
        return {"symbol": hits[0]["symbol"]} if hits else None
    hit = _lasting(f"onvista_ticker_{isin}", load)
    return hit["symbol"] if hit else None


def _eur_rates(currencies: list[str | None]) -> dict[str, float]:
    """Euro je Einheit der Währung, in der onvista Basispreis und Schwelle angibt. Sie ist nicht immer die Kurswährung
    bei Yahoo: Produkte auf Shell rechnen mit dem Euro-Kurs der Aktie, Yahoo führt Shell in Pence."""
    wanted = sorted({c for c in currencies if isinstance(c, str) and re.fullmatch(r"[A-Za-z]{3}", c) and c != "PKT"})
    if not wanted:
        return {}
    try:
        return {c: v["rate"] for c, v in fx.eur_quotes(wanted).items()}
    except Exception as e:  # ohne Kurs rechnet die Oberfläche nur, wo die Währungen übereinstimmen
        log.info("Euro-Kurse für %s nicht verfügbar: %s", wanted, e)
        return {}


def _enrich(rows: list[dict]) -> list[dict]:
    """Euro-Kurs der Basispreis-Währung und der Kurs der Aktie, mit dem onvista gerechnet hat. Den liefert der Finder
    nicht direkt, er folgt aber aus dem einfachen Hebel: Hebel = Kurs in Euro × Bezugsverhältnis / Briefkurs. Die
    Oberfläche bewertet jedes Produkt mit diesem Kurs; der Kurs von Yahoo stammt oft von einem anderen Zeitpunkt
    (Schlusskurs in London um 17:30, Briefkurs des Emittenten um 22:00), und schon 1 % Abstand verfälscht bei Hebel 10
    den Preis-Check um 10 %."""
    rates = _eur_rates([r.get("under_ccy") for r in rows])
    for r in rows:
        rate = rates.get(r.get("under_ccy"))
        r["eur_under"] = rate
        if r.get("under_price") is None and not r.get("quanto") and rate and r.get("gearing") and r.get("ask") and r.get("ratio"):
            r["under_price"] = r["gearing"] * r["ask"] / r["ratio"] / rate
    return rows


# ---------------------------------------------------------------- Produkte

def product(query: str) -> dict:
    """Ein Hebelprodukt per ISIN oder WKN mit Basiswert (samt Yahoo-Ticker, falls bekannt)."""
    q = query.strip().upper().replace(" ", "")
    if not ID_RE.match(q):
        raise InvalidInput("Bitte eine ISIN (12 Zeichen, z. B. DE000HG0ABC1) oder WKN (6 Zeichen) eingeben.")
    found = _lasting(f"onvista_id_{q}", lambda: onvista.lookup(q))
    if not found or found.get("type") != "DERIVATIVE":
        raise onvista.NotFound(q)

    def load():
        p = onvista.product(found["id"])
        p["under"]["symbol"] = symbol_for(p["under"].get("isin"))
        return _enrich([p])[0]
    return _fresh(("produkt", found["id"]), load)


def _months(n: int, today: dt.date) -> str:
    return (today + dt.timedelta(days=round(n * 30.44))).isoformat()


def _float(args: Mapping[str, str], key: str) -> float | None:
    raw = (args.get(key) or "").strip().replace(",", ".")
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        raise InvalidInput(f"„{args.get(key)}“ ist keine Zahl.") from None
    if not value >= 0:
        raise InvalidInput(f"„{args.get(key)}“: bitte eine Zahl ab 0 eingeben.")
    return value


def _day_arg(args: Mapping[str, str], key: str) -> str | None:
    raw = (args.get(key) or "").strip()
    if not raw:
        return None
    try:
        return dt.date.fromisoformat(raw).isoformat()
    except ValueError:
        raise InvalidInput(f"„{raw}“ ist kein Datum (JJJJ-MM-TT).") from None


def _pair(args: Mapping[str, str], lo_key: str, hi_key: str, scale: float = 1) -> tuple | None:
    lo, hi = _float(args, lo_key), _float(args, hi_key)
    if lo is None and hi is None:
        return None
    return (None if lo is None else lo * scale, None if hi is None else hi * scale)


def filters_from(args: Mapping[str, str], kind: str, today: dt.date | None = None) -> dict:
    """Filter aus der Adresse (?laufzeit=6m&hebel=10&…) für onvista.products. Unbekannte Werte heißen „alle“.
    Eigene Bereiche (hebel_von/hebel_bis, faellig_von/faellig_bis, abstand_von/abstand_bis in %) gehen der Auswahl vor."""
    today = today or dt.date.today()
    f: dict = {"tr": args.get("tr", "1") != "0"}
    issuer = (args.get("emittent") or "").strip()
    if issuer.isdigit():
        f["issuer"] = int(issuer)
    strike = _pair(args, "von", "bis")
    if strike:
        f["strike"] = strike
    leverage = _pair(args, "hebel_von", "hebel_bis")
    if leverage:
        f["leverage"] = leverage
    elif args.get("hebel") in LEVERAGES:
        f["leverage"] = LEVERAGES[args["hebel"]]
    if kind == "os":
        # abgelaufene Scheine nie zeigen; ohne Auswahl alle ab heute
        m = MATURITIES.get(args.get("laufzeit", ""))
        f["maturity"] = (_months(m[0], today), _months(m[1], today) if m[1] is not None else None) if m else (today.isoformat(), None)
        lo, hi = _day_arg(args, "faellig_von"), _day_arg(args, "faellig_bis")
        if lo or hi:
            f["maturity"] = (max(lo or today.isoformat(), today.isoformat()), hi)
    else:
        f["open_end"] = {"open": True, "fix": False}.get(args.get("laufzeit", ""))
        f["stop_loss"] = {"mini": True, "turbo": False}.get(args.get("ko", ""))
        distance = _pair(args, "abstand_von", "abstand_bis", 0.01)
        if distance:
            f["ko_distance"] = distance
        elif args.get("abstand") in KO_DISTANCES:
            f["ko_distance"] = KO_DISTANCES[args["abstand"]]
    return f


def listing(symbol: str, kind: str, call: bool, filters: dict, sort: str | None = None,
            order: str = "ASC", page: int = 0) -> dict:
    """Produkte auf die Aktie, eine Seite (100) je Abfrage: {under, total, page, per_page, rows}."""
    u = underlying_for(symbol)
    if not u:
        return {"under": None, "total": 0, "page": 0, "per_page": onvista.PAGE, "rows": []}
    page = max(0, min(page, MAX_PAGE))
    key = ("liste", u["type"], u["id"], kind, call, repr(sorted(filters.items())), sort, order, page)
    def load():
        res = onvista.products(u["type"], u["id"], kind, call, filters, sort, order, page)
        _enrich(res["rows"])
        return res
    res = _fresh(key, load)
    return {"under": {"name": u.get("name"), "isin": u.get("isin")}, "page": page, "per_page": onvista.PAGE, **res}


def listing_all(symbol: str, kind: str, call: bool, filters: dict) -> dict:
    """Alle Produkte auf die Aktie (höchstens ALL_CAP) für die große Tabelle, die im Browser filtert und nach jeder
    Spalte sortiert: {under, total, complete, spot, rows}. complete=False: Es gibt mehr, geladen sind die mit dem
    Basispreis am nächsten am Kurs; die Oberfläche schickt dann ihre Filter mit."""
    u = underlying_for(symbol)
    if not u:
        return {"under": None, "total": 0, "complete": True, "spot": None, "rows": []}
    key = ("alle", u["type"], u["id"], kind, call, repr(sorted(filters.items())))

    def load():
        res = onvista.all_products(u["type"], u["id"], kind, call, filters, ALL_CAP)
        rows = [{k: v for k, v in r.items() if k not in ALL_DROP} for r in _enrich(res["rows"])]
        return {**res, "rows": rows}
    res = _fresh(key, load, _memo_all, ALL_MEMO)
    return {"under": {"name": u.get("name"), "isin": u.get("isin")}, **res}


def overview(symbol: str, tr: bool = True, today: dt.date | None = None) -> dict:
    """Überblick für das Aktienprofil: je Gruppe (Call-/Put-Optionsscheine, Knock-outs Long/Short) die Anzahl und
    bis zu 100 typische Produkte (Laufzeit 3–12 Monate bzw. Hebel 5–10, die mit der kleinsten Spanne zuerst); die
    Oberfläche wählt daraus die mit dem günstigsten Preis-Check. Acht Abfragen, parallel."""
    u = underlying_for(symbol)
    if not u:
        return {"under": None, "groups": []}
    today = today or dt.date.today()

    def group(kind: str, call: bool) -> dict:
        base: dict = {"tr": tr}
        typical: dict = {"tr": tr, "leverage": OVERVIEW_LEVERAGE}
        if kind == "os":
            base["maturity"] = (today.isoformat(), None)
            typical["maturity"] = (_months(OVERVIEW_MONTHS[0], today), _months(OVERVIEW_MONTHS[1], today))
        total = onvista.products(u["type"], u["id"], kind, call, base, per_page=1)["total"]
        res = onvista.products(u["type"], u["id"], kind, call, typical, sort="spreadAskPct", order="ASC")
        return {"art": kind, "typ": "call" if call else "put", "total": total, "typical": res["total"],
                "rows": _enrich(res["rows"])}

    def load():
        with ThreadPoolExecutor(len(OVERVIEW_GROUPS)) as ex:
            return list(ex.map(lambda g: group(*g), OVERVIEW_GROUPS))
    groups = _fresh(("ueberblick", u["type"], u["id"], tr, today.isoformat()), load)
    return {"under": {"name": u.get("name"), "isin": u.get("isin")}, "groups": groups}
