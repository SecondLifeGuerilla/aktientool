"""Tests für Hebelprodukte (onvista): Parser für Finder-Zeilen und Snapshots, Filter des Finders, Zuordnung von
Yahoo-Ticker und Basiswert sowie das Laden eines Produkts per ISIN/WKN. Alle ohne Netzwerk."""

import datetime as dt

import pytest

from aktientool import derivate, world
from aktientool.sources import onvista, yahoo
from aktientool.userdata import InvalidInput


@pytest.fixture(autouse=True)
def _fresh_memo():
    """Kurse liegen im Speicher von derivate.py; jeder Test beginnt ohne."""
    derivate._memo.clear()
    derivate._memo_all.clear()
    yield
    derivate._memo.clear()
    derivate._memo_all.clear()


def finder_row(**extra):
    row = {
        "instrument": {"entityType": "DERIVATIVE", "entitySubType": "WARRANT", "entityValue": "344317620",
                       "isin": "DE000WB2BFV9", "wkn": "WB2BFV",
                       "urls": {"WEBSITE": "https://www.onvista.de/derivate/Optionsscheine/344317620-WB2BFV-DE000WB2BFV9"}},
        "shortName": "UBS/CALL/SAP SE/230/0.1/19.03.27",
        "issuer": {"id": 53163, "name": "UBS"},
        "urlProspectus": "https://zertifikate.ubs.com/produkt/detail/index/isin/DE000WB2BFV9",
        "derivativesSubCategory": {"id": 391, "description": "Optionsscheine"},
        "codeExerciseRight": "C", "strikeAbs": 230.0, "dateMaturity": "2027-03-19T12:00:00.000+00:00",
        "quanto": False, "openEnded": False, "coverRatio": 0.1, "isoCurrencyUnderlying": "EUR",
        "gearingAsk": 16.6, "leverage": 7.03, "impliedVolatilityAsk": 35.1, "spreadAskPct": 2.3, "premiumAsk": 13.3,
        "quote": {"bid": 1.26, "ask": 1.29, "isoCurrency": "EUR", "datetimeAsk": "2026-10-23T19:53:52.968+00:00",
                  "market": {"name": "UBS"}},
    }
    row.update(extra)
    return row


def snapshot(sub_type="KNOCKOUT_CERTIFICATE", barriers=(("KNOCK_OUT", 196.746), ("STRIKE", 190.0928)), **details):
    return {
        "instrument": {"entityType": "DERIVATIVE", "entitySubType": sub_type, "entityValue": "999",
                       "isin": "DE000HF1RPM0", "wkn": "HF1RPM", "name": "MINI FUTURE ZERTIFIKAT LONG AUF SAP SE",
                       "urls": {"WEBSITE": "https://www.onvista.de/x"}},
        "quote": {"bid": 2.29, "ask": 2.32, "isoCurrency": "EUR", "datetimeAsk": "2026-10-23T19:59:00+00:00",
                  "market": {"name": "HSBC Trinkaus & Burkhardt"}},
        "derivativesIssuer": {"id": 53882, "name": "HSBC"},
        "derivativesDetails": {"shortName": "MINI FUTURE ZERTIFIKAT LONG AUF SAP SE", "codeExerciseRight": "C",
                               "codeExerciseStyle": "A", "derivativesSubCategory": {"description": "Knock-Out mit Stop Loss"},
                               "datetimeMaturity": None, "openEnded": True, "quanto": False, "hasBarrierBeenHit": False,
                               "isoCurrency": "EUR", "urlProspectus": "https://www.hsbc-zertifikate.de/x", **details},
        "derivativesFigure": {"gearingAsk": 9.24, "leverageAsk": None, "spreadAskPct": 1.29, "premiumAsk": -4.5,
                              "isoCurrencyUnderlying": "EUR"},
        "derivativesUnderlyingList": {"list": [{
            "instrument": {"entityType": "STOCK", "entityValue": "82849", "isin": "DE0007164600", "name": "SAP"},
            "shortName": "SAP SE", "coverRatio": 0.1,
            "derivativesBarrierList": {"list": [{"typeBarrier": t, "barrier": b} for t, b in barriers]},
        }]},
    }


