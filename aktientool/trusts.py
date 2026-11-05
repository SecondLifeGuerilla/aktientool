"""Trusts, Closed-End-Fonds und Holdings: Börsenwert im Vergleich zum inneren Wert (NAV).

- Closed-End-Fonds weltweit (Morningstar): Kurs und Abschlag, Stand Vortag. Bei britischen Trusts ergänzt die AIC
  den durchschnittlichen Abschlag über 1, 3 und 5 Jahre, die Spanne des letzten Jahres, Fremdkapital und Sektor.
  Die Liste wird im Hintergrund aufgebaut (rund 20 Sekunden) und zweimal am Tag erneuert.
- Holdings (aktientool/holdings.json, eigene in data/holdings.json): der innere Wert wird selbst gerechnet,
  börsennotierte Beteiligungen zum aktuellen Kurs, alles andere mit dem Wert aus dem letzten Bericht.
- Positionen der Fonds: Morningstar (London) bzw. SEC N-PORT (USA), erst beim Aufklappen geladen und eine Woche
  gemerkt. Für Fonds, die bei Trade Republic handelbar sind, lädt ein Hintergrund-Thread sie nach und nach vor.

Beträge für die Oberfläche in Euro (Kurs und NAV zum aktuellen Wechselkurs), Abschläge als Anteil (−0,09 = 9 %
Abschlag, positiv = Aufschlag).
"""

from __future__ import annotations

import bisect
import datetime as dt
import json
import logging
import re
import threading
import time

from . import config, userdata, world
from .cache import cache_age, cached, peek, store
from .sources import aic, fx, lsx, morningstar, nport, yahoo, yahoo_screener

log = logging.getLogger(__name__)

FUNDS_KEY = "trusts_fonds"
RETRY_AFTER = 20 * 60
QUOTES_TTL = 10 * 60
WARM_PAUSE = 3.0  # Sekunden zwischen zwei vorgeladenen Positionslisten

# Schwerpunkt aus Sektor (AIC) bzw. Kategorie (Morningstar), erste passende Regel gilt
GROUPS = [
    ("Private Equity", r"private equity|venture|growth capital"),
    ("Immobilien", r"property|real estate|reit"),
    ("Infrastruktur & Energie", r"infrastructure|renewable|energy limited partnership|leasing"),
    ("Rohstoffe", r"commodit|precious metal|natural resource|gold|silver|mining"),
    ("Mischanlage & Alternativ", r"hedge|flexible|allocation|multi-asset|alternative|macro|insurance|option|derivative"),
    ("Anleihen & Kredite", r"bond|debt|loan|credit|lending|muni|mortgage|fixed|preferred|convertible|securiti|high yield|"
                           r"government|corporate|income"),
]
# NAV nur geschätzt bzw. selten bewertet (Quartal, Halbjahr): der Abschlag bezieht sich dann auf einen älteren Wert
APPRAISED = {"Private Equity", "Immobilien", "Infrastruktur & Energie"}
VCT_RE = re.compile(r"\bVCT\b|venture capital trust", re.I)
OTHER_CLASS_RE = re.compile(r"\bZDP\b|\bCULS\b|zero dividend|subscription share|\bC shares?\b", re.I)


def group_of(text: str | None) -> str:
    t = (text or "").lower()
    equity = re.search(r"equity|stock|aktien", t) and "private equity" not in t
    for name, pattern in GROUPS:
        if name == "Anleihen & Kredite" and equity:
            continue  # „Equity Income“ sind Aktien
        if re.search(pattern, t):
            return name
    return "Aktien"


# ---------------------------------------------------------------- Fonds: Aufbau im Hintergrund

