"""Weltauswahl: die größten Aktien aller wichtigen Börsen mit Land, Kontinent, Branche und Kennzahlen.

Die Auswahl ist nicht fest hinterlegt. Sie wird über den Yahoo-Screener live geladen (ein Lauf dauert rund
20 Sekunden), im Hintergrund aufgebaut und einen Tag lang im Cache gehalten.

Jede Firma erscheint nur einmal. Yahoo führt alle Notierungen einer Firma (Heimatbörse, Zweitnotierungen,
ADRs, BDRs, CDRs) unter derselben Kennung; daraus wird die Heimatnotierung gewählt. Das Land ist das Sitzland
laut ISIN, bei Offshore-Sitzen (Kaimaninseln, Bermuda …) das Land der Heimatbörse.
"""

from __future__ import annotations

import bisect
import datetime as dt
import gzip
import json
import logging
import math
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, NamedTuple

from . import config, deep, snapshots
from .cache import cache_mtime, peek, store
from .names import CONTINENTS, COUNTRIES, SECTORS, industry_de
from .sources import fx, yahoo_screener

log = logging.getLogger(__name__)

CACHE_KEY = "welt"


class Market(NamedTuple):
    exchanges: list[str]  # Yahoo-Börsenkürzel
    currency: str
    suffixes: list[str] | None  # Ticker-Endungen der Heimatbörse; None = keine Reparatur versuchen


MARKETS: dict[str, Market] = {
    "US": Market(["NMS", "NYQ", "NGM", "NCM", "ASE", "BTS", "PCX"], "USD", None),
    "CA": Market(["TOR"], "CAD", [".TO"]),
    "MX": Market(["MEX"], "MXN", [".MX"]),
    "BR": Market(["SAO"], "BRL", [".SA"]),
    "AR": Market(["BUE"], "ARS", [".BA"]),
    "CL": Market(["SGO"], "CLP", [".SN"]),
    "CO": Market(["BVC"], "COP", [".CL"]),
    "GB": Market(["LSE"], "GBP", [".L"]),
    "IE": Market(["ISE"], "EUR", [".IR"]),
    "DE": Market(["GER"], "EUR", [".DE"]),
    "FR": Market(["PAR"], "EUR", [".PA"]),
    "NL": Market(["AMS"], "EUR", [".AS"]),
    "BE": Market(["BRU"], "EUR", [".BR"]),
    "CH": Market(["EBS"], "CHF", [".SW"]),
    "AT": Market(["VIE"], "EUR", [".VI"]),
    "IT": Market(["MIL"], "EUR", [".MI"]),
    "ES": Market(["MCE"], "EUR", [".MC"]),
    "PT": Market(["LIS"], "EUR", [".LS"]),
    "DK": Market(["CPH"], "DKK", [".CO"]),
    "SE": Market(["STO"], "SEK", [".ST"]),
    "NO": Market(["OSL"], "NOK", [".OL"]),
    "FI": Market(["HEL"], "EUR", [".HE"]),
    "PL": Market(["WSE"], "PLN", [".WA"]),
    "CZ": Market(["PRA"], "CZK", [".PR"]),
    "HU": Market(["BUD"], "HUF", [".BD"]),
    "GR": Market(["ATH"], "EUR", [".AT"]),
    "TR": Market(["IST"], "TRY", [".IS"]),
    "RO": Market(["BVB"], "RON", [".RO"]),
    "IL": Market(["TLV"], "ILS", [".TA"]),
    "SA": Market(["SAU"], "SAR", [".SR"]),
    "AE": Market(["DFM"], "AED", [".AE"]),
    "QA": Market(["DOH"], "QAR", [".QA"]),
    "KW": Market(["KUW"], "KWD", [".KW"]),
    "ZA": Market(["JNB"], "ZAR", [".JO"]),
    "IN": Market(["NSI", "BSE"], "INR", [".NS"]),
    "CN": Market(["SHH", "SHZ"], "CNY", None),  # H-Aktien in Hongkong sind eigenständige Notierungen
    "HK": Market(["HKG"], "HKD", [".HK"]),
    "TW": Market(["TAI", "TWO"], "TWD", [".TW", ".TWO"]),
    "KR": Market(["KSC", "KOE"], "KRW", [".KS", ".KQ"]),
    "JP": Market(["JPX"], "JPY", [".T"]),
    "SG": Market(["SES"], "SGD", [".SI"]),
    "MY": Market(["KLS"], "MYR", [".KL"]),
    "TH": Market(["SET"], "THB", [".BK"]),
    "ID": Market(["JKT"], "IDR", [".JK"]),
    "VN": Market(["VSE"], "VND", [".VN"]),
    "AU": Market(["ASX"], "AUD", [".AX"]),
    "NZ": Market(["NZE"], "NZD", [".NZ"]),
}

