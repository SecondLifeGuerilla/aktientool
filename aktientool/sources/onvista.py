"""Hebelprodukte (Optionsscheine, Knock-outs) über die öffentliche Schnittstelle von onvista (api.onvista.de).

onvista führt die Produkte aller großen Emittenten mit Stammdaten (Basispreis, Schwelle, Bezugsverhältnis, Fälligkeit)
und dem Geld- und Briefkurs des Emittenten. Drei Abfragen, alle ohne Anmeldung:
- Suche (instruments/search/facet): ISIN oder WKN -> Produkt oder Basiswert (Aktie, Index) mit der Kennung bei onvista.
- Finder (derivatives/finder/configuration_query): Produkte auf einen Basiswert, gefiltert und sortiert, höchstens
  100 je Seite. Der Filter „Broker: Trade Republic“ (brokerId=8260) liefert genau die Produkte der Emittenten, mit
  denen Trade Republic außerbörslich handelt (laut Trade Republic HSBC, Société Générale, UBS und Vontobel; die
  Anzahl stimmt mit dem Filter auf diese vier Emittenten überein).
- Snapshot (derivatives/<Kennung>/snapshot): ein Produkt mit allen Kennzahlen.
Mit gzip sind die Antworten viel kleiner (100 Zeilen: 30 statt 520 KB); sie brechen trotzdem gelegentlich ab.
Prozentangaben liefert onvista als Prozentzahl (5 = 5 %), hier werden sie zu Anteilen (0,05).
Je Abfrage gibt der Finder höchstens 1.000 Zeilen heraus (Seite 10 ergibt Fehler 400); mehr lädt all_products in
Abschnitten nach Basispreis.
"""

from __future__ import annotations

import gzip
import http.client
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://api.onvista.de/api/v1"
USER_AGENT = "Mozilla/5.0 (Aktientool lokal)"
PAGE = 100  # mehr Zeilen je Seite gibt der Finder nicht heraus
LIMIT = 1000  # mehr Zeilen je Abfrage auch nicht (Seiten 0 bis 9)
TR_BROKER = "8260"
# Emittenten, mit denen Trade Republic Derivate handelt (Kennung bei onvista -> Name)
TR_ISSUERS = {53882: "HSBC", 53159: "Société Générale", 53163: "UBS", 54101: "Vontobel"}
KINDS = {"WARRANT": "os", "KNOCKOUT_CERTIFICATE": "ko", "FACTOR_CERTIFICATE": "faktor"}
SUBTYPES = {"os": "WARRANT", "ko": "KNOCKOUT_CERTIFICATE"}
UNDERLYING_TYPES = ("STOCK", "INDEX")
# Sortierspalten, die der Finder kennt (je Produktart verschieden)
SORTS = {
    "os": {"leverage", "strikeAbs", "dateMaturity", "impliedVolatilityAsk", "spreadAskPct", "premiumAsk", "gearingAsk", "issuer"},
    "ko": {"gearingAsk", "knockOutAbs", "differenceKnockOutPct", "strikeAbs", "spreadAskPct", "premiumAsk", "dateMaturity", "issuer"},
}


class NotFound(Exception):
    pass


