import pytest

from aktientool.sources import fx, sec


def fact(val, start, end, filed, form="10-K"):
    return {"val": val, "start": start, "end": end, "filed": filed, "form": form, "fy": int(end[:4]), "fp": "FY"}


FACTS = {
    "facts": {
        "us-gaap": {
            "EarningsPerShareDiluted": {"units": {"USD/shares": [
                fact(8.0, "2019-01-01", "2019-12-31", "2020-02-01"),
                fact(2.0, "2019-01-01", "2019-12-31", "2021-02-01"),  # neu eingereicht nach 4:1-Split
                fact(0.5, "2019-10-01", "2019-12-31", "2020-02-01"),  # Quartal -> ignorieren
                fact(2.5, "2020-01-01", "2020-12-31", "2021-02-01"),
            ]}},
            "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [
                fact(1000.0, "2019-01-01", "2019-12-31", "2020-02-01"),
                fact(1200.0, "2020-01-01", "2020-12-31", "2021-02-01"),
            ]}},
            "NetIncomeLoss": {"units": {"USD": [
                fact(800.0, "2020-01-01", "2020-12-31", "2021-02-01"),
            ]}},
        }
    }
}


def test_series_takes_latest_filing_and_skips_quarters():
    series = sec._series(FACTS, ["EarningsPerShareDiluted"], "eps")
    assert series["2019-12-31"]["val"] == 2.0
    assert set(series) == {"2019-12-31", "2020-12-31"}


def test_series_ignores_wrong_units():
    # Costco hat EPS teils mit der Einheit „pure“ getaggt
    facts = {"facts": {"us-gaap": {"EarningsPerShareDiluted": {"units": {
        "pure": [fact(9.9, "2020-01-01", "2020-12-31", "2022-02-01")],
        "USD/shares": [fact(2.5, "2020-01-01", "2020-12-31", "2021-02-01")],
    }}}}}
    series = sec._series(facts, ["EarningsPerShareDiluted"], "eps")
    assert series["2020-12-31"]["val"] == 2.5 and series["2020-12-31"]["unit"] == "USD/shares"


@pytest.mark.parametrize("field,unit,ok", [("eps", "USD/shares", True), ("eps", "pure", False), ("eps", "EUR", False),
                                           ("shares", "shares", True), ("ocf", "USD", True), ("ocf", "pure", False)])
def test_unit_ok(field, unit, ok):
    assert sec.unit_ok(field, unit) is ok


def test_annual_rows_adjust_for_later_splits(monkeypatch):
    monkeypatch.setattr(sec, "_compact", lambda cik: sec.compact(FACTS))
    rows = {r["end"]: r for r in sec.annual_rows(1, splits=[["2022-06-01", 2.0]])}
    assert rows["2020-12-31"]["eps"] == pytest.approx(1.25)  # 2,5 / 2 wegen Split nach Einreichung
    assert rows["2020-12-31"]["shares"] == pytest.approx(800 / 2.5 * 2)  # aus Gewinn / EPS abgeleitet, dann Split
    assert rows["2020-12-31"]["currency"] == "USD"


def test_names_match():
    assert sec.names_match("SAP SE", "SAP SE")
    assert sec.names_match("ASML HOLDING NV", "ASML Holding N.V.")
    assert not sec.names_match("ALLIANCE RESOURCE PARTNERS LP", "Allianz SE")


def test_find_cik_requires_name_match_for_foreign_listing(monkeypatch):
    monkeypatch.setattr(sec, "ticker_map", lambda: {"SAP": {"cik": 1, "title": "SAP SE"}, "ALV": {"cik": 2, "title": "Autoliv Inc"}})
    assert sec.find_cik("SAP.DE", "SAP SE") == 1
    assert sec.find_cik("ALV.DE", "Allianz SE") is None
    assert sec.find_cik("ALV", None) == 2


def test_minor_currency_units():
    assert fx.split_currency("GBp") == ("GBP", 100.0)
    conv = fx.Converter("GBp")
    assert conv.rate("GBP") == 100.0  # Bilanz in Pfund, Kurs in Pence
    assert fx.Converter("EUR").convert(2.0, "EUR") == 2.0