# Sitzländer, die fast nur aus steuerlichen Gründen gewählt werden: dann zählt das Land der Heimatbörse
OFFSHORE = {"KY", "BM", "VG", "JE", "GG", "IM", "MH", "PA", "LR", "BS", "CW", "AN", "GI", "BB", "MU"}
# Bilanzwährungen, die eindeutig auf ein Land schließen lassen (für ADRs ohne Heimatnotierung, z. B. Kaspi)
CURRENCY_HOME = {"CNY": "CN", "JPY": "JP", "KRW": "KR", "TWD": "TW", "INR": "IN", "BRL": "BR", "MXN": "MX",
                 "ZAR": "ZA", "IDR": "ID", "ARS": "AR", "CLP": "CL", "COP": "CO", "PEN": "PE", "TRY": "TR",
                 "KZT": "KZ", "PHP": "PH", "VND": "VN", "THB": "TH", "MYR": "MY", "ILS": "IL", "HKD": "HK",
                 "GBP": "GB", "CHF": "CH", "SEK": "SE", "NOK": "NO", "DKK": "DK", "PLN": "PL", "HUF": "HU",
                 "CZK": "CZ", "CAD": "CA", "AUD": "AU", "NZD": "NZ", "SAR": "SA", "AED": "AE", "EGP": "EG", "NGN": "NG"}
# Zertifikate (CDR, BDR, Thai-DR …) haben eine ISIN des Handelslandes; echte Heimatnotierungen werden nennenswert gehandelt
MIN_HOME_TRADING_SHARE = 0.05
# Vorzugsaktien mit fester Dividende (BAC-PB, CSE-PA.TO, VOLO-PREF.ST) und Thai-NVDRs (GULF-R.BK) sind keine Stammaktien
PREFERRED = re.compile(r"-(P[A-Z]{0,2}(-[A-Z])?|PREF)(\.[A-Z]+)?$")
NVDR = re.compile(r"-R\.BK$")


# ---------------------------------------------------------------- Heimatnotierung und Land

def _isin_country(listing: dict) -> str:
    return (listing.get("isin") or "")[:2].upper()


def is_home_like(listing: dict, max_traded: float) -> bool:
    cc, market = _isin_country(listing), listing["market"]
    local = cc == market or (cc in OFFSHORE and market != "US") or (cc == "PR" and market == "US")
    return (local and not NVDR.search(listing["symbol"])
            and listing["traded_usd"] >= MIN_HOME_TRADING_SHARE * max_traded)


def pick_home(group: list[dict]) -> dict:
    """Wählt aus allen Notierungen einer Firma die Heimatnotierung."""
    max_traded = max(l["traded_usd"] for l in group)
    homes = [l for l in group if is_home_like(l, max_traded)]
    foreign_home = any(l["market"] != "US" for l in homes)

    def us_adr(l: dict) -> bool:
        # US-Zertifikat auf eine ausländische Aktie: US-ISIN, aber Bilanz in Fremdwährung oder Heimatbörse im Ausland
        return (l["market"] == "US" and _isin_country(l) == "US"
                and (l.get("fin_ccy") not in (None, "USD") or foreign_home))

    candidates = [l for l in homes if not us_adr(l)]
    return max(candidates or group, key=lambda l: l["traded_usd"])


