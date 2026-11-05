"""Wikipedia: Kurzzusammenfassungen für das Lexikon (REST-API) und die deutsche Firmenbeschreibung im Profil."""

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


ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")


def _get(url: str, params: dict) -> dict:
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}",
                                 headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


WIKIDATA = "https://www.wikidata.org/w/api.php"
# Rechtsformen am Namensende, für die Suche nach dem Firmennamen
LEGAL_FORM = re.compile(r"[,.]?\s+(inc\.?|incorporated|corporation|corp\.?|company|co\.?|ltd\.?|limited|plc|ag|se|kgaa|"
                        r"s\.?a\.?|n\.?v\.?|a/s|asa|ab|oyj|s\.?p\.?a\.?|holdings?|group|\(publ\))$", re.IGNORECASE)


def _listed_with_article(ids: list[str], lang: str) -> str | None:
    """Erster Eintrag, der an einer Börse notiert (P414) oder eine ISIN (P946) hat und einen Artikel in `lang` besitzt."""
    if not ids:
        return None
    entities = _get(WIKIDATA, {"action": "wbgetentities", "ids": "|".join(ids), "props": "claims|sitelinks",
                               "sitefilter": f"{lang}wiki", "format": "json"})["entities"]
    for qid in ids:
        e = entities.get(qid) or {}
        title = ((e.get("sitelinks") or {}).get(f"{lang}wiki") or {}).get("title")
        if title and ({"P414", "P946"} & set(e.get("claims") or {})):
            return title
    return None


def company(isin: str | None, name: str | None = None, lang: str = "de") -> dict | None:
    """Einleitung des Wikipedia-Artikels über die Firma, oder None. Den Artikel findet Wikidata über die ISIN
    (Eigenschaft P946), so landet „Apple“ beim Unternehmen und nicht beim Obst. Führt Wikidata die ISIN nicht (etwa
    nach einem Wechsel), zählt ein Treffer zum Firmennamen nur, wenn der Eintrag eine Börsennotierung hat."""
    title = None
    if ISIN_RE.match(isin or ""):
        hits = _get(WIKIDATA, {"action": "query", "list": "search", "srsearch": f"haswbstatement:P946={isin}",
                               "srlimit": 3, "format": "json"})["query"]["search"]
        title = _listed_with_article([h["title"] for h in hits], lang)
    if not title and name:
        short = name.strip()
        while (cut := LEGAL_FORM.sub("", short)) != short:
            short = cut
        hits = _get(WIKIDATA, {"action": "wbsearchentities", "search": short, "language": "en", "type": "item",
                               "limit": 5, "format": "json"}).get("search") or []
        title = _listed_with_article([h["id"] for h in hits], lang)
    if not title:
        return None
    page = _get(f"https://{lang}.wikipedia.org/w/api.php", {
        "action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1, "redirects": 1, "titles": title,
        "format": "json", "formatversion": 2,
    })["query"]["pages"][0]
    text = (page.get("extract") or "").strip()
    if not text:
        return None
    return {"title": page.get("title") or title, "text": text, "lang": lang,
            "url": f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"}
