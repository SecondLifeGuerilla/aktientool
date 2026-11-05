"""Tests für Trusts, Closed-End-Fonds und Holdings: Parser der Quellen, Schwerpunkte, innerer Wert der Holdings,
Fondszeilen und eigene Holdings. Alle ohne Netzwerk."""

import datetime as dt
import io
import json

import pytest

from aktientool import config, trusts, userdata
from aktientool.cache import store
from aktientool.sources import aic, morningstar, nport


def aic_html(rows, day="22/10/2026"):
    settings = {"aic": {"dataAsAt": day, "basic": rows}}
    return f'<html><script type="application/json" data-drupal-selector="drupal-settings-json">{json.dumps(settings)}</script></html>'


def aic_row(isin, sector="Technology & Technology Innovation", **extra):
    return {"ISIN": isin, "Sector": sector, "ClosingPrice": 606.5, "NAVFAIRCUM": 666.6, "DiscFairCum": -9.02,
            "Disc1YAvgCF": "-8.9", "Disc3YAvgCF": "-9.89", "Disc5YAvgCF": "-10.53",
            "OneyrHighCumFairDiscount": "-5.02", "OneyrLowCumFairDiscount": "-13.31", "NetGearCum": 0,
            "OngoingCharge": "0.69", "NetDivYld": 0, "CALC_NAVTR5Y_A": 19.58, "GearRangeFrom": "N/A", **extra}


class TestAic:
    def test_parse_converts_percentages_and_skips_vcts(self):
        rows = [aic_row("GB0001"), aic_row("GB0002", sector="VCT Generalist")] + [aic_row(f"GB1{i:03d}") for i in range(100)]
        data = aic.parse(aic_html(rows))
        assert data["date"] == "2026-10-22"
        assert "GB0002" not in data["trusts"] and data["vct"] == ["GB0002"]
        t = data["trusts"]["GB0001"]
        assert t["sector"] == "Technologie" and t["sector_en"] == "Technology & Technology Innovation"
        assert t["disc"] == pytest.approx(-0.0902) and t["disc_avg5"] == pytest.approx(-0.1053)
        assert t["disc_range1"] == pytest.approx([-0.1331, -0.0502])  # größter Abschlag zuerst
        assert t["ocf"] == pytest.approx(0.0069) and t["gearing"] == 0

    def test_parse_rejects_changed_page(self):
        with pytest.raises(RuntimeError):
            aic.parse("<html>nichts</html>")
        with pytest.raises(RuntimeError):
            aic.parse(aic_html([aic_row("GB0001")]))  # viel zu wenige Trusts: Seite hat sich geändert


class TestMorningstar:
    def test_yahoo_symbol(self):
        assert morningstar.yahoo_symbol("PCT", "XLON") == "PCT.L"
        assert morningstar.yahoo_symbol("BION", "XSWX") == "BION.SW"
        assert morningstar.yahoo_symbol("ADX", "XNYS") == "ADX"
        assert morningstar.yahoo_symbol("BRK.B", "XNYS") == "BRK-B"
        assert morningstar.yahoo_symbol(None, "XLON") is None
        assert morningstar.yahoo_symbol("X", "XTKS") is None  # Börse ohne bekannte Endung


class TestGroups:
    @pytest.mark.parametrize("text, group", [
        ("Technology & Technology Innovation", "Aktien"), ("Global Equity Income", "Aktien"), ("Large Blend", "Aktien"),
        ("Private Equity", "Private Equity"), ("Growth Capital", "Private Equity"), ("Property - UK Commercial", "Immobilien"),
        ("Renewable Energy Infrastructure", "Infrastruktur & Energie"), ("Debt - Direct Lending", "Anleihen & Kredite"),
        ("Multisector Bond", "Anleihen & Kredite"), ("Equity Precious Metals", "Rohstoffe"), ("Hedge Funds", "Mischanlage & Alternativ"),
        ("Utilities", "Aktien"), (None, "Aktien"),
    ])
    def test_group_of(self, text, group):
        assert trusts.group_of(text) == group