class TestParse:
    def test_finder_row_warrant(self):
        r = onvista.parse_row(finder_row())
        assert r["isin"] == "DE000WB2BFV9" and r["wkn"] == "WB2BFV" and r["id"] == "344317620"
        assert r["kind"] == "os" and r["call"] is True and r["tr"] is True and r["issuer"] == "UBS"
        assert r["strike"] == 230 and r["barrier"] is None and r["ratio"] == 0.1 and r["expiry"] == "2027-03-19"
        assert r["leverage"] == pytest.approx(7.03)  # Omega, nicht der einfache Hebel
        assert r["iv"] == pytest.approx(0.351) and r["spread"] == pytest.approx(0.023) and r["premium"] == pytest.approx(0.133)
        assert (r["bid"], r["ask"], r["ccy"]) == (1.26, 1.29, "EUR")

    def test_finder_row_knockout_put_from_other_issuer(self):
        r = onvista.parse_row(finder_row(
            instrument={"entitySubType": "KNOCKOUT_CERTIFICATE", "isin": "DE000LX950W9", "wkn": "LX950W"},
            issuer={"id": 53156, "name": "Lang & Schwarz"}, codeExerciseRight="P", knockOutAbs=224.0, strikeAbs=224.0,
            dateMaturity=None, openEnded=True, gearingAsk=14.9, leverage=None, quote={"bid": 1.34}))
        assert r["kind"] == "ko" and r["call"] is False and r["tr"] is False
        assert r["barrier"] == 224 and r["open_end"] and r["expiry"] is None
        assert r["leverage"] == pytest.approx(14.9)  # beim Knock-out der einfache Hebel
        assert r["ask"] is None and r["bid"] == 1.34 and r["ccy"] == "EUR"

    def test_finder_row_reference_price_from_distance(self):
        # onvista gibt den Abstand in Richtung Gewinn an: Call (Kurs − Basispreis) / Kurs, Put umgekehrt
        call = onvista.parse_row(finder_row(strikeAbs=170.0, differenceStrikePct=20.7089552239, codeExerciseStyle="A",
                                            dateFirstTrading="2026-02-02T12:00:00.000+00:00",
                                            quote={"ask": 4.45, "performancePct": -4.5}))
        assert call["under_price"] == pytest.approx(214.4) and call["american"] is True
        assert call["first_day"] == "2026-02-02" and call["change"] == pytest.approx(-0.045)
        put_ko = onvista.parse_row(finder_row(instrument={"entitySubType": "KNOCKOUT_CERTIFICATE"}, codeExerciseRight="P",
                                              strikeAbs=400.66578, knockOutAbs=400.66578, differenceKnockOutPct=86.8776958955))
        assert put_ko["under_price"] == pytest.approx(214.4)
        assert onvista.parse_row(finder_row())["under_price"] is None  # ohne Abstand kein Kurs

    def test_snapshot_mini_future_has_barrier_before_strike(self):
        p = onvista.parse_product(snapshot())
        assert p["kind"] == "ko" and p["tr"] and p["sub"] == "Knock-Out mit Stop Loss"
        assert p["strike"] == pytest.approx(190.0928) and p["barrier"] == pytest.approx(196.746)
        assert p["ratio"] == 0.1 and p["open_end"] and p["expiry"] is None and p["american"]
        assert p["leverage"] == pytest.approx(9.24) and p["spread"] == pytest.approx(0.0129)
        assert p["under"] == {"isin": "DE0007164600", "name": "SAP SE", "type": "STOCK", "id": "82849"}

    def test_snapshot_warrant_without_knockout(self):
        s = snapshot("WARRANT", barriers=(("STRIKE", 170.0),), datetimeMaturity="2026-12-18T12:00:00.000+00:00",
                     openEnded=False, codeExerciseRight="P")
        s["derivativesFigure"].update(leverageAsk=4.76, gearingAsk=4.82, impliedVolatilityAsk=26.9)
        p = onvista.parse_product(s)
        assert p["kind"] == "os" and p["call"] is False and p["strike"] == 170 and p["barrier"] is None
        assert p["expiry"] == "2026-12-18" and p["leverage"] == pytest.approx(4.76) and p["iv"] == pytest.approx(0.269)

    def test_snapshot_turbo_without_strike_barrier_uses_knockout(self):
        p = onvista.parse_product(snapshot(barriers=(("KNOCK_OUT", 224.0),)))
        assert p["barrier"] == 224 and p["strike"] is None


