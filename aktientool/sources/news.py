"""Aktuelle Nachrichten zu einer Aktie: Google News (deutsch, RSS) und Yahoo Finance (englisch). Beides ohne API-Key."""

from __future__ import annotations

import datetime as dt
import email.utils
import http.client
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import yfinance as yf

GOOGLE_RSS = "https://news.google.com/rss/search?q={q}&hl=de&gl=DE&ceid=DE:de"
USER_AGENT = "Mozilla/5.0 (Aktientool lokal)"

# Rechtsformen und Füllwörter, die eine Nachrichtensuche nur verwässern
_LEGAL = re.compile(
    r"\b(the|incorporated|inc|corporation|corp|company|co|ltd|limited|plc|ag|se|sa|nv|holdings?|group|"
    r"aktiengesellschaft|kgaa|ab|asa|oyj|spa|tbk|berhad|bhd|s\.a|n\.v|s\.p\.a|a/s|& co|in münchen)\b\.?",
    re.IGNORECASE)


def search_name(name: str) -> str:
    """„NVIDIA Corporation“ -> „NVIDIA“, „Mercedes-Benz Group AG“ -> „Mercedes-Benz“."""
    short = _LEGAL.sub(" ", name)
    short = re.sub(r"[,()]", " ", short)
    words = [w for w in short.split() if re.search(r"\w", w)]  # übrig gebliebenes „&“ oder „.“ weg
    return " ".join(words[:4]) or name


def _iso(ts: dt.datetime | None) -> str | None:
    return ts.astimezone(dt.timezone.utc).isoformat(timespec="minutes") if ts else None


def parse_google_rss(xml_text: str, limit: int = 12) -> list[dict]:
    root = ET.fromstring(xml_text)
    out = []
    for item in root.iter("item"):
        source = item.findtext("source") or ""
        title = item.findtext("title") or ""
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        try:
            published = email.utils.parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError):
            published = None
        link = item.findtext("link") or ""
        if title and link.startswith("https://"):
            out.append({"title": title, "url": link, "source": source, "published": _iso(published)})
    out.sort(key=lambda n: n["published"] or "", reverse=True)
    return out[:limit]


def google(name: str) -> list[dict]:
    q = urllib.parse.quote(f"{search_name(name)} Aktie")
    req = urllib.request.Request(GOOGLE_RSS.format(q=q), headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return parse_google_rss(resp.read().decode("utf-8", "replace"))
        except http.client.IncompleteRead:  # gelegentlich abgebrochene Übertragung: einfach erneut holen
            if attempt == 2:
                raise
    return []


def yahoo(symbol: str, limit: int = 12) -> list[dict]:
    out = []
    for n in yf.Search(symbol, max_results=1, news_count=limit, lists_count=0).news or []:
        url = n.get("link") or ""
        if not n.get("title") or not url.startswith("https://"):
            continue
        ts = n.get("providerPublishTime")
        published = dt.datetime.fromtimestamp(ts, dt.timezone.utc) if ts else None
        out.append({"title": n["title"], "url": url, "source": n.get("publisher") or "", "published": _iso(published)})
    return out