def build_funds() -> dict:
    funds = morningstar.closed_end_funds()
    try:
        uk = aic.load()
    except Exception as e:  # ohne AIC fehlen nur die Durchschnittswerte der britischen Trusts
        log.warning("AIC-Daten nicht geladen: %s", e)
        uk = {"date": None, "trusts": {}, "vct": []}
    vct = set(uk["vct"])
    rows = []
    for f in funds:
        if f["isin"] in vct or VCT_RE.search(f["name"] or ""):
            continue  # britische Steuersparmodelle, für Anleger außerhalb Großbritanniens uninteressant
        if OTHER_CLASS_RE.search(f["name"] or ""):
            continue  # Vorzugs- und Wandelpapiere der Trusts, keine Stammaktien
        row = {k: f[k] for k in ("sec_id", "isin", "name", "symbol", "exchange", "country", "currency", "price", "date",
                                 "disc", "category", "cap_eur", "ocf", "yield", "nav_ret5", "ret5", "manager", "launch")}
        a = uk["trusts"].get(f["isin"]) if f["isin"] else None
        if a:
            # gleicher Stand wie Morningstar (beide Vortag), aber mit Durchschnitten und Spanne
            for k in ("disc", "price"):
                if a.get(k) is not None:
                    row[k] = a[k]
            row.update({k: a.get(k) for k in ("sector", "disc_avg1", "disc_avg3", "disc_avg5", "disc_range1", "gearing",
                                              "website", "wind_up")})
            for k in ("ocf", "yield", "nav_ret5", "ret5", "manager", "launch"):
                if a.get(k) is not None:
                    row[k] = a[k]
        row["group"] = group_of(a.get("sector_en") if a else f["category"])
        disc = row["disc"]
        row["nav"] = row["price"] / (1 + disc) if disc is not None and disc > -0.95 else None
        rows.append(row)
    try:  # nur Ticker behalten, die Yahoo kennt (sonst führt der Link ins Leere); Börsenwert wie im übrigen Tool
        known = {q["symbol"]: q for q in yahoo_screener.quotes([r["symbol"] for r in rows if r["symbol"]]) if q.get("symbol")}
        if known:
            for r in rows:
                q = known.get(r["symbol"])
                if q is None:
                    r["symbol"] = None
                elif q.get("marketCap") and q.get("currency"):
                    # Yahoo gibt den Börsenwert in der Hauptwährung an (Pfund, nicht Pence)
                    r["cap"], r["cap_currency"] = q["marketCap"], fx.split_currency(q["currency"])[0]
    except Exception as e:
        log.info("Ticker der Fonds nicht geprüft: %s", e)
    dates = [r["date"] for r in rows if r.get("date")]
    return {"format": 1, "date": max(dates) if dates else None, "aic_date": uk["date"], "funds": rows}


_lock = threading.Lock()
_state = {"running": False, "failed_at": 0.0, "error": None, "warming": False, "warmed": None}


def _run() -> None:
    try:
        store(FUNDS_KEY, build_funds())
        with _lock:
            _state["error"] = None
    except Exception as e:
        log.warning("Closed-End-Fonds nicht geladen: %s", e)
        with _lock:
            _state.update(failed_at=time.time(), error=f"{type(e).__name__}: {e}")
    finally:
        with _lock:
            _state["running"] = False


def refresh_if_stale() -> bool:
    if config.SERVERLESS:
        return False  # serverlos lädt der tägliche Workflow die Fonds (scripts/daten.py)
    age = cache_age(FUNDS_KEY)
    # fehlten beim letzten Lauf die AIC-Daten (Seite nicht erreichbar), nach einer Stunde erneut versuchen
    incomplete = age is not None and age > 3600 and not (peek(FUNDS_KEY) or {}).get("aic_date")
    if age is not None and age < config.TTL_TRUSTS and not incomplete:
        return False
    with _lock:
        if _state["running"] or time.time() - _state["failed_at"] < RETRY_AFTER:
            return False
        _state["running"] = True
    threading.Thread(target=_run, name="trusts-fonds", daemon=True).start()
    return True


def refresh_now() -> None:
    """Fonds sofort (im laufenden Thread) neu laden, wenn sie veraltet sind; für den täglichen Workflow."""
    age = cache_age(FUNDS_KEY)
    incomplete = age is not None and age > 3600 and not (peek(FUNDS_KEY) or {}).get("aic_date")
    if age is None or age >= config.TTL_TRUSTS or incomplete:
        with _lock:
            _state["running"] = True
        _run()


