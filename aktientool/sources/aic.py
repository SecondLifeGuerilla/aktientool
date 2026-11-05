"""Britische Investment Trusts laut AIC (Association of Investment Companies, Daten von Morningstar).

Die Vergleichsseite der AIC enthält den kompletten Datensatz als JSON in den Drupal-Einstellungen: NAV, Abschlag,
durchschnittlicher Abschlag über 1, 3 und 5 Jahre, höchster und niedrigster Abschlag im letzten Jahr,
Fremdkapital (Gearing), laufende Kosten, Sektor. Ein Abruf am Tag genügt (Stand: Schlusskurs des Vortags).
"""

from __future__ import annotations

import datetime as dt
import http.client
import json
import re
import time
import urllib.request

URL = "https://www.theaic.co.uk/aic/find-compare-investment-companies"
USER_AGENT = "Mozilla/5.0 (Aktientool lokal)"
SETTINGS_RE = re.compile(r'<script type="application/json" data-drupal-selector="drupal-settings-json">(.*?)</script>', re.S)

# AIC-Sektoren auf Deutsch; VCTs (britische Steuersparmodelle) übernimmt das Tool nicht
SECTORS_DE = {
    "Global": "Global", "Global Equity Income": "Global, Dividende", "Global Smaller Companies": "Global, Nebenwerte",
    "Global Emerging Markets": "Schwellenländer", "Flexible Investment": "Flexibel (Mischanlage)",
    "UK All Companies": "Großbritannien", "UK Equity Income": "Großbritannien, Dividende",
    "UK Smaller Companies": "Großbritannien, Nebenwerte", "UK Equity & Bond Income": "Großbritannien, Aktien & Anleihen",
    "North America": "Nordamerika", "North American Smaller Companies": "Nordamerika, Nebenwerte",
    "Europe": "Europa", "European Smaller Companies": "Europa, Nebenwerte", "Japan": "Japan",
    "Japanese Smaller Companies": "Japan, Nebenwerte", "Asia Pacific": "Asien-Pazifik",
    "Asia Pacific Equity Income": "Asien-Pazifik, Dividende", "Asia Pacific Smaller Companies": "Asien-Pazifik, Nebenwerte",
    "China / Greater China": "China", "India / Indian Subcontinent": "Indien", "Latin America": "Lateinamerika",
    "Country Specialist": "Einzelne Länder", "Technology & Technology Innovation": "Technologie",
    "Healthcare & Biotechnology": "Gesundheit & Biotech", "Biotechnology & Healthcare": "Gesundheit & Biotech",
    "Financials & Financial Innovation": "Finanzwerte", "Commodities & Natural Resources": "Rohstoffe",
    "Environmental": "Umwelt", "Private Equity": "Private Equity", "Growth Capital": "Wachstumskapital (nicht börsennotiert)",
    "Hedge Funds": "Hedgefonds", "Infrastructure": "Infrastruktur", "Infrastructure Securities": "Infrastruktur-Aktien",
    "Renewable Energy Infrastructure": "Erneuerbare Energien", "Debt - Loans & Bonds": "Kredite & Anleihen",
    "Debt - Direct Lending": "Direktkredite", "Debt - Structured Finance": "Strukturierte Kredite",
    "Property - UK Commercial": "Immobilien GB, Gewerbe", "Property - UK Residential": "Immobilien GB, Wohnen",
    "Property - UK Healthcare": "Immobilien GB, Gesundheit", "Property - UK Logistics": "Immobilien GB, Logistik",
    "Property - Europe": "Immobilien Europa", "Property - Rest of World": "Immobilien weltweit",
    "Property - Debt": "Immobilienkredite", "Property Securities": "Immobilienaktien", "Leasing": "Leasing",
    "Insurance & Reinsurance Strategies": "Versicherungen",
}


def _num(x) -> float | None:
    try:
        return float(x) if x not in (None, "", "N/A") else None
    except (TypeError, ValueError):
        return None


def _pct(x) -> float | None:
    v = _num(x)
    return v / 100 if v is not None else None


def _range(a: float | None, b: float | None) -> list[float] | None:
    # die Bezeichnungen High/Low der AIC sind nicht eindeutig; die Zahlen schon
    return sorted([a, b]) if a is not None and b is not None else None


def parse(html: str) -> dict:
    m = SETTINGS_RE.search(html)
    if not m:
        raise RuntimeError("Datensatz auf der AIC-Seite nicht gefunden; hat sich die Seite geändert?")
    data = json.loads(m.group(1)).get("aic") or {}
    rows = data.get("basic") or []
    if len(rows) < 100:
        raise RuntimeError(f"nur {len(rows)} Trusts auf der AIC-Seite gelesen")
    try:
        day = dt.datetime.strptime(data.get("dataAsAt") or "", "%d/%m/%Y").date().isoformat()
    except ValueError:
        day = None
    out, vct = {}, []
    for r in rows:
        sector = r.get("Sector") or r.get("SectorName") or ""
        if sector.startswith("VCT") and r.get("ISIN"):
            vct.append(r["ISIN"])
        if not r.get("ISIN") or sector.startswith("VCT"):
            continue
        out[r["ISIN"]] = {
            "sector": SECTORS_DE.get(sector, sector) or None, "sector_en": sector or None,
            "price": _num(r.get("ClosingPrice")), "nav": _num(r.get("NAVFAIRCUM")), "disc": _pct(r.get("DiscFairCum")),
            "disc_avg1": _pct(r.get("Disc1YAvgCF")), "disc_avg3": _pct(r.get("Disc3YAvgCF")), "disc_avg5": _pct(r.get("Disc5YAvgCF")),
            # Spanne des letzten Jahres: [größter Abschlag, kleinster Abschlag bzw. größter Aufschlag]
            "disc_range1": _range(_pct(r.get("OneyrHighCumFairDiscount")), _pct(r.get("OneyrLowCumFairDiscount"))),
            "gearing": _pct(r.get("NetGearCum")), "ocf": _pct(r.get("OngoingCharge")), "yield": _pct(r.get("NetDivYld")),
            "nav_ret5": _pct(r.get("CALC_NAVTR5Y_A")), "ret5": _pct(r.get("CALC_SPTR5Y_A")),
            "manager": r.get("ManagerName") or None, "website": r.get("CompWebSite") or None,
            "launch": (r.get("LaunchDate") or "")[:10] or None, "wind_up": r.get("WindupProv") or None,
        }
    return {"date": day, "trusts": out, "vct": vct}


def load() -> dict:
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    err: Exception | None = None
    for attempt in range(4):  # die rund 800 KB große Seite bricht gelegentlich mittendrin ab
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                html = resp.read().decode("utf-8", "replace")
            return parse(html)
        except (OSError, http.client.HTTPException) as e:
            err = e
            time.sleep(2 + 2 * attempt)
    raise err  # type: ignore[misc]