class TestCompanyDescription:
    """Deutsche Firmenbeschreibung: Wikidata findet den Wikipedia-Artikel über ISIN oder Firmennamen."""

    @staticmethod
    def fake_get(entities, isin_hits=(), name_hits=()):
        calls = []

        def get(url, params):
            calls.append(params)
            if params.get("list") == "search":
                return {"query": {"search": [{"title": q} for q in isin_hits]}}
            if params.get("action") == "wbsearchentities":
                return {"search": [{"id": q} for q in name_hits]}
            if params.get("action") == "wbgetentities":
                return {"entities": {q: entities[q] for q in params["ids"].split("|")}}
            title = params["titles"]
            return {"query": {"pages": [{"title": title, "extract": f"{title} ist ein Unternehmen.\nZweiter Absatz."}]}}
        return get, calls

    def test_isin_finds_article(self, monkeypatch):
        from aktientool.sources import wiki
        get, _ = self.fake_get({"Q312": {"claims": {"P946": []}, "sitelinks": {"dewiki": {"title": "Apple"}}}}, isin_hits=["Q312"])
        monkeypatch.setattr(wiki, "_get", get)
        d = wiki.company("US0378331005", "Apple Inc.")
        assert d["title"] == "Apple" and d["text"].startswith("Apple ist") and d["url"].endswith("/wiki/Apple")

    def test_name_fallback_needs_listing_and_strips_legal_form(self, monkeypatch):
        from aktientool.sources import wiki
        entities = {"Q1": {"claims": {}, "sitelinks": {"dewiki": {"title": "Unilever (Begriffsklärung)"}}},
                    "Q2": {"claims": {"P414": []}, "sitelinks": {"dewiki": {"title": "Unilever"}}}}
        get, calls = self.fake_get(entities, name_hits=["Q1", "Q2"])
        monkeypatch.setattr(wiki, "_get", get)
        assert wiki.company("GB00BVZK7T90", "Unilever PLC")["title"] == "Unilever"
        assert next(c for c in calls if c.get("action") == "wbsearchentities")["search"] == "Unilever"

    def test_nothing_found(self, monkeypatch):
        from aktientool.sources import wiki
        get, _ = self.fake_get({"Q9": {"claims": {"P414": []}, "sitelinks": {}}}, isin_hits=["Q9"])
        monkeypatch.setattr(wiki, "_get", get)
        assert wiki.company("US0000000001", None) is None


# ---------------------------------------------------------------- Handelsliste der LS Exchange

def _lsx_page(rows, header=True) -> bytes:
    """Seite wie im Stammdaten-PDF: jede Zelle ein Textbefehl an fester x-Position, Zeilen über die y-Position."""
    xs = {"WKN": 25, "ISIN": 95, "Name": 195, "Gattung": 415}
    out = []
    lines = ([dict(zip(xs, xs))] if header else []) + rows
    for i, row in enumerate(lines):
        y = 808.69 - 20 * i
        for col, text in row.items():
            out.append(f"BT\n1 0 0 1 {xs[col]} {y} Tm\n/F1 10 Tf\n0 0 0 rg\n({text})Tj\n0 g\nET\n")
    return "".join(out).encode("cp1252")


def _lsx_pdf(*pages: bytes) -> bytes:
    import zlib
    return b"%PDF-1.5\n" + b"".join(
        b"1 0 obj <</Filter/FlateDecode>> stream\n" + zlib.compress(p) + b"\nendstream endobj\n" for p in pages)


def test_lsx_parse_reads_columns_across_pages():
    from aktientool.sources import lsx
    page1 = _lsx_page([
        {"WKN": "865985", "ISIN": "US0378331005", "Name": "APPLE INC.", "Gattung": "AKTIE"},
        {"WKN": "A1JC1K", "ISIN": "BMG0129K1045", "Name": r"AEON STORES\(HK\)R.L.", "Gattung": "AKTIE"},
        {"WKN": "A3K1XY", "ISIN": "DE000A3K1XY0", "Name": "BUND 21/31", "Gattung": "BONDS"},
    ])
    page2 = _lsx_page([{"WKN": "909800", "ISIN": "US8740391003", "Name": "TAIWAN SEMICON.MANU.", "Gattung": "AKTIE"},
                       {"WKN": "", "ISIN": "keine ISIN", "Name": "Fußzeile"}], header=False)  # Folgeseite ohne Kopf
    got = lsx.parse(_lsx_pdf(page1, page2))
    assert got == {"US0378331005": ["865985", "APPLE INC.", "AKTIE"],
                   "BMG0129K1045": ["A1JC1K", "AEON STORES(HK)R.L.", "AKTIE"],
                   "DE000A3K1XY0": ["A3K1XY", "BUND 21/31", "BONDS"],
                   "US8740391003": ["909800", "TAIWAN SEMICON.MANU.", "AKTIE"]}