def warm_now() -> None:
    """Positionen und Verlauf der handelbaren Fonds vorladen (im laufenden Thread); für den täglichen Workflow."""
    rows = fund_rows()
    if rows:
        with _lock:
            _state["warming"] = True
        _warm(rows)


# ---------------------------------------------------------------- Positionen der Fonds

def _detail_key(row: dict) -> str:
    return f"trust_positionen_{row.get('isin') or row.get('sec_id')}"


def _has_holdings_source(row: dict) -> bool:
    return row.get("exchange") == "XLON" or (row.get("country") == "US" and bool(row.get("symbol")))


def fund_holdings(row: dict) -> dict:
    """Größte Positionen eines Fonds: {"source", "date", "holdings": [{name, weight, …}], …}; leere Liste, wenn es
    keine kostenlose Quelle gibt."""
    if not _has_holdings_source(row):
        return {"source": None, "holdings": []}

    def load() -> dict:
        if row.get("country") == "US":
            found = nport.holdings(row["symbol"]) or {}
            return {"source": "SEC, Formular N-PORT", "date": found.get("date"), "holdings": found.get("holdings") or [],
                    "count": found.get("count")}
        found = morningstar.details(row["sec_id"]) or {}
        return {"source": "Morningstar", "date": found.get("holdings_date"), "holdings": found.get("holdings") or [],
                "nav_date": found.get("nav_date"), "nav_frequency": found.get("nav_frequency"),
                "avg_disc_12m": found.get("avg_disc_12m"), "avg_disc_3m": found.get("avg_disc_3m")}

    return cached(_detail_key(row), config.TTL_TRUST_HOLDINGS, load)


def _stale(key: str, ttl: float) -> bool:
    age = cache_age(key)
    return age is None or age > ttl


def _warm(rows: list[dict]) -> None:
    """Für die handelbaren Fonds Positionen und Verlauf vorladen: Die Tabelle zeigt dann die größten Positionen und
    hat auch für Fonds ohne AIC-Daten einen üblichen Abschlag (Schnitt aus dem Verlauf)."""
    handelbar = [r for r in rows if r.get("tr")]
    jobs = [(fund_holdings, r) for r in handelbar if _has_holdings_source(r) and _stale(_detail_key(r), config.TTL_TRUST_HOLDINGS)]
    jobs += [(fund_history, r) for r in handelbar if r.get("sec_id") and _stale(_stats_key(r), 3 * 24 * 3600)]
    try:
        for job, r in jobs:
            try:
                job(r)
            except Exception as e:
                log.info("%s für %s nicht geladen: %s", job.__name__, r.get("name"), e)
            time.sleep(WARM_PAUSE)
    finally:
        with _lock:
            _state["warming"] = False


def _start_warm(rows: list[dict]) -> None:
    if config.SERVERLESS:
        return
    today = time.strftime("%Y-%m-%d")
    with _lock:
        if _state["warming"] or _state["warmed"] == today:
            return
        _state.update(warming=True, warmed=today)
    threading.Thread(target=_warm, args=(rows,), name="trusts-positionen", daemon=True).start()


# ---------------------------------------------------------------- Kurse, Wechselkurse

_quotes_lock = threading.Lock()
_quotes: dict[str, tuple[float, dict]] = {}


def _live_quotes(symbols: list[str]) -> dict[str, dict]:
    now = time.time()
    with _quotes_lock:
        missing = [s for s in symbols if s not in _quotes or now - _quotes[s][0] > QUOTES_TTL]
    if missing:
        fetched = {q["symbol"]: q for q in yahoo_screener.quotes(missing) if q.get("symbol")}
        with _quotes_lock:
            for s in missing:
                _quotes[s] = (now, fetched.get(s) or {})
    with _quotes_lock:
        return {s: _quotes[s][1] for s in symbols if s in _quotes}


def _rates(currencies) -> dict[str, float]:
    return {c: v["rate"] for c, v in fx.eur_quotes([c for c in set(currencies) if c]).items()}


def _eur_on(currency: str | None, day: str) -> float | None:
    """Euro je Einheit der Währung am Tag `day` (Pence & Co. berücksichtigt)."""
    major, factor = fx.split_currency(currency)
    if major is None:
        return None
    if major == "EUR":
        return 1.0 / factor
    rows = [r for r in fx.eur_history(major) if r[0] <= day]
    return rows[-1][1] / factor if rows else None


