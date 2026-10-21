"""Alarme prüfen: solange der Server läuft, alle 30 Minuten (einstellbar) im Hintergrund.

Kursalarme nutzen den aktuellen Kurs (eine Sammelabfrage für alle Aktien), Bewertungs- und Dividendenalarme die
Kennzahlen aus dem Profil (höchstens 6 Stunden alt), der Score-Alarm die Weltauswahl. Ausgelöste Alarme erscheinen
in der Oberfläche; zusätzlich gibt es eine macOS-Mitteilung und, falls eingerichtet, eine E-Mail.
"""

from __future__ import annotations

import datetime as dt
import logging
import shutil
import smtplib
import subprocess
import sys
import threading
import time
from email.message import EmailMessage

from . import config, service, userdata, world
from .sources import yahoo_screener

log = logging.getLogger(__name__)

_state = {"last_check": None, "error": None, "running": False}
_lock = threading.Lock()


def _fmt(x: float) -> str:
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def evaluate(alert: dict, price: float | None, row: dict | None, world_row: dict | None) -> str | None:
    """Meldungstext, wenn der Alarm auslöst, sonst None."""
    kind, value, sym = alert["type"], alert.get("value"), alert["symbol"]
    if kind == "price_below" and price is not None and price <= value:
        return f"{sym}: Kurs {_fmt(price)} ist unter {_fmt(value)} gefallen."
    if kind == "price_above" and price is not None and price >= value:
        return f"{sym}: Kurs {_fmt(price)} ist über {_fmt(value)} gestiegen."
    if kind == "below_fair" and row and row.get("fair_value") and row.get("deviation") is not None and price:
        dev = price / row["fair_value"] - 1
        if dev <= -value / 100:
            return f"{sym}: Kurs {_fmt(price)} liegt {abs(dev) * 100:.0f} % unter dem fairen Wert von {_fmt(row['fair_value'])}."
    if kind == "dividend_cut" and row and alert.get("baseline"):
        if (row.get("div_ttm") or 0) < alert["baseline"] * 0.95:
            return (f"{sym}: Die Dividende der letzten 12 Monate ist auf {_fmt(row.get('div_ttm') or 0)} gesunken "
                    f"(beim Anlegen des Alarms {_fmt(alert['baseline'])}).")
    if kind == "score_below" and world_row and world_row.get("score_total") is not None:
        if world_row["score_total"] < value:
            return f"{sym}: Der Gesamt-Score ist auf {world_row['score_total']} gefallen (Schwelle {value:.0f})."
    return None


def _notify(messages: list[str]) -> None:
    if not messages:
        return
    text = " ".join(messages)
    if config.ALERT_NOTIFY and sys.platform == "darwin" and shutil.which("osascript"):
        safe = text.replace("\\", "\\\\").replace('"', '\\"')[:400]
        try:
            subprocess.run(["osascript", "-e", f'display notification "{safe}" with title "Aktientool: Alarm"'],
                           timeout=10, check=False, capture_output=True)
        except (OSError, subprocess.SubprocessError) as e:
            log.info("Mitteilung nicht möglich: %s", e)
    smtp = config.SMTP
    if smtp.get("host") and smtp.get("to"):
        try:
            msg = EmailMessage()
            msg["Subject"] = f"Aktientool: {len(messages)} Alarm{'e' if len(messages) > 1 else ''}"
            msg["From"] = smtp.get("user") or smtp["to"]
            msg["To"] = smtp["to"]
            msg.set_content("\n".join(messages))
            with smtplib.SMTP(smtp["host"], int(smtp.get("port") or 587), timeout=30) as s:
                s.starttls()
                if smtp.get("user"):
                    s.login(smtp["user"], smtp.get("password") or "")
                s.send_message(msg)
        except Exception as e:  # Mailversand ist optional
            log.warning("Alarm-E-Mail nicht versendet: %s", e)


def check() -> list[dict]:
    """Prüft alle offenen Alarme; gibt die neu ausgelösten zurück."""
    with _lock:
        if _state["running"]:
            return []
        _state["running"] = True
    try:
        pending = [a for a in userdata.alerts() if not a.get("triggered")]
        triggered: dict[str, dict] = {}
        if pending:
            symbols = sorted({a["symbol"] for a in pending})
            quotes = {q["symbol"]: q for q in yahoo_screener.quotes(symbols)}
            rows: dict[str, dict | None] = {}
            for a in pending:
                sym = a["symbol"]
                price = (quotes.get(sym) or {}).get("regularMarketPrice")
                row = None
                if a["type"] in ("below_fair", "dividend_cut"):
                    if sym not in rows:
                        try:
                            rows[sym] = service.summary_row(sym)
                        except Exception as e:
                            log.info("Alarm %s: Profil nicht verfügbar: %s", sym, e)
                            rows[sym] = None
                    row = rows[sym]
                world_row = world.stock(sym) if a["type"] == "score_below" else None
                msg = evaluate(a, price, row, world_row)
                if msg:
                    triggered[a["id"]] = {"triggered": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                                          "message": msg, "seen": False}
        if triggered:
            userdata.update_alerts(triggered)
            _notify([t["message"] for t in triggered.values()])
        with _lock:
            _state.update(last_check=time.time(), error=None)
        return [{**a, **triggered[a["id"]]} for a in pending if a["id"] in triggered]
    except Exception as e:
        log.warning("Alarmprüfung fehlgeschlagen: %s", e)
        with _lock:
            _state["error"] = f"{type(e).__name__}: {e}"
        return []
    finally:
        with _lock:
            _state["running"] = False


def status() -> dict:
    with _lock:
        st = dict(_state)
    items = userdata.alerts()
    st.update(total=len(items), open=sum(not a.get("triggered") for a in items),
              unseen=sum(bool(a.get("triggered")) and not a.get("seen") for a in items),
              interval=config.ALERT_INTERVAL, email=bool(config.SMTP.get("host") and config.SMTP.get("to")),
              notify=config.ALERT_NOTIFY and sys.platform == "darwin")
    return st


def start_background() -> None:
    def loop():
        time.sleep(60)  # erst nach dem Start prüfen
        while True:
            if any(not a.get("triggered") for a in userdata.alerts()):
                check()
            time.sleep(config.ALERT_INTERVAL)

    threading.Thread(target=loop, name="alarme", daemon=True).start()