NPORT_XML = b"""<?xml version="1.0"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/nport"><formData>
  <genInfo><repPdDate>2026-06-30</repPdDate></genInfo>
  <fundInfo><netAssets>1000000</netAssets></fundInfo>
  <invstOrSecs>
    <invstOrSec><name>Apple Inc.</name><title>Apple Inc.</title><identifiers><isin value="US0378331005"/></identifiers>
      <valUSD>60000</valUSD><pctVal>6.0</pctVal><assetCat>EC</assetCat></invstOrSec>
    <invstOrSec><name>N/A</name><title>Midwave Wireless Term Loan</title><valUSD>90000</valUSD><pctVal>9.0</pctVal><assetCat>LON</assetCat></invstOrSec>
    <invstOrSec><name>Small Co</name><title>Small Co</title><valUSD>1000</valUSD><pctVal>0.1</pctVal></invstOrSec>
  </invstOrSecs></formData></edgarSubmission>"""


class TestNport:
    def test_parse_sorts_by_weight_and_replaces_placeholders(self, monkeypatch):
        monkeypatch.setattr(nport, "TOP", 2)
        out = nport.parse(io.BytesIO(NPORT_XML))
        assert out["date"] == "2026-06-30" and out["count"] == 3 and out["net_assets_usd"] == 1_000_000
        assert [h["name"] for h in out["holdings"]] == ["Midwave Wireless Term Loan", "Apple Inc."]
        assert out["holdings"][0]["title"] is None and out["holdings"][0]["weight"] == pytest.approx(0.09)
        assert out["holdings"][1]["isin"] == "US0378331005" and out["holdings"][1]["kind"] == "EC"


# ---------------------------------------------------------------- Holdings: innerer Wert

@pytest.fixture
def no_world(monkeypatch):
    monkeypatch.setattr(trusts.world, "trade_republic", lambda sym, isin: {"tradable": True})
    monkeypatch.setattr(trusts.world, "stock", lambda sym: None)


def holding_def(**extra):
    return {"symbol": "HOLD.DE", "name": "Holding", "currency": "EUR", "as_of": "2026-06-30", "shares": 100,
            "positions": [{"name": "A", "symbol": "A.DE", "shares": 10}, {"name": "B", "symbol": "B.SW", "value": 500}],
            "other": [{"name": "Kasse", "value": 100}, {"name": "Schulden", "value": -300}], **extra}


class TestHolding:
    def test_nav_from_live_prices(self, no_world, monkeypatch):
        # B war am Stichtag 50 CHF wert (1 CHF = 1 €), 500 € Wert → 10 Stück; heute 60 CHF, 1 CHF = 1,05 €
        monkeypatch.setattr(trusts, "_close_on", lambda sym, day: 50.0)
        monkeypatch.setattr(trusts, "_eur_on", lambda ccy, day: 1.0)
        quotes = {"A.DE": {"regularMarketPrice": 80.0, "currency": "EUR"}, "B.SW": {"regularMarketPrice": 60.0, "currency": "CHF"},
                  "HOLD.DE": {"regularMarketPrice": 9.0, "currency": "EUR"}}
        row = trusts._holding(holding_def(), quotes, {"EUR": 1.0, "CHF": 1.05}, detail=True)
        nav = 10 * 80 + 10 * 60 * 1.05 + 100 - 300
        assert row["nav_eur_total"] == pytest.approx(nav)
        assert row["nav_eur"] == pytest.approx(nav / 100)
        assert row["disc"] == pytest.approx(9.0 / (nav / 100) - 1)
        assert row["listed_share"] == pytest.approx((800 + 630) / (800 + 630 + 100))  # Schulden nicht abgezogen
        assert row["top"] == ["A", "B"] and row["tr"] == 1 and not row["stale"]
        b = next(p for p in row["positions"] if p["symbol"] == "B.SW")
        assert b["shares"] == pytest.approx(10) and row["definition"]["positions"][1]["shares"] == 10

    def test_missing_quote_falls_back_to_reported_value(self, no_world, monkeypatch):
        monkeypatch.setattr(trusts, "_close_on", lambda sym, day: None)
        monkeypatch.setattr(trusts, "_eur_on", lambda ccy, day: 1.0)
        quotes = {"A.DE": {"regularMarketPrice": 80.0, "currency": "EUR"}, "HOLD.DE": {"regularMarketPrice": 9.0, "currency": "EUR"}}
        row = trusts._holding(holding_def(), quotes, {"EUR": 1.0})
        assert row["stale"] == ["B"]
        assert row["nav_eur"] == pytest.approx((800 + 500 + 100 - 300) / 100)

    def test_curated_definitions_are_consistent(self):
        """Jede mitgelieferte Holding: Pflichtfelder vorhanden, und am Stichtag ergeben die Werte den gemeldeten NAV
        (bei Positionen mit Stückzahl lässt sich das ohne Kurse nicht prüfen, dort nur die Felder)."""
        data = json.loads(config.HOLDINGS_FILE.read_text("utf-8"))["holdings"]
        assert len(data) >= 5
        for d in data:
            assert d["symbol"] and d["currency"] and d["as_of"] and d["shares"] > 0 and d["positions"]
            assert all(("shares" in p) != ("value" in p) for p in d["positions"]), d["symbol"]
            if all("value" in p for p in d["positions"]) and d.get("nav_reported"):
                total = sum(p["value"] for p in d["positions"]) + sum(o["value"] for o in d["other"])
                assert total == pytest.approx(d["nav_reported"], rel=0.002), d["symbol"]


