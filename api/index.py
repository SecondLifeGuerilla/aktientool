"""Einstieg für Vercel: alle Anfragen an /api/… gehen an die Flask-App (siehe vercel.json)."""

import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("AKTIENTOOL_SERVERLESS", "1")
# yfinance legt Zeitzonen- und Cookie-Cache im Home-Verzeichnis an; auf Vercel ist nur /tmp beschreibbar
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/xdg-cache")

import yfinance as yf  # noqa: E402

try:
    yf.set_tz_cache_location("/tmp/yfinance-tz")
except Exception:  # ältere Versionen ohne diese Funktion
    pass

from aktientool.server import app  # noqa: E402,F401

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("yfinance").setLevel(logging.WARNING)