def _close_on(symbol: str, day: str) -> float | None:
    return cached(f"schluss_{symbol}_{day}", 10 * 365 * 24 * 3600, lambda: yahoo.close_on(symbol, day))


# ---------------------------------------------------------------- Holdings: innerer Wert selbst gerechnet

def definitions() -> list[dict]:
    """Holdings aus aktientool/holdings.json, eigene Änderungen und eigene Holdings aus data/holdings.json gehen vor."""
    try:
        curated = json.loads(config.HOLDINGS_FILE.read_text("utf-8")).get("holdings") or []
    except (OSError, ValueError) as e:
        log.warning("holdings.json nicht lesbar: %s", e)
        curated = []
    out = {d["symbol"]: {**d, "custom": False} for d in curated}
    for sym, d in userdata.holding_defs().items():
        out[sym] = {**d, "custom": True, "replaces_default": sym in out}
    return list(out.values())


def _implied_shares(p: dict, d: dict, quote_currency: str | None) -> float | None:
    """Stückzahl aus dem Wert am Stichtag (Währung der Holding) und dem Kurs an diesem Tag."""
    close = _close_on(p["symbol"], d["as_of"])
    eur_q, eur_h = _eur_on(quote_currency, d["as_of"]), _eur_on(d["currency"], d["as_of"])
    if not close or not eur_q or not eur_h:
        return None
    return p["value"] / (close * eur_q / eur_h)


def _listed_share(listed: list[dict], other: list[dict]) -> float | None:
    value = sum(p["value_eur"] for p in listed)
    gross = value + sum(o["value_eur"] for o in other if (o["value_eur"] or 0) > 0)
    return value / gross if gross > 0 else None