class TestQuery:
    def test_warrant_call_for_trade_republic(self):
        q = onvista.query_parameters("os", True, {"tr": True, "leverage": (5, 10), "maturity": ("2026-10-24", None),
                                                  "strike": (None, 220.5), "issuer": 53882})
        assert q == ("entitySubType=WARRANT&idExerciseRight=2&brokerId=8260&idIssuer=53882&strikeAbsRange=;220.5&"
                     "leverageRange=5;10&dateMaturityRange=2026-10-24;&")

    def test_knockout_put_uses_its_own_filter_names(self):
        q = onvista.query_parameters("ko", False, {"tr": False, "leverage": (20, None), "open_end": True,
                                                   "stop_loss": True, "ko_distance": (0.05, 0.1)})
        assert q == ("entitySubType=KNOCKOUT_CERTIFICATE&idExerciseRight=1&gearingAskRange=20;&openEnded=1&"
                     "feature=STOP_LOSS&differenceKnockOutPctRange=5;10&")

    def test_filters_from_request(self):
        today = dt.date(2026, 10, 24)
        f = derivate.filters_from({"laufzeit": "6m", "hebel": "20+", "von": "200", "bis": "220,5"}, "os", today)
        assert f["tr"] is True and f["leverage"] == (20, None) and f["strike"] == (200, 220.5)
        assert f["maturity"] == ("2027-01-23", "2027-04-25")
        assert derivate.filters_from({}, "os", today)["maturity"] == ("2026-10-24", None)  # nie abgelaufene
        k = derivate.filters_from({"tr": "0", "laufzeit": "open", "ko": "turbo", "abstand": "10", "emittent": "54101"}, "ko", today)
        assert k == {"tr": False, "issuer": 54101, "open_end": True, "stop_loss": False, "ko_distance": (0.05, 0.10)}
        assert derivate.filters_from({"hebel": "unsinn", "laufzeit": "x"}, "ko", today) == {"tr": True, "open_end": None, "stop_loss": None}

    @pytest.mark.parametrize("bad", ["abc", "-5"])
    def test_filters_reject_bad_strike(self, bad):
        with pytest.raises(InvalidInput):
            derivate.filters_from({"von": bad}, "os")

    def test_filters_own_ranges_win_over_presets(self):
        today = dt.date(2026, 10, 24)
        f = derivate.filters_from({"hebel": "10", "hebel_von": "7", "faellig_von": "2026-01-01", "faellig_bis": "2027-06-30"}, "os", today)
        assert f["leverage"] == (7, None) and f["maturity"] == ("2026-10-24", "2027-06-30")  # nie abgelaufene
        k = derivate.filters_from({"abstand": "5", "abstand_von": "2", "abstand_bis": "4,5", "hebel_bis": "20"}, "ko", today)
        assert k["ko_distance"] == pytest.approx((0.02, 0.045)) and k["leverage"] == (None, 20)
        with pytest.raises(InvalidInput):
            derivate.filters_from({"faellig_bis": "morgen"}, "os", today)

    def test_ranges_stay_exact(self):
        # beim Laden in Abschnitten beginnt der nächste genau beim letzten Basispreis
        q = onvista.query_parameters("ko", True, {"strike": (216.3176, None)})
        assert "strikeAbsRange=216.3176;&" in q


class TestMapping:
    def test_index_and_world_isins(self, monkeypatch):
        seen = []
        monkeypatch.setattr(onvista, "underlying", lambda isin: seen.append(isin) or (
            {"type": "STOCK", "id": "82849", "name": "SAP", "isin": isin} if isin == "DE0007164600" else None))
        monkeypatch.setattr(world, "isins", lambda sym: ["US0000000001", "DE0007164600"])
        monkeypatch.setattr(yahoo, "isin", lambda sym: pytest.fail("Yahoo nur ohne andere ISIN fragen"))
        assert derivate.underlying_for("SAP.DE")["id"] == "82849"
        assert seen == ["US0000000001", "DE0007164600"]  # falsche ISIN fällt heraus, die nächste passt
        seen.clear()
        assert derivate.underlying_for("SAP.DE")["id"] == "82849" and seen == []  # Treffer liegt im Cache
        monkeypatch.setattr(onvista, "underlying", lambda isin: {"type": "INDEX", "id": "20735", "isin": isin} if isin == "DE0008469008" else None)
        assert derivate.underlying_for("^GDAXI")["id"] == "20735"

    def test_misses_are_not_cached(self, monkeypatch):
        calls = []
        monkeypatch.setattr(world, "isins", lambda sym: [])
        monkeypatch.setattr(yahoo, "isin", lambda sym: calls.append(sym) or None)
        assert derivate.underlying_for("NEU.DE") is None
        assert derivate.underlying_for("NEU.DE") is None
        assert calls == ["NEU.DE", "NEU.DE"]

    def test_symbol_for_isin(self, monkeypatch):
        monkeypatch.setattr(world, "symbol_for_isin", lambda isin: "SAP.DE" if isin == "DE0007164600" else None)
        monkeypatch.setattr(yahoo, "search", lambda q, limit=10: [{"symbol": "ASML.AS"}] if q == "NL0010273215" else [])
        assert derivate.symbol_for("DE0008469008") == "^GDAXI"
        assert derivate.symbol_for("DE0007164600") == "SAP.DE"
        assert derivate.symbol_for("NL0010273215") == "ASML.AS"
        assert derivate.symbol_for("XX0000000000") is None and derivate.symbol_for(None) is None


