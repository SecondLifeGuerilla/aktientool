"""Umrechnung von Bilanzwährung in Kurswährung (inkl. Unterwährungen wie Pence bei Londoner Aktien)."""

from __future__ import annotations

import bisect

import numpy as np
import pandas as pd

from .. import config
from ..cache import cached
from . import yahoo, yahoo_screener

# Kurswährung -> (Hauptwährung, Faktor). Londoner Kurse z. B. in Pence: 1 GBP = 100 GBp.
MINOR_UNITS = {"GBp": ("GBP", 100.0), "GBX": ("GBP", 100.0), "ZAc": ("ZAR", 100.0), "ILA": ("ILS", 100.0),
               "KWF": ("KWD", 1000.0)}


def split_currency(code: str | None) -> tuple[str | None, float]:
    if code in MINOR_UNITS:
        return MINOR_UNITS[code]
    return (code.upper() if code else None), 1.0


class Converter:
    """Rechnet Beträge aus einer beliebigen Währung in die Kurswährung um, zum Kurs am jeweiligen Stichtag."""

    def __init__(self, quote_currency: str | None):
        self.major, self.factor = split_currency(quote_currency)
        self._series: dict[str, tuple[list[str], list[float]]] = {}
        self.used_pairs: set[str] = set()

    def _rates(self, frm: str) -> tuple[list[str], list[float]]:
        if frm not in self._series:
            pair = f"{frm}{self.major}=X"
            rows = cached(f"fx_{pair}", config.TTL_FX, lambda: yahoo.fx_history(pair))
            self._series[frm] = ([r[0] for r in rows], [r[1] for r in rows])
            if rows:
                self.used_pairs.add(pair)
        return self._series[frm]

    def rate(self, frm: str | None, day: str | None = None) -> float | None:
        """Faktor, mit dem ein Betrag in `frm` multipliziert wird, um in Kurswährung zu landen."""
        frm_major, frm_factor = split_currency(frm)
        if frm_major is None or self.major is None or frm_major == self.major:
            return self.factor / frm_factor
        days, rates = self._rates(frm_major)
        if not rates:
            return None
        i = len(rates) - 1 if day is None else max(0, bisect.bisect_right(days, day) - 1)
        return rates[i] * self.factor / frm_factor

    def convert(self, value: float | None, frm: str | None, day: str | None = None) -> float | None:
        if value is None:
            return None
        r = self.rate(frm, day)
        return None if r is None else value * r


# ---------------------------------------------------------------- Euro: alle Anzeigen in der Oberfläche
# Abgefragt wird EURxxx=X (z. B. 1 EUR = 1,1197 USD) und umgedreht: xxxEUR=X hat bei schwachen Währungen nur zwei,
# drei gültige Stellen (ARSEUR=X 0,00053).
TTL_EUR_NOW = 15 * 60


def eur_quotes(currencies: list[str | None]) -> dict[str, dict]:
    """Aktueller Euro-Kurs je Währung: {"USD": {"rate": 0.8931, "change": 0.0022}}. `rate` = Euro je Einheit
    (bei Pence & Co. je Unterwährung), `change` = Veränderung dieses Kurses seit dem Vortag."""
    majors = sorted({split_currency(c)[0] for c in currencies if c} - {"EUR", None})

    def load() -> dict:
        out = {}
        wanted = {f"EUR{m}=X": m for m in majors}
        for q in yahoo_screener.quotes(list(wanted)):
            price = q.get("regularMarketPrice")
            if q.get("symbol") in wanted and price:
                change = (q.get("regularMarketChangePercent") or 0) / 100
                out[wanted[q["symbol"]]] = {"rate": 1 / price, "change": 1 / (1 + change) - 1}
        return out

    rates = {"EUR": {"rate": 1.0, "change": 0.0}, **(cached(f"eurkurs_{'_'.join(majors)}", TTL_EUR_NOW, load) if majors else {})}
    result = {}
    for c in currencies:
        major, factor = split_currency(c)
        if major in rates:
            result[c] = {"rate": rates[major]["rate"] / factor, "change": rates[major]["change"]}
    return result


def eur_history(currency: str | None) -> list[list]:
    """Tägliche Euro-Kurse [[Tag, Euro je Einheit der Hauptwährung]], ab etwa 2003 (vorher gibt es bei Yahoo keine)."""
    major = split_currency(currency)[0]
    if not major or major == "EUR":
        return []
    rows = cached(f"fx_tag_EUR{major}", config.TTL_FX, lambda: yahoo.fx_history(f"EUR{major}=X", interval="1d"))
    return [[d, 1 / r] for d, r in rows if r > 0]


class ToEur:
    """Rechnet Beträge einer Währung in Euro um: `now` zum aktuellen Kurs, `at(tage)` zum Kurs des jeweiligen Tages.
    Vor Beginn der Historie gilt der erste bekannte Kurs, ohne Historie der aktuelle."""

    def __init__(self, currency: str | None, now: dict | None = None):
        self.currency = currency
        self.major, self.factor = split_currency(currency)
        info = now if now is not None else eur_quotes([currency]).get(currency)
        self.now: float | None = info["rate"] if info else None
        self.change: float = info["change"] if info else 0.0
        self._hist: pd.Series | None = None

    @property
    def is_euro(self) -> bool:
        return self.major == "EUR" and self.factor == 1.0

    def history(self) -> pd.Series:
        if self._hist is None:
            rows = eur_history(self.currency)
            s = pd.Series([r for _, r in rows], index=pd.to_datetime([d for d, _ in rows]), dtype=float) / self.factor
            self._hist = s[~s.index.duplicated(keep="last")].sort_index()
        return self._hist

    def at(self, days) -> np.ndarray:
        """Euro-Kurse für die aufsteigend sortierten Tage `days`. Ab dem letzten Tag der Historie und für den letzten
        Tag der Reihe gilt der aktuelle Kurs, damit der letzte Punkt im Diagramm zum angezeigten Kurs passt."""
        idx = pd.to_datetime(pd.Index(days))
        hist = self.history()
        if self.is_euro or hist.empty:
            return np.full(len(idx), self.now if self.now is not None else np.nan)
        rates = hist.reindex(hist.index.union(idx)).ffill().bfill().reindex(idx).to_numpy(copy=True)
        if self.now is not None and len(idx):
            rates[idx >= hist.index[-1]] = self.now
            rates[-1] = self.now
        return rates

    @property
    def historical(self) -> bool:
        return not self.is_euro and not self.history().empty