class TestOwnHoldings:
    def test_context_holding_overrides_curated(self):
        item = userdata.clean_holding_def("PAH3.DE", {
            "currency": "eur", "as_of": "2026-09-30", "shares": "306250000", "name": "Porsche SE",
            "positions": [{"symbol": "vow.de", "shares": "157000000", "name": "VW"}],
            "other": [{"name": "Nettoverschuldung", "value": "-4900000000"}]})
        assert item["currency"] == "EUR" and item["positions"][0]["symbol"] == "VOW.DE"
        with userdata.use_context({"holdings": {"PAH3.DE": item}}):
            d = next(x for x in trusts.definitions() if x["symbol"] == "PAH3.DE")
            assert d["custom"] and d["replaces_default"] and d["as_of"] == "2026-09-30"
        d = next(x for x in trusts.definitions() if x["symbol"] == "PAH3.DE")
        assert not d["custom"]

    @pytest.mark.parametrize("bad", [
        {"currency": "EURO"}, {"as_of": ""}, {"shares": "0"}, {"positions": [{"symbol": "X X", "shares": 1}]},
        {"other": [{"name": "x", "value": "NaN"}]}, {"positions": [], "other": []},
    ])
    def test_rejects_bad_input(self, bad):
        base = {"currency": "EUR", "as_of": "2026-09-30", "shares": 10, "positions": [{"symbol": "A.DE", "shares": 1}], "other": []}
        with pytest.raises(userdata.InvalidInput):
            userdata.clean_holding_def("NEW.DE", {**base, **bad})


class TestFundRows:
    def test_rows_in_euro_with_usual_discount_and_tradability(self, monkeypatch):
        store(trusts.FUNDS_KEY, {"funds": [
            {"sec_id": "S1", "isin": "GB00BR3YV268", "name": "Polar", "symbol": "PCT.L", "exchange": "XLON", "country": "GB",
             "currency": "GBp", "price": 600.0, "nav": 660.0, "disc": -0.09, "disc_avg5": -0.105, "group": "Aktien",
             "cap": 6.6e9, "cap_currency": "GBP"},
            {"sec_id": "S2", "isin": "CH0038389992", "name": "BB Biotech", "symbol": "BION.SW", "exchange": "XSWX", "country": "CH",
             "currency": "CHF", "price": 50.0, "nav": 57.5, "disc": -0.13, "group": "Private Equity", "cap_eur": 3e9},
        ]})
        monkeypatch.setattr(trusts, "_rates", lambda ccys: {"GBp": 0.0119, "GBP": 1.19, "CHF": 1.06})
        monkeypatch.setattr(trusts.lsx, "current", lambda: {"isins": {"GB00BR3YV268": ["A40JS4", "POLAR", "AKTIE"]}})
        monkeypatch.setattr(trusts.userdata, "tradable_overrides", lambda: {})
        rows = {r["symbol"]: r for r in trusts.fund_rows()}
        pct, bion = rows["PCT.L"], rows["BION.SW"]
        assert pct["price_eur"] == pytest.approx(600 * 0.0119) and pct["cap_eur"] == pytest.approx(6.6e9 * 1.19)
        assert pct["disc_usual"] == pytest.approx(-0.105) and pct["usual_basis"] == "5 J."
        assert pct["tr"] == 1 and bion["tr"] == 0
        assert bion["disc_usual"] is None and bion["appraised"] and bion["cap_eur"] == 3e9
        assert trusts.find("XYZ", "CH0038389992")["symbol"] == "BION.SW"  # Profil findet den Fonds auch über die ISIN