def country_of(listing: dict) -> str:
    cc, market, fin = _isin_country(listing), listing["market"], listing.get("fin_ccy")
    if fin == "CNY" and market in ("HK", "US"):
        return "CN"  # in Hongkong oder den USA notierte Festlandfirmen (Tencent, Alibaba, PDD …)
    if not cc or cc in OFFSHORE or cc == market:
        return CURRENCY_HOME.get(fin, market) if market == "US" else market
    if cc == "PR":
        return "US"
    return cc if cc in COUNTRIES else market


def is_foreign_receipt(listing: dict) -> bool:
    """GDR/ADR, das nur außerhalb der USA gehandelt wird (z. B. Reliance in Wien); die Aktie selbst fehlt dann."""
    return listing["market"] != "US" and _isin_country(listing) == "US" and listing.get("fin_ccy") not in (None, "USD")


# ---------------------------------------------------------------- Datensätze

def _value(fund: dict, key: str) -> float | None:
    v = fund.get(key)
    if isinstance(v, dict):  # {"lasttwelvemonths": x, "quarterly": y, ...}
        v = next((x for x in v.values() if x is not None), None)
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _pct(x: float | None) -> float | None:
    return None if x is None else x / 100


def _positive(*values: float | None, floor: float = 0.0) -> float | None:
    """Erster Wert > floor. Bewertungskennzahlen sind bei Verlusten oder negativem Eigenkapital nicht sinnvoll,
    ein KGV unter 1 ist praktisch immer ein Datenfehler (z. B. Kurs in Pence, Gewinn in Pfund)."""
    return next((v for v in values if v is not None and v > floor), None)


def _round(x, digits: int = 4):
    if not isinstance(x, float) or x == 0 or not math.isfinite(x):
        return x
    return round(x, digits - 1 - math.floor(math.log10(abs(x))))


def make_listing(quote: dict, market: str, rates: dict[str, float]) -> dict | None:
    if quote.get("quoteType", "EQUITY") != "EQUITY" or PREFERRED.search(quote["symbol"]):
        return None
    if "%" in (quote.get("longName") or quote.get("shortName") or ""):
        return None  # Anleihen, die Yahoo als Aktie führt („3.1% NTS 17/02/27“)
    major, factor = fx.split_currency(quote.get("currency"))
    rate = rates.get(major)
    if rate is None:
        return None
    fund = quote.get("fundamentals") or {}
    cap = quote.get("marketCap")  # Yahoo gibt den Börsenwert in der Hauptwährung an (Pfund, nicht Pence)
    if not cap:
        cap = (_value(fund, "intradaymarketcap") or 0) / factor
    price = quote.get("regularMarketPrice") or 0
    return {
        "symbol": quote["symbol"], "market": market, "isin": (fund.get("isin") or "").upper(),
        "company": quote.get("messageBoardId") or fund.get("isin") or quote["symbol"],
        "fin_ccy": quote.get("financialCurrency"),
        "cap_usd": cap * rate if cap else None,
        "traded_usd": (quote.get("averageDailyVolume3Month") or 0) * price / factor * rate,
        "quote": quote, "fund": fund,
    }


# Plausible Bereiche der Yahoo-Kennzahlen. Werte außerhalb sind Basiseffekte (Gewinnwachstum +1.432 % nach einem
# Gewinneinbruch) oder Datenfehler (Bruttomarge −176.000 %, Beta 95). Sie werden auf die Grenze gekappt: Die Richtung
# bleibt für Scores und Filter erhalten, die Tabelle zeigt „≥ 300 %“ statt einer Scheingenauigkeit.
LIMITS = {
    "revenue_growth": (-1.0, 3.0), "eps_growth": (-1.0, 3.0), "eps_growth_next": (-1.0, 3.0),
    "roe": (-2.0, 2.0), "roa": (-0.5, 0.5), "roc": (-1.0, 1.0),
    "gross_margin": (-1.0, 1.0), "ebitda_margin": (-1.0, 1.0), "net_margin": (-1.0, 1.0),
    "payout": (0.0, 3.0), "debt_equity": (0.0, 10.0), "net_debt_ebitda": (-10.0, 20.0),
    "altman_z": (-10.0, 50.0), "beta": (-2.0, 5.0), "perf_1y": (-1.0, 10.0), "momentum": (-1.0, 5.0),
}