class TestProduct:
    def test_rejects_bad_input_and_non_derivatives(self, monkeypatch):
        with pytest.raises(InvalidInput):
            derivate.product("DE00071")
        monkeypatch.setattr(onvista, "lookup", lambda q: {"type": "STOCK", "id": "82849"})
        with pytest.raises(onvista.NotFound):
            derivate.product("DE0007164600")

    def test_loads_product_with_ticker_and_euro_rate(self, monkeypatch):
        monkeypatch.setattr(onvista, "lookup", lambda q: {"type": "DERIVATIVE", "id": "999", "isin": "DE000HF1RPM0"})
        monkeypatch.setattr(onvista, "product", lambda pid: onvista.parse_product(snapshot()))
        monkeypatch.setattr(world, "symbol_for_isin", lambda isin: "SAP.DE")
        p = derivate.product(" hf1rpm ")
        assert p["under"]["symbol"] == "SAP.DE" and p["eur_under"] == 1.0 and p["isin"] == "DE000HF1RPM0"


class TestEnrichAndOverview:
    def test_reference_price_from_gearing(self, monkeypatch):
        from aktientool.sources import fx
        rates = {"USD": 0.8925, "EUR": 1.0}  # wie fx.eur_quotes: Euro selbst ist immer dabei
        monkeypatch.setattr(fx, "eur_quotes", lambda ccys: {c: {"rate": rates[c]} for c in ccys if c in rates})
        rows = [
            {"under_ccy": "USD", "gearing": 207.08, "ask": 0.15, "ratio": 0.1, "quanto": False},  # Apple: 310,6 € = 348 USD
            {"under_ccy": "USD", "gearing": 5.0, "ask": None, "bid": 1.0, "ratio": 0.1, "quanto": False},  # ohne Brief
            {"under_ccy": "USD", "gearing": 5.0, "ask": 1.0, "ratio": 0.1, "quanto": True},  # Quanto: unklar, also nicht
            {"under_ccy": "EUR", "under_price": 214.4, "gearing": 9.0, "ask": 2.0, "ratio": 0.1},  # Snapshot liefert ihn
        ]
        out = derivate._enrich(rows)
        assert out[0]["eur_under"] == 0.8925 and out[0]["under_price"] == pytest.approx(348.0, abs=0.1)
        assert out[1].get("under_price") is None and out[2].get("under_price") is None
        assert out[3]["under_price"] == 214.4 and out[3]["eur_under"] == 1.0

    def test_overview_counts_and_typical_products(self, monkeypatch):
        calls = []

        def products(utype, uid, kind, call, filters, sort=None, order="ASC", page=0, per_page=100):
            calls.append((kind, call, filters, sort, per_page))
            return {"total": 1000 if per_page == 1 else 40, "rows": [] if per_page == 1 else [{"under_ccy": "EUR"}]}
        monkeypatch.setattr(derivate, "underlying_for", lambda sym: {"type": "STOCK", "id": "82849", "name": "SAP", "isin": "DE0007164600"})
        monkeypatch.setattr(onvista, "products", products)
        res = derivate.overview("SAP.DE", tr=True, today=dt.date(2026, 10, 24))
        assert [(g["art"], g["typ"], g["total"], g["typical"]) for g in res["groups"]] == [
            ("os", "call", 1000, 40), ("os", "put", 1000, 40), ("ko", "call", 1000, 40), ("ko", "put", 1000, 40)]
        typical_os = next(c for c in calls if c[0] == "os" and c[4] == 100)
        assert typical_os[2] == {"tr": True, "leverage": (5, 10), "maturity": ("2027-01-23", "2027-10-24")}
        assert typical_os[3] == "spreadAskPct"
        count_ko = next(c for c in calls if c[0] == "ko" and c[4] == 1)
        assert count_ko[2] == {"tr": True}
        assert len(calls) == 8
        monkeypatch.setattr(derivate, "underlying_for", lambda sym: None)
        assert derivate.overview("XYZ") == {"under": None, "groups": []}


