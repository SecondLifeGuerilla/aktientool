"""Pfade, Cache-Laufzeiten und Einstellungen. Alles lässt sich per Umgebungsvariable überschreiben."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Serverlos (Vercel): kein dauerhafter Speicher und keine Hintergrund-Threads. Weltauswahl, Tiefenanalyse,
# Handelsliste, Fonds und Tagesstände baut dann ein täglicher GitHub-Workflow (scripts/daten.py) und legt sie auf den
# Branch „data“; der Server lädt sie von dort (remote.py). Eigene Eingaben (Depot, Watchlist, Notizen, Alarme …)
# speichert in beiden Betriebsarten der Browser (static/js/store.js), der Server merkt sich nichts über Nutzer.
SERVERLESS = bool(os.environ.get("VERCEL")) or os.environ.get("AKTIENTOOL_SERVERLESS", "0") == "1"
DATA_DIR = Path(os.environ.get("AKTIENTOOL_DATA_DIR", "/tmp/aktientool" if SERVERLESS else BASE_DIR / "data"))
CACHE_DIR = DATA_DIR / "cache"
STATIC_DIR = BASE_DIR / "static"
PRESETS_FILE = BASE_DIR / "aktientool" / "presets.json"
THEMES_FILE = BASE_DIR / "aktientool" / "themes.json"
WITHHOLDING_FILE = BASE_DIR / "aktientool" / "quellensteuer.json"
HOLDINGS_FILE = BASE_DIR / "aktientool" / "holdings.json"  # Holdings mit selbst gerechnetem inneren Wert
SNAPSHOT_DIR = Path(os.environ.get("AKTIENTOOL_SNAPSHOT_DIR", DATA_DIR / "snapshots"))
DEEP_KEY = "tiefenanalyse"
MONTHLY_KEY = "monatskurse"  # Monatsschlusskurse aller Aktien der Weltauswahl (Rückblick im Score-Check)
RUECKBLICK_KEY = "rueckblick"  # daraus berechnete Auswertung der Kursfaktoren

HOST = os.environ.get("AKTIENTOOL_HOST", "127.0.0.1")
PORT = int(os.environ.get("AKTIENTOOL_PORT", "5050"))
# Nach dem Start die Seite im Standardbrowser öffnen (setzt Aktientool.command)
OPEN_BROWSER = os.environ.get("AKTIENTOOL_BROWSER", "0") == "1"

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
TTL_LSX = 20 * 3600  # Handelsliste der LS Exchange, erscheint jeden Börsentag neu
TTL_TRUSTS = 12 * 3600  # Abschläge der Closed-End-Fonds (Morningstar, AIC): Stand Vortag
TTL_TRUST_HOLDINGS = 7 * 24 * 3600  # Positionen der Fonds (Morningstar monatlich, SEC vierteljährlich)
TTL_DERIVATE = 3 * 60  # Hebelprodukte (onvista): Geld- und Briefkurse der Emittenten ändern sich laufend
TTL_ONVISTA_IDS = 30 * 24 * 3600  # Zuordnung Ticker/ISIN ↔ Basiswert bei onvista

# Weltauswahl: alle Aktien ab diesem Börsenwert in Euro
WORLD_MIN_CAP_EUR = float(os.environ.get("AKTIENTOOL_WELT_MIN_CAP", 2e9))

# Tiefenanalyse der Weltauswahl im Hintergrund: automatisch starten, Pause zwischen zwei Aktien, Gültigkeit
DEEP_AUTO = os.environ.get("AKTIENTOOL_TIEFE_AUTO", "1") != "0"
DEEP_DELAY = float(os.environ.get("AKTIENTOOL_TIEFE_PAUSE", 1.5))
TTL_DEEP = int(os.environ.get("AKTIENTOOL_TTL_TIEFE", 7 * 24 * 3600))

# Vorberechnete Daten (nur serverlos): Basis-URL des Branches „data“. Standard ist das GitHub-Repo, aus dem Vercel
# gebaut hat (VERCEL_GIT_REPO_OWNER/SLUG), sonst SecondLifeGuerilla/aktientool.
_REPO = (f"{os.environ['VERCEL_GIT_REPO_OWNER']}/{os.environ['VERCEL_GIT_REPO_SLUG']}"
         if os.environ.get("VERCEL_GIT_REPO_OWNER") and os.environ.get("VERCEL_GIT_REPO_SLUG") else "SecondLifeGuerilla/aktientool")
DATA_URL = os.environ.get("AKTIENTOOL_DATA_URL", f"https://raw.githubusercontent.com/{_REPO}/data").rstrip("/")
DATA_CHECK_EVERY = int(os.environ.get("AKTIENTOOL_DATA_PRUEFEN", 10 * 60))  # so oft nach neuen Daten sehen