def apply_limits(row: dict) -> None:
    """Kappt Kennzahlen auf LIMITS; die betroffenen Schlüssel stehen in row["capped"]."""
    capped = []
    for key, (lo, hi) in LIMITS.items():
        v = row.get(key)
        if v is not None and not lo <= v <= hi:
            row[key] = min(hi, max(lo, v))
            capped.append(key)
    if capped:
        row["capped"] = capped


def make_row(listing: dict, country: str, eur_usd: float) -> dict:
    q, f = listing["quote"], listing["fund"]
    pe = _positive(_value(f, "peratio"), q.get("trailingPE"), floor=1)
    ps = _positive(_value(f, "lastclosemarketcaptotalrevenue"))
    cap = listing["cap_usd"] / eur_usd if listing["cap_usd"] else None
    div_yield = _pct(q.get("dividendYield") if q.get("dividendYield") is not None else _value(f, "forward_dividend_yield"))
    eps, eps_next = q.get("epsTrailingTwelveMonths"), q.get("epsForward")
    rating = q.get("averageAnalystRating")  # z. B. "1.7 - Buy"
    try:
        rating = float(rating.split(" ")[0]) if rating else None
    except ValueError:
        rating = None
    years = _value(f, "consecutive_years_of_dividend_growth_count")
    row = {
        "symbol": listing["symbol"],
        "name": (q.get("longName") or q.get("shortName") or listing["symbol"]).strip(),
        "isin": listing["isin"] or None,
        "country": country,
        "exchange": q.get("fullExchangeName"),
        "currency": q.get("currency"),
        "price": q.get("regularMarketPrice"),
        "sector": SECTORS.get(f.get("sector"), f.get("sector")),
        "industry": industry_de(f.get("industry")),
        "market_cap": cap,
        "revenue": cap / ps if cap and ps else None,
        "pe": pe,
        "forward_pe": _positive(q.get("forwardPE"), floor=1),
        "pb": _positive(_value(f, "pricebookratio"), q.get("priceToBook")),
        "ps": ps,
        "ev_ebitda": _positive(_value(f, "lastclosetevebitda")),
        "peg": _positive(_value(f, "pegratio_5y")),
        "div_yield": div_yield,
        "div_years": int(years) if years is not None else None,
        # Dividende / Gewinn = Rendite × KGV, so unabhängig von Kurs- und Bilanzwährung
        "payout": div_yield * pe if div_yield is not None and pe else (0.0 if div_yield == 0 else None),
        "roe": _pct(_value(f, "returnonequity")),
        "roa": _pct(_value(f, "returnonassets")),
        "gross_margin": _pct(_value(f, "grossprofitmargin")),
        "ebitda_margin": _pct(_value(f, "ebitdamargin")),
        "net_margin": _pct(_value(f, "netincomemargin")),
        "revenue_growth": _pct(_value(f, "totalrevenues1yrgrowth")),
        "eps_growth": _pct(_value(f, "epsgrowth")),
        "eps_growth_next": eps_next / eps - 1 if eps and eps > 0 and eps_next is not None else None,
        "debt_equity": _pct(_value(f, "totaldebtequity")),
        "net_debt_ebitda": _value(f, "netdebtebitda"),
        "beta": _value(f, "beta"),
        "ev_ebit": _positive(_value(f, "lastclosetevebit")),
        "roc": _pct(_value(f, "returnontotalcapital")),
        "altman_z": _value(f, "altmanzscoreusingtheaveragestockinformationforaperiod"),
        "perf_1y": _pct(q.get("fiftyTwoWeekChangePercent")),
        "momentum": q.get("twoHundredDayAverageChangePercent"),
        "from_high": q.get("fiftyTwoWeekHighChangePercent"),
        "rating": rating,
    }
    # Bei negativem EBITDA kehrt sich das Vorzeichen um: Nettoschulden/EBITDA sähe dann wie ein Nettoguthaben aus.
    # Ein negativer Verschuldungsgrad heißt negatives Eigenkapital und wäre sonst „am wenigsten verschuldet“
    if row["ebitda_margin"] is not None and row["ebitda_margin"] <= 0:
        row["net_debt_ebitda"] = None
    if row["debt_equity"] is not None and row["debt_equity"] < 0:
        row["debt_equity"] = None
    apply_limits(row)
    # Fehlende Werte weglassen und runden: hält die Antwort bei Tausenden Aktien klein
    return {k: _round(v, 6 if k == "price" else 4) for k, v in row.items() if v is not None}