def _holding(d: dict, quotes: dict[str, dict], rates: dict[str, float], detail: bool = False) -> dict:
    eur_h = rates.get(d["currency"])
    positions, stale = [], []
    for p in d.get("positions") or []:
        q = quotes.get(p["symbol"]) or {}
        price, ccy = q.get("regularMarketPrice"), q.get("currency")
        eur_q = rates.get(ccy)
        shares = p.get("shares")
        if shares is None and p.get("value") is not None and ccy:
            try:
                shares = _implied_shares(p, d, ccy)
            except Exception as e:
                log.info("Kurs von %s am %s nicht verfügbar: %s", p["symbol"], d["as_of"], e)
        if price and eur_q and shares:
            value = shares * price * eur_q
        elif p.get("value") is not None and eur_h:
            value = p["value"] * eur_h  # ohne Kurs: Wert laut Bericht
            stale.append(p["name"])
        else:
            value = None
            stale.append(p["name"])
        positions.append({"name": p["name"], "symbol": p["symbol"], "shares": shares, "value_eur": value,
                          "price_eur": price * eur_q if price and eur_q else None,
                          "change": (q.get("regularMarketChangePercent") or 0) / 100 if price else None})
    other = [{"name": o["name"], "value_eur": o["value"] * eur_h if eur_h else None} for o in d.get("other") or []]
    parts = [p["value_eur"] for p in positions] + [o["value_eur"] for o in other]
    nav = sum(v for v in parts if v is not None) if eur_h and all(v is not None for v in parts) else None
    hq = quotes.get(d["symbol"]) or {}
    eur_p = rates.get(hq.get("currency"))
    price = hq.get("regularMarketPrice") * eur_p if hq.get("regularMarketPrice") and eur_p else None
    nav_ps = nav / d["shares"] if nav is not None and d.get("shares") else None
    reported = d.get("nav_ps_reported") or (d["nav_reported"] / d["shares"] if d.get("nav_reported") and d.get("shares") else None)
    listed = sorted((p for p in positions if p["value_eur"]), key=lambda p: -p["value_eur"])
    names = [d["symbol"], *(d.get("aliases") or [])]  # die Weltauswahl führt z. B. Investor unter der A-Aktie
    tr = world.trade_republic(d["symbol"], d.get("isin"))
    if not tr.get("tradable"):
        tr = next((t for a in names[1:] if (t := world.trade_republic(a, None)).get("tradable")), tr)
    w = next((r for s in names if (r := world.stock(s))), None) or {}
    row = {
        "kind": "holding", "symbol": d["symbol"], "name": d.get("name") or hq.get("longName") or d["symbol"],
        "isin": d.get("isin") or w.get("isin"), "country": w.get("country"), "currency": hq.get("currency"),
        "group": "Holding", "category": "Beteiligungsgesellschaft",
        "price_eur": price, "nav_eur": nav_ps, "disc": price / nav_ps - 1 if price and nav_ps and nav_ps > 0 else None,
        "nav_report_eur": reported * eur_h if reported and eur_h else None,
        "date": d["as_of"], "cap_eur": price * d["shares"] if price and d.get("shares") else None,
        # Anteil der börsennotierten Beteiligungen am Bruttovermögen (Schulden nicht abgezogen)
        "listed_share": _listed_share(listed, other),
        "top": [p["name"] for p in listed[:3]], "custom": d.get("custom", False), "stale": stale,
        "tr": int(tr["tradable"]) if tr.get("tradable") is not None else None,
        "change": (hq.get("regularMarketChangePercent") or 0) / 100 if hq.get("regularMarketPrice") else None,
    }
    if detail:
        for p in positions:
            p["weight"] = p["value_eur"] / nav if p["value_eur"] is not None and nav else None
        for o in other:
            o["weight"] = o["value_eur"] / nav if o["value_eur"] is not None and nav else None
        row.update(positions=sorted(positions, key=lambda p: -(p["value_eur"] or 0)), other=other,
                   source=d.get("source"), url=d.get("url"), note=d.get("note"), shares=d.get("shares"),
                   replaces_default=d.get("replaces_default", False), nav_eur_total=nav,
                   definition={k: d.get(k) for k in ("name", "currency", "as_of", "shares", "nav_ps_reported", "source", "url", "aliases")}
                   | {"positions": [{"name": p["name"], "symbol": p["symbol"],
                                     "shares": round(s["shares"]) if s["shares"] else p.get("shares")}
                                    for p, s in zip(d.get("positions") or [], positions)],
                      "other": d.get("other") or []})
    return row


def holding_rows(defs: list[dict] | None = None, detail: bool = False) -> list[dict]:
    defs = definitions() if defs is None else defs
    symbols = sorted({d["symbol"] for d in defs} | {p["symbol"] for d in defs for p in d.get("positions") or []})
    quotes = _live_quotes(symbols) if symbols else {}
    rates = _rates([q.get("currency") for q in quotes.values()] + [d["currency"] for d in defs])
    out = []
    for d in defs:
        try:
            out.append(_holding(d, quotes, rates, detail))
        except Exception as e:  # eine fehlerhafte Definition soll die übrigen nicht verhindern
            log.warning("Holding %s nicht berechnet: %s", d.get("symbol"), e)
    _record(out)
    return out


# ---------------------------------------------------------------- Verlauf des Abschlags

HISTORY_TTL = 24 * 3600
NAV_MAX_AGE = 100  # Tage, die ein NAV gilt (Private Equity und Immobilien bewerten nur vierteljährlich)
HOLDING_YEARS = 3  # so weit rechnet das Tool den Verlauf einer Holding zurück
PERIODS = [("1", 1), ("3", 3), ("5", 5), ("10", 10), ("max", None)]
RECORD_FILE = "abschlag_holdings.json"  # im Ordner der Tagesstände: Abschläge der Holdings, wie sie täglich berechnet wurden


def _days_between(a: str, b: str) -> int:
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def discount_series(prices: list[list], navs: list[list], max_age: int = NAV_MAX_AGE) -> list[list]:
    """Abschlag je Kurstag: Kurs ÷ letzter bis dahin bekannter NAV − 1; Tage mit zu altem NAV fallen weg."""
    out, j, last = [], 0, None
    for day, price in prices:
        while j < len(navs) and navs[j][0] <= day:
            last = navs[j]
            j += 1
        if last is None or _days_between(last[0], day) > max_age:
            continue
        d = price / last[1] - 1
        if -0.95 < d < 3:  # Ausreißer (falscher NAV, Kapitalmaßnahme) verwerfen
            out.append([day, round(d, 5)])
    return out