def _get(path: str, params: dict | None = None, timeout: int = 30) -> dict:
    url = f"{BASE}/{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip", "Accept": "application/json"})
    err: Exception | None = None
    # etwa jede fünfte Antwort bricht mitten im gzip-Strom ab (bei 15, 25 oder 40 KB); acht Versuche schaffen auch
    # die vielen Seiten von all_products praktisch immer
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return json.loads(body.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                raise NotFound(path) from e
            err = e
        except (OSError, ValueError, EOFError, http.client.HTTPException) as e:  # Abbruch mitten in der Antwort
            err = e
        time.sleep(0.1 * (attempt + 1))  # die Abbrüche kommen zufällig und schnell; gleich noch einmal versuchen
    raise err  # type: ignore[misc]


# ---------------------------------------------------------------- Werte aufbereiten

def _num(x) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and x == x else None


def _share(x) -> float | None:
    """Prozentzahl (5 = 5 %) als Anteil."""
    v = _num(x)
    return v / 100 if v is not None else None


def _day(s) -> str | None:
    return s[:10] if isinstance(s, str) and len(s) >= 10 else None


def _issuer(issuer: dict | None) -> tuple[str | None, int | None]:
    issuer = issuer or {}
    iid = issuer.get("id")
    return issuer.get("name"), iid if isinstance(iid, int) else None


def _quote(q: dict | None) -> dict:
    q = q or {}
    return {"bid": _num(q.get("bid")), "ask": _num(q.get("ask")), "ccy": q.get("isoCurrency"),
            "time": q.get("datetimeAsk") or q.get("datetimeBid") or q.get("datetimeLast"),
            "venue": (q.get("market") or {}).get("name")}


def _instrument(ins: dict | None) -> dict:
    ins = ins or {}
    return {"id": ins.get("entityValue"), "isin": ins.get("isin"), "wkn": ins.get("wkn"),
            "url": (ins.get("urls") or {}).get("WEBSITE")}


def _spot_from_distance(level: float | None, distance: float | None, call: bool) -> float | None:
    """Kurs des Basiswerts, mit dem onvista gerechnet hat, aus dem Abstand zu Basispreis oder Schwelle. onvista gibt
    den Abstand in Richtung Gewinn an: beim Call (Kurs − Basispreis) / Kurs, beim Put (Basispreis − Kurs) / Kurs."""
    if not level or distance is None:
        return None
    base = 1 - distance if call else 1 + distance
    return level / base if base > 0 else None


def parse_row(r: dict) -> dict:
    """Eine Zeile des Finders als Produkt (Stammdaten, Kurse, Kennzahlen)."""
    kind = KINDS.get((r.get("instrument") or {}).get("entitySubType"), "other")
    name, iid = _issuer(r.get("issuer"))
    q = _quote(r.get("quote"))
    call = r.get("codeExerciseRight") != "P"
    strike = _num(r.get("strikeAbs"))
    barrier = _num(r.get("knockOutAbs")) if kind == "ko" else None
    under = (_spot_from_distance(barrier, _share(r.get("differenceKnockOutPct")), call) if kind == "ko"
             else _spot_from_distance(strike, _share(r.get("differenceStrikePct")), call))
    return {
        **_instrument(r.get("instrument")), "name": r.get("shortName"), "issuer": name, "issuer_id": iid,
        "tr": iid in TR_ISSUERS, "kind": kind, "sub": (r.get("derivativesSubCategory") or {}).get("description"),
        "call": call, "strike": strike, "barrier": barrier, "ratio": _num(r.get("coverRatio")),
        "expiry": _day(r.get("dateMaturity")), "open_end": bool(r.get("openEnded")), "quanto": bool(r.get("quanto")),
        "under_ccy": r.get("isoCurrencyUnderlying"), "ccy": q["ccy"] or r.get("isoCurrency") or "EUR",
        "bid": q["bid"], "ask": q["ask"], "time": q["time"],
        # Hebel: beim Optionsschein Omega, beim Knock-out der einfache Hebel (Kurs × Bezugsverhältnis / Briefkurs)
        "leverage": _num(r.get("leverage") if kind == "os" else r.get("gearingAsk")),
        "gearing": _num(r.get("gearingAsk")),
        "iv": _share(r.get("impliedVolatilityAsk")), "spread": _share(r.get("spreadAskPct")),
        "premium": _share(r.get("premiumAsk")), "doc": r.get("urlProspectus"),
        # Kurs der Aktie zum Briefkurs (Währung wie Basispreis), Ausübung, Tagesveränderung, erster Handelstag
        "under_price": under, "american": r.get("codeExerciseStyle") == "A",
        "change": _share((r.get("quote") or {}).get("performancePct")), "first_day": _day(r.get("dateFirstTrading")),
    }


def parse_product(s: dict) -> dict:
    """Snapshot eines Produkts: dieselben Felder wie eine Zeile des Finders, dazu der Basiswert."""
    ins = s.get("instrument") or {}
    det = s.get("derivativesDetails") or {}
    fig = s.get("derivativesFigure") or {}
    und = (((s.get("derivativesUnderlyingList") or {}).get("list")) or [{}])[0]
    barriers = {b.get("typeBarrier"): _num(b.get("barrier")) for b in ((und.get("derivativesBarrierList") or {}).get("list") or [])}
    kind = KINDS.get(ins.get("entitySubType"), "other")
    name, iid = _issuer(s.get("derivativesIssuer"))
    q = _quote(s.get("quote"))
    under = und.get("instrument") or s.get("finderUnderlying") or {}
    strike = barriers.get("STRIKE")
    return {
        **_instrument(ins), "name": det.get("shortName") or ins.get("name"), "issuer": name, "issuer_id": iid,
        "tr": iid in TR_ISSUERS, "kind": kind, "sub": (det.get("derivativesSubCategory") or {}).get("description"),
        "call": det.get("codeExerciseRight") != "P", "strike": strike,
        "barrier": (barriers.get("KNOCK_OUT") or barriers.get("STOP_LOSS") or strike) if kind == "ko" else None,
        "ratio": _num(und.get("coverRatio")), "expiry": _day(det.get("datetimeMaturity")),
        "open_end": bool(det.get("openEnded")), "quanto": bool(det.get("quanto")),
        "under_ccy": fig.get("isoCurrencyUnderlying") or und.get("isoCurrency"), "ccy": q["ccy"] or det.get("isoCurrency") or "EUR",
        "bid": q["bid"], "ask": q["ask"], "time": q["time"], "venue": q["venue"],
        "leverage": _num(fig.get("leverageAsk") or fig.get("leverage")) if kind == "os" else _num(fig.get("gearingAsk") or fig.get("gearing")),
        "gearing": _num(fig.get("gearingAsk")),
        # Kurs der Aktie, mit dem onvista die Kennzahlen gerechnet hat (Währung wie Basispreis)
        "under_price": _num(fig.get("priceUnderlyingCalculation") or fig.get("priceUnderlying")),
        "iv": _share(fig.get("impliedVolatilityAsk")), "spread": _share(fig.get("spreadAskPct")),
        "premium": _share(fig.get("premiumAsk")), "doc": det.get("urlProspectus"),
        "american": det.get("codeExerciseStyle") == "A", "knocked_out": bool(det.get("hasBarrierBeenHit")),
        "under": {"isin": under.get("isin"), "name": und.get("shortName") or under.get("name"),
                  "type": under.get("entityType"), "id": under.get("entityValue")},
    }


# ---------------------------------------------------------------- Abfragen

def lookup(query: str) -> dict | None:
    """Wertpapier zu einer ISIN oder WKN: {type, subtype, id, name, isin}; None, wenn onvista es nicht kennt."""
    data = _get("instruments/search/facet", {"searchValue": query})
    ins = data.get("instrument")
    if not ins or not ins.get("entityValue"):
        return None
    return {"type": ins.get("entityType"), "subtype": ins.get("entitySubType"), "id": ins["entityValue"],
            "name": ins.get("name"), "isin": ins.get("isin")}


def underlying(isin: str) -> dict | None:
    """Aktie oder Index zu einer ISIN, wie onvista ihn als Basiswert führt."""
    found = lookup(isin)
    return found if found and found["type"] in UNDERLYING_TYPES else None


def product(entity_id: str) -> dict:
    return parse_product(_get(f"derivatives/{urllib.parse.quote(str(entity_id))}/snapshot"))


def _range(lo: float | None, hi: float | None) -> str:
    """Bereich für den Finder: "5;10", offen nach oben "20;", nach unten ";5". Grenzen gelten einschließlich und
    bleiben genau (ein Basispreis wie 216,3176 darf beim Laden in Abschnitten nicht gerundet werden)."""
    return ";".join("" if x is None else f"{x:.12g}" for x in (lo, hi))


def query_parameters(kind: str, call: bool, f: dict) -> str:
    """Filter des Finders als queryParameters ("entitySubType=WARRANT&idExerciseRight=2&…&").
    f: tr, issuer, strike (von, bis), leverage (von, bis), maturity (von, bis als JJJJ-MM-TT), open_end, stop_loss,
    ko_distance (von, bis als Anteil)."""
    parts = [("entitySubType", SUBTYPES[kind]), ("idExerciseRight", "2" if call else "1")]
    if f.get("tr"):
        parts.append(("brokerId", TR_BROKER))
    if f.get("issuer"):
        parts.append(("idIssuer", str(f["issuer"])))
    if f.get("strike"):
        parts.append(("strikeAbsRange", _range(*f["strike"])))
    if f.get("leverage"):
        parts.append(("leverageRange" if kind == "os" else "gearingAskRange", _range(*f["leverage"])))
    if f.get("maturity"):
        parts.append(("dateMaturityRange", f"{f['maturity'][0] or ''};{f['maturity'][1] or ''}"))
    if kind == "ko":
        if f.get("open_end") is not None:
            parts.append(("openEnded", "1" if f["open_end"] else "0"))
        if f.get("stop_loss") is not None:
            parts.append(("feature", "STOP_LOSS" if f["stop_loss"] else "STANDARD"))
        if f.get("ko_distance"):
            lo, hi = f["ko_distance"]
            parts.append(("differenceKnockOutPctRange", _range(None if lo is None else lo * 100, None if hi is None else hi * 100)))
    return "".join(f"{k}={v}&" for k, v in parts)


def products(under_type: str, under_id: str, kind: str, call: bool, filters: dict,
             sort: str | None = None, order: str = "ASC", page: int = 0, per_page: int = PAGE) -> dict:
    """Eine Seite Produkte auf den Basiswert: {total, rows}. per_page=1 genügt, um nur zu zählen."""
    params = {"application": "WEBSITE", "device": "DESKTOP", "entityTypeUnderlying": under_type,
              "entityValueUnderlying": under_id, "page": page, "perPage": max(1, min(per_page, PAGE)),
              "queryParameters": query_parameters(kind, call, filters)}
    if sort in SORTS[kind]:
        params.update(sort=sort, order="DESC" if order == "DESC" else "ASC")
    data = _get("derivatives/finder/configuration_query", params)
    return {"total": data.get("total") or 0, "rows": [parse_row(r) for r in data.get("list") or []]}


PARALLEL = 10  # gleichzeitige Abfragen beim Laden aller Produkte (ein Abschnitt zu zehn Seiten auf einmal)


def _unique(rows: list[dict]) -> list[dict]:
    seen: dict = {}
    for r in rows:
        seen.setdefault(r.get("isin") or r.get("id"), r)
    return list(seen.values())


def _median(values: list) -> float | None:
    v = sorted(x for x in values if isinstance(x, (int, float)) and x > 0)
    return v[len(v) // 2] if v else None


def all_products(under_type: str, under_id: str, kind: str, call: bool, filters: dict, cap: int = 6000) -> dict:
    """Alle Produkte auf den Basiswert, höchstens `cap`: {total, complete, spot, rows}. Bis 1.000 Produkte die Seiten
    parallel. Darüber in Abschnitten nach Basispreis, vom Kurs aus nach oben und nach unten: Jeder Abschnitt holt bis
    zu 1.000 Produkte, der nächste beginnt beim letzten Basispreis (Grenzen gelten einschließlich, doppelte fallen
    heraus). Gibt es mehr als `cap`, bleiben die mit dem Basispreis am nächsten am Kurs; complete ist dann False.
    spot: Kurs des Basiswerts in der Währung des Basispreises (aus den Abständen der ersten Zeilen)."""
    def page(f: dict, order: str, p: int) -> dict:
        return products(under_type, under_id, kind, call, f, "strikeAbs", order, p)

    def chunk(f: dict, order: str, pool: ThreadPoolExecutor) -> tuple[int, list[dict]]:
        # alle zehn Seiten auf einmal (leere hinter dem Ende kosten wenig, ein Umlauf weniger je Abschnitt)
        res = list(pool.map(lambda p: page(f, order, p), range(LIMIT // PAGE)))
        return res[0]["total"], [r for x in res for r in x["rows"]]

    def side(lo, hi, order: str, budget: int, pool) -> tuple[list[dict], tuple | None]:
        """Ein Bereich vom Kurs weg. Ergebnis: Produkte und der noch nicht geladene Rest des Bereichs (None: alles da)."""
        out: list[dict] = []
        while len(out) < budget:
            total, got = chunk({**filters, "strike": (lo, hi)}, order, pool)
            out += got
            if total <= LIMIT or not got:
                return out, None
            edge = got[-1].get("strike")
            if edge is None or edge == (lo if order == "ASC" else hi):
                return out, None  # über 1.000 Produkte mit demselben Basispreis lassen sich nicht weiter teilen
            lo, hi = (edge, hi) if order == "ASC" else (lo, edge)
        return out, (lo, hi)

    with ThreadPoolExecutor(PARALLEL) as pool:
        first = page(filters, "ASC", 0)
        total = first["total"]
        spot = _median([r.get("under_price") for r in first["rows"]])
        if total <= LIMIT:
            rest = pool.map(lambda p: page(filters, "ASC", p), range(1, math.ceil(total / PAGE)))
            rows = _unique(first["rows"] + [r for x in rest for r in x["rows"]])
            return {"total": total, "complete": True, "spot": spot, "rows": rows}
        lo, hi = filters.get("strike") or (None, None)
        if spot is None or (lo is not None and spot <= lo):
            jobs = [("ASC", lo, hi)]
        elif hi is not None and spot >= hi:
            jobs = [("DESC", lo, hi)]
        else:
            jobs = [("ASC", spot, hi), ("DESC", lo, spot)]
        with ThreadPoolExecutor(len(jobs)) as sides:
            results = list(sides.map(lambda j: side(j[1], j[2], j[0], cap // len(jobs), pool), jobs))
        rows = _unique([r for got, _ in results for r in got])
        rests = [rest for _, rest in results]
        # endet eine Seite früher, bekommt die andere den Rest des Budgets
        for i, (order, _, _) in enumerate(jobs):
            left = cap - len(rows)
            if rests[i] and left > 0:
                more, rests[i] = side(*rests[i], order, left, pool)
                rows = _unique(rows + more)
    complete = not any(rests) and len(rows) <= cap
    if len(rows) > cap and spot:
        rows.sort(key=lambda r: abs(math.log(r["strike"] / spot)) if r.get("strike") else math.inf)
        rows = rows[:cap]
    return {"total": total, "complete": complete, "spot": spot, "rows": rows}