# ---------------------------------------------------------------- Scores

# Teil-Scores aus Kennzahlen; Richtung -1 heißt „niedriger ist besser“
FACTORS = {
    "score_quality": [("roe", 1), ("roa", 1), ("net_margin", 1), ("ebitda_margin", 1), ("net_debt_ebitda", -1)],
    "score_value": [("pe", -1), ("forward_pe", -1), ("pb", -1), ("ps", -1), ("ev_ebitda", -1)],
    "score_growth": [("revenue_growth", 1), ("eps_growth", 1), ("eps_growth_next", 1)],
    "score_dividend": [("div_yield", 1), ("div_years", 1), ("payout", -1)],
    "score_momentum": [("perf_1y", 1), ("momentum", 1), ("from_high", 1)],
}
TOTAL_PARTS = ["score_quality", "score_value", "score_growth", "score_momentum"]
MIN_PEERS = 20  # Sektoren mit weniger Vergleichswerten werden mit allen Aktien verglichen
MAGIC_EXCLUDED = {"Finanzen", "Versorger"}  # wie bei Greenblatt


def percentile_ranks(values: list[float | None]) -> list[float | None]:
    """Anteil der übrigen Werte, die kleiner sind: 0 = kleinster, 1 = größter Wert, Gleichstände gemittelt."""
    present = sorted(v for v in values if v is not None)
    n = len(present)
    out = []
    for v in values:
        if v is None:
            out.append(None)
        elif n < 2:
            out.append(0.5)
        else:
            lo, hi = bisect.bisect_left(present, v), bisect.bisect_right(present, v)
            out.append((lo + hi - 1) / 2 / (n - 1))
    return out


def _sector_ranks(rows: list[dict], values: list[float | None]) -> list[float | None]:
    overall = percentile_ranks(values)
    groups: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        if values[i] is not None and r.get("sector"):
            groups[r["sector"]].append(i)
    result = list(overall)
    for idx in groups.values():
        if len(idx) >= MIN_PEERS:
            for i, p in zip(idx, percentile_ranks([values[i] for i in idx])):
                result[i] = p
    return result


def add_scores(rows: list[dict]) -> None:
    """Scores 0–100 je Aktie. Teil-Scores vergleichen innerhalb des Sektors (Banken mit Banken), damit z. B.
    das niedrige KGV von Banken nicht automatisch als günstig gilt. 80 = besser als 80 % der Vergleichsaktien."""
    for name, parts in FACTORS.items():
        eligible = [name != "score_dividend" or (r.get("div_yield") or 0) > 0 for r in rows]
        ranks = [_sector_ranks(rows, [r[key] * direction if ok and r.get(key) is not None else None
                                      for r, ok in zip(rows, eligible)])
                 for key, direction in parts]
        need = (len(parts) + 1) // 2  # mindestens die Hälfte der Kennzahlen muss vorliegen
        raw = []
        for i in range(len(rows)):
            got = [m[i] for m in ranks if m[i] is not None]
            raw.append(sum(got) / len(got) if len(got) >= need else None)
        for r, p in zip(rows, _sector_ranks(rows, raw)):
            if p is not None:
                r[name] = round(100 * p)
    totals = []
    for r in rows:
        got = [r[k] for k in TOTAL_PARTS if k in r]
        totals.append(sum(got) / len(got) if len(got) >= 3 else None)
    for r, p in zip(rows, percentile_ranks(totals)):
        if p is not None:
            r["score_total"] = round(100 * p)
    # Magic Formula (Greenblatt): Gewinnrendite EBIT/EV plus Kapitalrendite, über alle Aktien
    ok = [r.get("ev_ebit") and r.get("roc") is not None and r.get("sector") not in MAGIC_EXCLUDED for r in rows]
    yields = percentile_ranks([1 / r["ev_ebit"] if o else None for r, o in zip(rows, ok)])
    returns = percentile_ranks([r["roc"] if o else None for r, o in zip(rows, ok)])
    combined = [(a + b) / 2 if a is not None and b is not None else None for a, b in zip(yields, returns)]
    for r, p in zip(rows, percentile_ranks(combined)):
        if p is not None:
            r["magic_formula"] = round(100 * p)