def history_stats(points: list[list], years: int | None) -> dict | None:
    """Durchschnitt, größter und kleinster Abschlag (mit Datum) und wie oft der Abschlag größer war als heute."""
    if not points:
        return None
    last = points[-1][0]
    cutoff = (dt.date.fromisoformat(last) - dt.timedelta(days=round(365.25 * years))).isoformat() if years else ""
    pts = [p for p in points if p[0] >= cutoff]
    if len(pts) < 20:
        return None
    values = [p[1] for p in pts]
    lo, hi = min(pts, key=lambda p: p[1]), max(pts, key=lambda p: p[1])
    now = points[-1][1]
    return {"avg": sum(values) / len(values), "min": lo[1], "min_date": lo[0], "max": hi[1], "max_date": hi[0],
            "from": pts[0][0], "to": last, "count": len(pts),
            "complete": not years or _days_between(cutoff, pts[0][0]) <= 45,  # deckt den Zeitraum (fast) ganz ab
            "share_larger": sum(v < now for v in values) / len(values)}  # Anteil der Tage mit größerem Abschlag als heute


def _with_stats(points: list[list], **extra) -> dict:
    return {"points": points, "stats": {k: history_stats(points, y) for k, y in PERIODS}, **extra}


def _stats_key(row: dict) -> str:
    return f"abschlag_kennzahlen_{row.get('sec_id')}"


def fund_history(row: dict) -> dict:
    """Abschlag eines Fonds je Tag aus den Kurs- und NAV-Reihen von Morningstar (bei vielen Fonds ab 2000)."""
    def load() -> dict:
        points = discount_series(morningstar.timeseries(row["sec_id"], nav=False), morningstar.timeseries(row["sec_id"], nav=True))
        out = _with_stats(points, source="Morningstar: täglicher Schlusskurs und NAV", kind="fonds")
        store(_stats_key(row), out["stats"])  # klein, damit die Tabelle den Durchschnitt ohne die ganze Reihe kennt
        return out
    return cached(f"abschlag_verlauf_{row['sec_id']}", HISTORY_TTL, load)


class _Daily:
    """Werte je Tag; an Tagen ohne Wert gilt der letzte davor (Feiertage, unterschiedliche Börsen)."""

    def __init__(self, rows: list[list], factor: float = 1.0):
        self.days = [r[0] for r in rows]
        self.values = [r[1] * factor for r in rows]

    def at(self, day: str, before_start: bool = False) -> float | None:
        """`before_start`: vor dem ersten Tag den ersten Wert nehmen (Beteiligung erst später an die Börse gegangen)."""
        i = bisect.bisect_right(self.days, day) - 1
        if i < 0:
            return self.values[0] if before_start and self.values else None
        return self.values[i]


def _eur_daily(currency: str | None) -> _Daily | None:
    """Euro je Einheit der Währung je Tag (Pence & Co. berücksichtigt)."""
    major, factor = fx.split_currency(currency)
    if major is None:
        return None
    if major == "EUR":
        return _Daily([["0000-00-00", 1.0]], 1 / factor)
    rows = fx.eur_history(major)
    return _Daily(rows, 1 / factor) if rows else None


def _closes(symbol: str) -> list[list]:
    return cached(f"tageskurse_{symbol}", HISTORY_TTL, lambda: yahoo.daily_closes(symbol, "5y"))


def _recorded(symbol: str | None = None) -> dict:
    try:
        data = json.loads((config.SNAPSHOT_DIR / RECORD_FILE).read_text("utf-8"))
    except (OSError, ValueError):
        data = {}
    return data.get(symbol, {}) if symbol else data


_record_lock = threading.Lock()


