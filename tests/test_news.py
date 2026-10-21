import pytest

from aktientool.sources import news, wiki

RSS = """<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<item><title>Nvidia-Aktie steigt - Börse Express</title><link>https://news.google.com/rss/articles/abc</link>
  <pubDate>Tue, 20 Oct 2026 08:00:00 GMT</pubDate><source url="https://boerse-express.com">Börse Express</source></item>
<item><title>Neuer Rekord - Handelsblatt</title><link>https://news.google.com/rss/articles/def</link>
  <pubDate>Wed, 21 Oct 2026 09:30:00 GMT</pubDate><source url="https://handelsblatt.com">Handelsblatt</source></item>
<item><title>Ohne Link</title><link>javascript:alert(1)</link><pubDate>Wed, 21 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>"""


def test_google_rss_is_parsed_sorted_and_cleaned():
    items = news.parse_google_rss(RSS)
    assert [n["title"] for n in items] == ["Neuer Rekord", "Nvidia-Aktie steigt"]  # neueste zuerst, Quelle aus dem Titel entfernt
    assert items[0]["source"] == "Handelsblatt" and items[0]["published"].startswith("2026-10-21T09:30")
    assert all(n["url"].startswith("https://") for n in items)  # nur sichere Links


@pytest.mark.parametrize("name,expected", [
    ("NVIDIA Corporation", "NVIDIA"), ("Henkel AG & Co. KGaA", "Henkel"), ("The Coca-Cola Company", "Coca-Cola"),
    ("Mercedes-Benz Group AG", "Mercedes-Benz"), ("Alphabet Inc.", "Alphabet"), ("SAP SE", "SAP"),
])
def test_search_name_drops_legal_forms(name, expected):
    assert news.search_name(name) == expected


@pytest.mark.parametrize("title,lang", [("../../etc/passwd", "de"), ("KGV", "fr"), ("x" * 200, "de")])
def test_wiki_rejects_unexpected_input(title, lang):
    with pytest.raises(wiki.NotFound):
        wiki.summary(title, lang)