def test_lsx_combine_merges_sources_without_bonds():
    import datetime as dt
    from aktientool.sources import lsx
    listed = ("2026-10-23", {"US0378331005": ["865985", "APPLE INC.", "AKTIE"], "DE000A3K1XY0": ["A3K1XY", "BUND", "BONDS"]})
    quoted = ("2026-10-23", {"US0378331005", "DE000A3K1XY0", "CNE100000296"})  # BYD fehlt im PDF
    got = lsx.combine(listed, quoted, None, dt.date(2026, 10, 23))
    assert got["isins"] == {"US0378331005": ["865985", "APPLE INC.", "AKTIE"], "CNE100000296": ["", "", ""]}
    assert got["date"] == "2026-10-23" and got["stocks"] == 1 and got["count"] == 2


def test_lsx_combine_keeps_last_state_of_a_missing_source():
    import datetime as dt
    from aktientool.sources import lsx
    previous = {"listed_date": "2026-10-23", "quoted_date": "2026-10-23",
                "isins": {"US0378331005": ["865985", "APPLE INC.", "AKTIE"], "CNE100000296": ["", "", ""]}}
    weekend = lsx.combine(("2026-10-24", {"US0378331005": ["865985", "APPLE INC.", "AKTIE"]}), None,
                          previous, dt.date(2026, 10, 24))  # am Wochenende gibt es keine Kursliste
    assert set(weekend["isins"]) == {"US0378331005", "CNE100000296"} and weekend["quoted_date"] == "2026-10-23"
    stale = lsx.combine(None, ("2026-11-02", {"CNE100000296"}), previous, dt.date(2026, 11, 2))
    assert set(stale["isins"]) == {"CNE100000296"}  # Stammdaten älter als eine Woche gelten nicht mehr
    carried = lsx.combine(None, None, previous, dt.date(2026, 11, 2))  # die Kursliste gilt länger (wöchentlich geladen)
    assert set(carried["isins"]) == {"CNE100000296"}
    with pytest.raises(RuntimeError):
        lsx.combine(None, None, previous, dt.date(2026, 11, 10))


def test_lsx_quoted_falls_back_to_earlier_window(monkeypatch):
    import datetime as dt
    import urllib.error
    from aktientool.sources import lsx
    asked = []

    def fake(url):
        asked.append(url[-6:])
        if url.endswith("150500"):
            raise urllib.error.HTTPError(url, 410, "Gone", None, None)
        return {f"US{n:09d}0" for n in range(lsx.MIN_QUOTED)}

    monkeypatch.setattr(lsx, "_quote_isins", fake)
    day, isins = lsx._quoted(dt.datetime(2026, 10, 23, 15, 19, tzinfo=dt.timezone.utc))
    assert asked == ["150500", "120000"] and day == "2026-10-23" and len(isins) == lsx.MIN_QUOTED

    def closed(url):  # vor Handelsbeginn oder am Wochenende
        raise urllib.error.HTTPError(url, 410, "Gone", None, None)

    monkeypatch.setattr(lsx, "_quote_isins", closed)
    assert lsx._quoted(dt.datetime(2026, 10, 24, 3, 0, tzinfo=dt.timezone.utc)) is None


def test_lsx_unescape_octal_and_umlauts():
    from aktientool.sources import lsx
    assert lsx._unescape(rb"M\374NCHENER R\\CK \(NAMENS\)") == "MüNCHENER R\\CK (NAMENS)"
    assert lsx._unescape("ÖKOWORLD".encode("cp1252")) == "ÖKOWORLD"


def test_lsx_find_prefers_first_listed_isin():
    from aktientool.sources import lsx
    listing = {"isins": {"US8740391003": ["909800", "TSMC ADR", "AKTIE"], "TW0002330008": ["", "TSMC", "AKTIE"]}}
    assert lsx.find(listing, ["TW0002330008", "US8740391003"])[0] == "TW0002330008"
    assert lsx.find(listing, ["KR7402340004"]) is None
    assert lsx.find(None, ["US8740391003"]) is None