def _record(rows: list[dict]) -> None:
    """Den heute berechneten Abschlag jeder Holding festhalten (der letzte Wert des Tages bleibt stehen). So entsteht
    ein Verlauf mit der jeweils gültigen Zusammensetzung, auch wenn die Angaben später an neue Berichte angepasst werden."""
    today = dt.date.today()
    if today.weekday() >= 5 or config.SERVERLESS:
        return  # serverlos hält der tägliche Workflow die Abschläge fest
    day = today.isoformat()
    with _record_lock:
        data = _recorded()
        changed = False
        for r in rows:
            if r.get("disc") is None or r.get("stale"):
                continue
            series = data.setdefault(r["symbol"], {})
            value = round(r["disc"], 5)
            if series.get(day) != value:
                series[day] = value
                changed = True
        if changed:
            try:
                config.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
                path = config.SNAPSHOT_DIR / RECORD_FILE
                tmp = path.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, separators=(",", ":")), "utf-8")
                tmp.replace(path)
            except OSError as e:
                log.warning("Abschläge der Holdings nicht gespeichert: %s", e)


def holding_history(d: dict) -> dict:
    """Abschlag einer Holding je Tag, rückgerechnet mit den Beteiligungen laut letztem Bericht und den Tageskursen;
    Tage, an denen das Tool den Abschlag selbst festgehalten hat, gehen vor."""
    symbols = [d["symbol"], *dict.fromkeys(p["symbol"] for p in d.get("positions") or [])]
    quotes = _live_quotes(symbols)
    closes = {s: _Daily(_closes(s)) for s in symbols}
    eur = {}
    for c in {d["currency"], *(q.get("currency") for q in quotes.values())}:
        if c:
            eur[c] = _eur_daily(c)
    parts, missing = [], []
    for p in d.get("positions") or []:
        ccy = (quotes.get(p["symbol"]) or {}).get("currency")
        shares = p.get("shares")
        if shares is None and p.get("value") is not None and ccy:
            try:
                shares = _implied_shares(p, d, ccy)
            except Exception:
                shares = None
        if shares and ccy and eur.get(ccy) and closes[p["symbol"]].days:
            parts.append((shares, closes[p["symbol"]], eur[ccy]))
        else:
            missing.append(p["name"])
    eur_h = eur.get(d["currency"])
    hold_ccy = (quotes.get(d["symbol"]) or {}).get("currency")
    eur_p = eur.get(hold_ccy)
    static = sum(o["value"] for o in d.get("other") or [])
    start = (dt.date.today() - dt.timedelta(days=round(365.25 * HOLDING_YEARS))).isoformat()
    points = []
    if eur_h and eur_p and not missing:
        for day in (x for x in closes[d["symbol"]].days if x >= start):
            values = [shares * series.at(day, before_start=True) * rate.at(day) for shares, series, rate in parts
                      if rate.at(day) is not None]
            if len(values) < len(parts) or eur_h.at(day) is None or eur_p.at(day) is None:
                continue  # an diesem Tag fehlt ein Wechselkurs
            nav_ps = (sum(values) + static * eur_h.at(day)) / d["shares"]
            if nav_ps > 0:
                points.append([day, round(closes[d["symbol"]].at(day) * eur_p.at(day) / nav_ps - 1, 5)])
    recorded = _recorded(d["symbol"])
    if recorded:
        merged = {day: v for day, v in points}
        merged.update(recorded)
        points = sorted([day, v] for day, v in merged.items())
    return _with_stats(points, kind="holding", as_of=d["as_of"], missing=missing,
                       recorded_from=min(recorded) if recorded else None,
                       source=f"rückgerechnet mit den Beteiligungen laut Bericht vom {d['as_of']} und den Tageskursen (Yahoo)")


def history(symbol: str) -> dict | None:
    d = _definition(symbol)
    if d:
        return holding_history(d)
    row = _fund(symbol, None)
    if row is None:
        return None
    return fund_history(row) if row.get("sec_id") else _with_stats([], kind="fonds")


# ---------------------------------------------------------------- Fonds für die Oberfläche