# ---------------------------------------------------------------- Themen

def load_themes() -> dict:
    return json.loads(config.THEMES_FILE.read_text("utf-8")).get("themes", {})


def theme_matcher(themes: dict) -> Callable[[dict], list[str]]:
    """Ordnet eine Aktie Themen zu: über Ticker/ISIN, Branche oder ein Muster im Firmennamen."""
    rules = [(name, {s.upper() for s in t.get("aktien", [])}, set(t.get("branchen", [])),
              [re.compile(p, re.IGNORECASE) for p in t.get("namen", [])]) for name, t in themes.items()]

    def match(row: dict) -> list[str]:
        ids = {row["symbol"].upper(), (row.get("isin") or "").upper()}
        return [name for name, keys, industries, patterns in rules
                if ids & keys or row.get("industry") in industries or any(p.search(row.get("name", "")) for p in patterns)]

    return match


# ---------------------------------------------------------------- Aufbau

def group_listings(listings: list[dict]) -> list[list[dict]]:
    """Fasst Notierungen derselben Firma zusammen: gleiche Yahoo-Kennung oder gleiche ISIN.

    Die ISIN wird gebraucht, weil Yahoo z. B. NSE- und BSE-Notierungen indischer Aktien getrennt führt.
    """
    parent: dict[tuple, tuple] = {}

    def find(x: tuple) -> tuple:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for l in listings:
        if l["isin"]:
            parent[find(("isin", l["isin"]))] = find(("company", l["company"]))
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for l in listings:
        groups[find(("company", l["company"]))].append(l)
    return list(groups.values())


def _norm_name(q: dict) -> str:
    return "".join(ch for ch in (q.get("longName") or q.get("shortName") or "").lower() if ch.isalnum())


def _repair(chosen: list[dict], groups: list[list[dict]], rates: dict[str, float]) -> None:
    """Fehlt die Heimatnotierung im Screener (z. B. ALV.DE), den passenden Ticker direkt abfragen."""
    wanted: dict[str, int] = {}
    for i, listing in enumerate(chosen):
        market = MARKETS.get(_isin_country(listing))
        if not market or not market.suffixes or listing["symbol"].endswith(tuple(market.suffixes)):
            continue
        roots = dict.fromkeys(l["symbol"].split(".")[0] for l in sorted(groups[i], key=lambda l: -l["traded_usd"]))
        # Auslandsbörsen hängen oft eine Ziffer an (FRE2.VI für FRE.DE)
        roots = dict.fromkeys(r for root in list(roots)[:4] for r in (root, root.rstrip("0123456789")) if r)
        for root in roots:
            for suffix in market.suffixes:
                wanted.setdefault(root + suffix, i)
    if not wanted:
        return
    for q in yahoo_screener.quotes(sorted(wanted)):
        i = wanted.get(q.get("symbol"))
        if i is None:
            continue
        old = chosen[i]
        if old["symbol"].endswith(tuple(MARKETS[_isin_country(old)].suffixes)):
            continue  # schon repariert
        same = q.get("messageBoardId") in {l["company"] for l in groups[i]} or _norm_name(q) == _norm_name(old["quote"])
        if not same:
            continue
        new = make_listing({**q, "fundamentals": old["fund"]}, _isin_country(old), rates)
        if new:
            new["isin"] = old["isin"]
            if not q.get("marketCap"):  # Börsenwert aus den Kennzahlen gilt für die andere Börse und Währung
                new["cap_usd"] = old["cap_usd"]
            chosen[i] = new


