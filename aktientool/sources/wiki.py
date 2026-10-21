"""Kurzzusammenfassungen aus Wikipedia (REST-API) für das Lexikon."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request

# Wikimedia verlangt einen aussagekräftigen User-Agent mit Kontakt
USER_AGENT = "Aktientool/1.0 (lokales Analyse-Tool; aktientool@example.com)"
TITLE_RE = re.compile(r"^\w[\w\s\-().,'’&]{0,119}$")


class NotFound(Exception):
    pass


def summary(title: str, lang: str = "de") -> dict:
    if lang not in ("de", "en") or not TITLE_RE.match(title):
        raise NotFound(title)
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title.replace(' ', '_'), safe='')}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            j = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise NotFound(title) from e
        raise
    page = ((j.get("content_urls") or {}).get("desktop") or {}).get("page")
    return {"title": j.get("title") or title, "extract": j.get("extract") or "", "url": page, "lang": lang}