def _usual(row: dict, cached_detail: dict | None) -> tuple[float | None, str | None]:
    """Üblicher Abschlag als Vergleich: Schnitt über 5, 3 oder 1 Jahr (AIC, sonst aus dem Verlauf von Morningstar),
    zuletzt der 12-Monats-Schnitt aus der Detailansicht von Morningstar."""
    for key, label in (("disc_avg5", "5 J."), ("disc_avg3", "3 J."), ("disc_avg1", "1 J.")):
        if row.get(key) is not None:
            return row[key], label
    stats = peek(_stats_key(row)) if row.get("sec_id") else None
    for key, label in (("5", "5 J."), ("3", "3 J."), ("1", "1 J.")):
        s = (stats or {}).get(key)
        if s and s.get("complete"):
            return s["avg"], label
    if cached_detail and cached_detail.get("avg_disc_12m") is not None:
        return cached_detail["avg_disc_12m"], "12 Mon."
    return None, None


def fund_rows(rows: list[dict] | None = None) -> list[dict]:
    """Fonds mit Euro-Beträgen, Handelbarkeit bei Trade Republic, üblichem Abschlag und (falls schon geladen) den
    drei größten Positionen."""
    rows = (peek(FUNDS_KEY) or {}).get("funds") or [] if rows is None else rows
    listing, overrides = lsx.current(), userdata.tradable_overrides()
    rates = _rates([r.get("currency") for r in rows] + [r.get("cap_currency") for r in rows])
    out = []
    for r in rows:
        rate = rates.get(r.get("currency"))
        cap_rate = rates.get(r.get("cap_currency"))
        row = {**r, "kind": "fonds", "price_eur": r["price"] * rate if rate else None,
               "nav_eur": r["nav"] * rate if rate and r.get("nav") else None, "appraised": r.get("group") in APPRAISED}
        if r.get("cap") and cap_rate:
            row["cap_eur"] = r["cap"] * cap_rate
        info = world.trade_republic_info(r.get("symbol") or "", [r["isin"]] if r.get("isin") else [], listing, overrides)
        if info["tradable"] is not None:
            row["tr"] = int(info["tradable"])
        detail = peek(_detail_key(r)) if _has_holdings_source(r) else None
        row["disc_usual"], row["usual_basis"] = _usual(r, detail)
        if detail and detail.get("holdings"):
            row["top"] = [h["name"] for h in detail["holdings"][:3]]
        out.append(row)
    return out


def overview() -> dict:
    refresh_if_stale()
    funds = fund_rows()
    if funds:
        _start_warm(funds)
    data = peek(FUNDS_KEY) or {}
    with _lock:
        st = dict(_state)
    return {"ready": bool(funds), "loading": st["running"], "error": st["error"], "date": data.get("date"),
            "aic_date": data.get("aic_date"), "funds": funds, "holdings": holding_rows(),
            "trade_republic": lsx.status()}


def _fund(symbol: str | None, isin: str | None) -> dict | None:
    rows = (peek(FUNDS_KEY) or {}).get("funds") or []
    return next((r for r in rows if (symbol and r.get("symbol") == symbol) or (isin and r.get("isin") == isin)), None)


def _definition(symbol: str) -> dict | None:
    return next((d for d in definitions() if d["symbol"] == symbol or symbol in (d.get("aliases") or [])), None)


def detail(symbol: str) -> dict | None:
    """Ein Fonds oder eine Holding mit allen Positionen (für das Aufklappen in der Tabelle und das Profil)."""
    d = _definition(symbol)
    if d:
        return holding_rows([d], detail=True)[0]
    row = _fund(symbol, None)
    if row is None:
        return None
    found = fund_rows([row])[0]
    try:
        found["holdings"] = fund_holdings(row)
    except Exception as e:
        log.info("Positionen von %s nicht geladen: %s", symbol, e)
        found["holdings"] = {"source": None, "holdings": [], "error": str(e)}
    found["disc_usual"], found["usual_basis"] = _usual(found, found["holdings"])
    return found


def find(symbol: str, isin: str | None) -> dict | None:
    """Kurzfassung für das Aktienprofil: Fonds aus dem Cache (lädt nie nach) oder Holding mit aktuellen Kursen."""
    d = _definition(symbol)
    if d:
        return holding_rows([d])[0]
    row = _fund(symbol, isin)
    return fund_rows([row])[0] if row else None