def build(min_cap_eur: float, progress: Callable[[int, int], None] = lambda done, total: None) -> dict:
    total = len(MARKETS) + 2
    rates = yahoo_screener.usd_rates(sorted({m.currency for m in MARKETS.values()} | {"EUR"}))
    if "EUR" not in rates:
        raise RuntimeError("Wechselkurse von Yahoo Finance nicht verfügbar.")
    eur_usd = rates["EUR"]
    min_usd = min_cap_eur * eur_usd
    progress(1, total)

    def load(code: str) -> list[dict]:
        m = MARKETS[code]
        if m.currency not in rates:
            raise RuntimeError(f"kein Wechselkurs für {m.currency}")
        # etwas Puffer, weil Yahoo den Börsenwert untertägig rechnet; genau gefiltert wird danach in Euro
        return yahoo_screener.listings(m.exchanges, 0.8 * min_usd / rates[m.currency])

    listings, warnings, done = [], [], 1
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(load, code): code for code in MARKETS}
        for fut in as_completed(futures):
            code = futures[fut]
            try:
                for quote in fut.result():
                    listing = make_listing(quote, code, rates)
                    if listing:
                        listings.append(listing)
            except Exception as e:  # ein Markt fehlt, der Rest ist trotzdem nützlich
                log.warning("Weltauswahl: %s nicht geladen: %s", code, e)
                warnings.append(f"{COUNTRIES[code][0]} konnte nicht geladen werden ({type(e).__name__}).")
            done += 1
            progress(done, total)
    if not listings:
        raise RuntimeError("Yahoo Finance hat keine Daten geliefert.")

    groups = group_listings(listings)
    chosen = [pick_home(group) for group in groups]
    try:
        _repair(chosen, groups, rates)
    except Exception as e:
        log.warning("Weltauswahl: Heimatnotierungen nicht nachgeladen: %s", e)
    progress(total, total)

    stocks = []
    for listing in chosen:
        if is_foreign_receipt(listing) or not listing["cap_usd"] or listing["cap_usd"] < min_usd:
            continue
        stocks.append(make_row(listing, country_of(listing), eur_usd))
    stocks.sort(key=lambda r: -r.get("market_cap", 0))
    add_scores(stocks)
    used = sorted({r["country"] for r in stocks})
    return {
        "built_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "min_cap_eur": min_cap_eur,
        "eur_usd": eur_usd,
        "count": len(stocks),
        "listings": len(listings),
        "countries": {cc: {"name": COUNTRIES.get(cc, (cc, ""))[0], "continent": COUNTRIES.get(cc, ("", "Sonstige"))[1]}
                      for cc in used},
        "continents": CONTINENTS,
        "sectors": sorted({r["sector"] for r in stocks if r.get("sector")}),
        "warnings": warnings,
        "stocks": stocks,
    }


# ---------------------------------------------------------------- Hintergrund-Aufbau und Auslieferung

_lock = threading.Lock()
_state = {"running": False, "done": 0, "total": len(MARKETS) + 2, "error": None, "finished": None}
_payload: dict = {}  # fertig serialisierte Antwort (roh und gzip), wird nach jedem Aufbau verworfen


def _progress(done: int, total: int) -> None:
    with _lock:
        _state.update(done=done, total=total)


def _run() -> None:
    try:
        data = build(config.WORLD_MIN_CAP_EUR, _progress)
        store(CACHE_KEY, data)
        with _lock:
            _payload.clear()
    except Exception as e:
        log.exception("Weltauswahl konnte nicht geladen werden")
        msg = ("Yahoo Finance begrenzt gerade die Anfragen. Bitte in ein paar Minuten erneut versuchen."
               if "RateLimit" in type(e).__name__ else f"Laden fehlgeschlagen: {e}")
        with _lock:
            _state["error"] = msg
    finally:
        with _lock:
            _state.update(running=False, finished=time.time())


def start() -> bool:
    """Startet den Aufbau im Hintergrund; False, wenn er schon läuft."""
    with _lock:
        if _state["running"]:
            return False
        _state.update(running=True, done=0, error=None)
    threading.Thread(target=_run, name="weltauswahl", daemon=True).start()
    return True