# ---------------------------------------------------------------- Verlauf des Abschlags

class TestHistory:
    def test_discount_series_carries_nav_forward_until_too_old(self):
        prices = [["2026-01-02", 90.0], ["2026-01-05", 95.0], ["2026-03-01", 99.0], ["2026-06-01", 80.0]]
        navs = [["2026-01-02", 100.0], ["2026-03-01", 110.0]]
        out = trusts.discount_series(prices, navs, max_age=60)
        assert out == [["2026-01-02", -0.1], ["2026-01-05", -0.05], ["2026-03-01", -0.1]]  # Juni: NAV über 60 Tage alt

    def test_discount_series_drops_outliers(self):
        assert trusts.discount_series([["2026-01-02", 1.0]], [["2026-01-02", 100.0]]) == []

    def test_history_stats(self):
        points = [[f"2025-{m:02d}-{d:02d}", v] for m in range(1, 13) for d, v in ((1, -0.10), (15, -0.20))]
        points.append(["2026-01-01", -0.15])
        s = trusts.history_stats(points, 1)
        assert s["min"] == -0.20 and s["max"] == -0.10 and s["avg"] == pytest.approx(-0.15, abs=0.003)
        assert s["share_larger"] == pytest.approx(0.5, abs=0.03)  # an der Hälfte der Tage war der Abschlag größer
        assert s["complete"] and s["to"] == "2026-01-01"
        assert not trusts.history_stats(points, 5)["complete"]  # Daten reichen nur ein Jahr zurück
        assert trusts.history_stats(points[:5], None) is None  # zu wenige Punkte

    def test_holding_history_rebuilds_nav_and_prefers_recorded_values(self, monkeypatch, tmp_path):
        monkeypatch.setattr(config, "SNAPSHOT_DIR", tmp_path)
        days = [(dt.date.today() - dt.timedelta(days=i)).isoformat() for i in range(30, 0, -1)]
        closes = {"HOLD.DE": [[d, 9.0] for d in days], "A.DE": [[d, 80.0] for d in days], "B.SW": [[d, 60.0] for d in days[5:]]}
        monkeypatch.setattr(trusts, "_closes", lambda sym: closes[sym])
        monkeypatch.setattr(trusts, "_live_quotes", lambda syms: {"HOLD.DE": {"currency": "EUR"}, "A.DE": {"currency": "EUR"}, "B.SW": {"currency": "CHF"}})
        monkeypatch.setattr(trusts.fx, "eur_history", lambda major: [["2000-01-01", 1.05]])
        monkeypatch.setattr(trusts, "_close_on", lambda sym, day: 50.0)
        monkeypatch.setattr(trusts, "_eur_on", lambda ccy, day: 1.0)
        h = trusts.holding_history(holding_def())
        nav_ps = (10 * 80 + 10 * 60 * 1.05 + 100 - 300) / 100
        assert len(h["points"]) == 30  # B ging erst später an die Börse: davor gilt ihr erster Kurs
        assert h["points"][0][1] == pytest.approx(9.0 / nav_ps - 1, abs=1e-5)
        assert h["stats"]["max"]["avg"] == pytest.approx(9.0 / nav_ps - 1, abs=1e-5) and h["recorded_from"] is None
        (tmp_path / trusts.RECORD_FILE).write_text(json.dumps({"HOLD.DE": {days[-1]: -0.5}}))
        h = trusts.holding_history(holding_def())
        assert h["points"][-1] == [days[-1], -0.5] and h["recorded_from"] == days[-1]

    def test_record_keeps_last_value_of_the_day(self, monkeypatch, tmp_path):
        monkeypatch.setattr(config, "SNAPSHOT_DIR", tmp_path)

        class Weekday(dt.date):
            @classmethod
            def today(cls):
                return cls(2026, 10, 21)  # Mittwoch
        monkeypatch.setattr(trusts.dt, "date", Weekday)
        trusts._record([{"symbol": "X", "disc": -0.2}, {"symbol": "Y", "disc": -0.1, "stale": ["B"]}])
        trusts._record([{"symbol": "X", "disc": -0.25}])
        assert trusts._recorded() == {"X": {"2026-10-21": -0.25}}  # Y mit fehlendem Kurs wird nicht gespeichert