class TestAllProducts:
    """Der Finder gibt je Abfrage höchstens 1.000 Zeilen heraus; all_products lädt mehr in Abschnitten nach Basispreis."""

    @staticmethod
    def fake_finder(monkeypatch, strikes, spot=100.0):
        data = [{"isin": f"DE{i:010d}", "strike": k, "under_price": spot} for i, k in enumerate(strikes)]
        calls = []

        def products(utype, uid, kind, call, filters, sort=None, order="ASC", page=0, per_page=100):
            calls.append((filters.get("strike"), order, page))
            if page >= 10:
                raise onvista.NotFound("Seite")
            lo, hi = filters.get("strike") or (None, None)
            rows = [r for r in data if (lo is None or r["strike"] >= lo) and (hi is None or r["strike"] <= hi)]
            rows.sort(key=lambda r: (r["strike"], r["isin"]), reverse=order == "DESC")
            return {"total": len(rows), "rows": [dict(r) for r in rows[page * per_page:(page + 1) * per_page]]}
        monkeypatch.setattr(onvista, "products", products)
        return calls

    def test_small_list_in_parallel_pages(self, monkeypatch):
        calls = self.fake_finder(monkeypatch, [50 + i * 0.1 for i in range(250)])
        res = onvista.all_products("STOCK", "1", "os", True, {"tr": True})
        assert res["total"] == 250 and res["complete"] and len(res["rows"]) == 250 and res["spot"] == 100
        assert sorted(c[2] for c in calls) == [0, 1, 2]

    def test_more_than_limit_from_the_price_outwards(self, monkeypatch):
        # 2.500 Produkte, darunter 30 mit demselben Basispreis genau an einer Abschnittsgrenze
        strikes = [10 + i * 0.1 for i in range(2470)] + [100.0] * 30
        self.fake_finder(monkeypatch, strikes)
        res = onvista.all_products("STOCK", "1", "ko", True, {"tr": True})
        assert res["complete"] and res["total"] == 2500
        assert len(res["rows"]) == 2500 and len({r["isin"] for r in res["rows"]}) == 2500

    def test_cap_keeps_products_nearest_the_price(self, monkeypatch):
        self.fake_finder(monkeypatch, [i * 1.0 for i in range(1, 3001)], spot=1500.0)
        res = onvista.all_products("STOCK", "1", "ko", False, {}, cap=1200)
        assert not res["complete"] and res["total"] == 3000 and len(res["rows"]) == 1200
        strikes = sorted(r["strike"] for r in res["rows"])
        assert strikes[0] >= 1000 and strikes[-1] <= 2250 and 1500.0 in strikes  # nach prozentualem Abstand

    def test_user_strike_range_is_respected(self, monkeypatch):
        calls = self.fake_finder(monkeypatch, [i * 1.0 for i in range(1, 3001)], spot=1500.0)
        res = onvista.all_products("STOCK", "1", "os", True, {"strike": (1600.0, 2900.0)})
        assert res["complete"] and len(res["rows"]) == 1301
        assert all(1600 <= r["strike"] <= 2900 for r in res["rows"])
        assert all(c[1] == "ASC" for c in calls)  # der Kurs liegt unter dem Bereich: nur nach oben

    def test_listing_all_drops_unused_fields_and_is_cached(self, monkeypatch):
        loads = []
        monkeypatch.setattr(derivate, "underlying_for", lambda sym: {"type": "STOCK", "id": "82849", "name": "SAP", "isin": "DE0007164600"})
        monkeypatch.setattr(derivate, "_eur_rates", lambda ccys: {"EUR": 1.0})
        monkeypatch.setattr(onvista, "all_products", lambda *a: loads.append(a) or {
            "total": 1, "complete": True, "spot": 214.4,
            "rows": [{"isin": "DE000X", "name": "lang", "url": "u", "doc": "d", "id": "1", "gearing": 5.0, "ccy": "EUR",
                      "under_ccy": "EUR", "strike": 200.0, "under_price": 214.4}]})
        res = derivate.listing_all("SAP.DE", "ko", True, {"tr": True})
        assert res["under"]["isin"] == "DE0007164600" and res["complete"]
        assert set(res["rows"][0]) == {"isin", "under_ccy", "strike", "under_price", "eur_under"}
        derivate.listing_all("SAP.DE", "ko", True, {"tr": True})
        assert len(loads) == 1