def status(auto_refresh: bool = True) -> dict:
    """Stand der Daten. Veraltete Daten werden im Hintergrund erneuert (nicht öfter als alle 10 Minuten nach Fehlern)."""
    mtime = cache_mtime(CACHE_KEY)
    age = time.time() - mtime if mtime is not None else None
    with _lock:
        st = dict(_state)
    stale = age is None or age > config.TTL_WORLD
    recently_failed = st["error"] and st["finished"] and time.time() - st["finished"] < 600
    if auto_refresh and stale and not st["running"] and not recently_failed:
        start()
        with _lock:
            st = dict(_state)
    # version ändert sich mit jedem neuen Datenstand, geänderten Themen oder neuen Ergebnissen der Tiefenanalyse;
    # die Oberfläche lädt nur dann neu
    version = f"{int(mtime)}-{int(_themes_mtime())}-{int(deep.mtime())}" if mtime else None
    universe = None
    if mtime is not None:
        with _lock:
            p = _prepared()
            universe = p["universe"] if p else None
        if universe and config.DEEP_AUTO:
            deep.start(universe)  # läuft schon oder ist pausiert: tut nichts
    return {"ready": mtime is not None, "version": version, "age_seconds": age,
            "running": st["running"], "done": st["done"], "total": st["total"], "error": st["error"],
            "deep": deep.status(len(universe) if universe else None)}


def deep_start() -> bool:
    with _lock:
        p = _prepared()
    return bool(p) and deep.start(p["universe"], manual=True)


def _themes_mtime() -> float:
    try:
        return config.THEMES_FILE.stat().st_mtime
    except FileNotFoundError:
        return 0.0


def _prepared() -> dict | None:
    """Daten aus dem Cache, ergänzt um die Themen. themes.json wird bei jeder Änderung neu angewendet,
    ohne die Börsen neu zu laden. Aufruf nur unter _lock."""
    key = (cache_mtime(CACHE_KEY), _themes_mtime(), deep.mtime())
    if _payload.get("key") == key:
        return _payload
    data = peek(CACHE_KEY)
    if data is None:
        return None
    deep_rows = deep.rows()
    for r in data["stocks"]:
        deep.merge_into(r, deep_rows.get(r["symbol"]))
    try:
        snapshots.save(data["stocks"])  # ein Tagesstand pro Tag (für die Auswertung der Scores)
    except OSError as e:
        log.warning("Tagesstand nicht gespeichert: %s", e)
    try:
        themes = load_themes()
    except (OSError, ValueError, re.error) as e:  # kaputte themes.json soll die Weltauswahl nicht verhindern
        log.warning("themes.json nicht lesbar: %s", e)
        themes = {}
        data["warnings"] = [*data.get("warnings", []), f"themes.json ist fehlerhaft und wurde ignoriert ({e})."]
    match = theme_matcher(themes)
    for r in data["stocks"]:
        found = match(r)
        if found:
            r["themes"] = found
    data["themes"] = {name: {"short": t.get("kurz") or name, "description": t.get("beschreibung", "")}
                      for name, t in themes.items()}
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    _payload.clear()
    _payload.update(key=key, raw=raw, gz=gzip.compress(raw, 6), countries=data["countries"],
                    by_symbol={r["symbol"]: r for r in data["stocks"]}, count=len(data["stocks"]),
                    # Reihenfolge der Tiefenanalyse: größte Firmen zuerst
                    universe=[{"symbol": r["symbol"], "isin": r.get("isin")} for r in data["stocks"]])
    return _payload


def payload(compressed: bool) -> bytes | None:
    with _lock:
        p = _prepared()
        return p["gz" if compressed else "raw"] if p else None


def stock(symbol: str) -> dict | None:
    """Eine Aktie aus der Weltauswahl mit Land, Kontinent, Scores und Themen (für das Profil)."""
    with _lock:
        p = _prepared()
        row = p["by_symbol"].get(symbol) if p else None
        if not row:
            return None
        country = p["countries"].get(row["country"], {})
        return {**row, "country_name": country.get("name"), "continent": country.get("continent"), "universe": p["count"]}
