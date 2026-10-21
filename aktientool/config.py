"""Pfade, Cache-Laufzeiten und Einstellungen. Alles lässt sich per Umgebungsvariable überschreiben."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("AKTIENTOOL_DATA_DIR", BASE_DIR / "data"))
CACHE_DIR = DATA_DIR / "cache"
STATIC_DIR = BASE_DIR / "static"
WATCHLIST_FILE = DATA_DIR / "watchlist.json"
PRESETS_FILE = BASE_DIR / "aktientool" / "presets.json"
THEMES_FILE = BASE_DIR / "aktientool" / "themes.json"
WITHHOLDING_FILE = BASE_DIR / "aktientool" / "quellensteuer.json"
DEPOT_FILE = DATA_DIR / "depot.json"
NOTES_FILE = DATA_DIR / "notizen.json"
ALERTS_FILE = DATA_DIR / "alarme.json"
SNAPSHOT_DIR = Path(os.environ.get("AKTIENTOOL_SNAPSHOT_DIR", DATA_DIR / "snapshots"))
DEEP_KEY = "tiefenanalyse"

HOST = os.environ.get("AKTIENTOOL_HOST", "127.0.0.1")
PORT = int(os.environ.get("AKTIENTOOL_PORT", "5050"))

# Die SEC verlangt einen User-Agent mit Kontaktadresse. Bitte eigene Adresse eintragen.
SEC_USER_AGENT = os.environ.get("AKTIENTOOL_SEC_USER_AGENT", "Aktientool lokal aktientool@example.com")

# Cache-Laufzeiten in Sekunden
TTL_YAHOO = int(os.environ.get("AKTIENTOOL_TTL_YAHOO", 6 * 3600))
TTL_SEC_FACTS = 14 * 24 * 3600  # Jahresberichte erscheinen einmal im Jahr
TTL_SEC_TICKERS = 7 * 24 * 3600
TTL_FX = 24 * 3600
TTL_WORLD = int(os.environ.get("AKTIENTOOL_TTL_WELT", 24 * 3600))
TTL_NEWS = 30 * 60
TTL_WIKI = 7 * 24 * 3600
TTL_ESEF_LEI = 90 * 24 * 3600
TTL_ESEF_FILINGS = 7 * 24 * 3600
TTL_ESEF_FACTS = 10 * 365 * 24 * 3600  # ein veröffentlichter Bericht ändert sich nicht
TTL_SHORTS = 12 * 3600

# Weltauswahl: alle Aktien ab diesem Börsenwert in Euro
WORLD_MIN_CAP_EUR = float(os.environ.get("AKTIENTOOL_WELT_MIN_CAP", 2e9))

# Tiefenanalyse der Weltauswahl im Hintergrund: automatisch starten, Pause zwischen zwei Aktien, Gültigkeit
DEEP_AUTO = os.environ.get("AKTIENTOOL_TIEFE_AUTO", "1") != "0"
DEEP_DELAY = float(os.environ.get("AKTIENTOOL_TIEFE_PAUSE", 1.5))
TTL_DEEP = int(os.environ.get("AKTIENTOOL_TTL_TIEFE", 7 * 24 * 3600))

# Alarme: Prüfabstand in Sekunden, Mitteilung in macOS, optional E-Mail über einen eigenen SMTP-Zugang
ALERT_INTERVAL = int(os.environ.get("AKTIENTOOL_ALARM_INTERVALL", 1800))
ALERT_NOTIFY = os.environ.get("AKTIENTOOL_MITTEILUNG", "1") != "0"
SMTP = {k: os.environ.get(f"AKTIENTOOL_SMTP_{k.upper()}") for k in ("host", "port", "user", "password", "to")}
