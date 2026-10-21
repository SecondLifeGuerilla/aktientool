"""Umrechnung von Bilanzwährung in Kurswährung (inkl. Unterwährungen wie Pence bei Londoner Aktien)."""

from __future__ import annotations

import bisect

from .. import config
from ..cache import cached
from . import yahoo

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
