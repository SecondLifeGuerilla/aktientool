"""Tests der Erweiterungen: ESEF, Leerverkäufe, Qualitätssignale, Reverse-DCF, Steuern, Bewertungsvarianten,
Tagesstände, Tiefenanalyse, Alarme und Nutzerdaten. Alle ohne Netzwerk."""

import gzip
import json

import pandas as pd
import pytest

from aktientool import alerts, config, deep, snapshots, userdata
from aktientool.analysis import dcf, fundamentals, tax, valuation
from aktientool.sources import esef, shorts


def price_series(start="2010-01-01", end="2025-12-31", fn=lambda t: 100.0):
    idx = pd.bdate_range(start, end)
    t = (idx - idx[0]).days / 365.25
    return pd.Series([fn(x) for x in t], index=idx)


def rows(key, values, start=2012):
    return [{"end": pd.Timestamp(year=start + i, month=12, day=31), "eps": None, "eps_adj": None, "ocf_ps": None,
             "rev_ps": None, key: v} for i, v in enumerate(values)]


# ---------------------------------------------------------------- ESEF

def fact(concept, value, period, unit="iso4217:EUR", **extra):
    return {"value": str(value), "dimensions": {"concept": concept, "entity": "scheme:X", "period": period, "unit": unit, **extra}}


class TestEsef:
    def test_extract_takes_annual_values_without_segments(self):
        doc = {"facts": {
            "a": fact("ifrs-full:Revenue", 100, "2023-01-01T00:00:00/2024-01-01T00:00:00"),
            "b": fact("ifrs-full:Revenue", 90, "2022-01-01T00:00:00/2023-01-01T00:00:00"),
            "c": fact("ifrs-full:Revenue", 40, "2023-01-01T00:00:00/2024-01-01T00:00:00", **{"ifrs-full:SegmentsAxis": "x"}),
            "d": fact("ifrs-full:Revenue", 25, "2023-07-01T00:00:00/2024-01-01T00:00:00"),  # Halbjahr
            "e": fact("ifrs-full:BasicEarningsLossPerShare", 2.5, "2023-01-01T00:00:00/2024-01-01T00:00:00", "iso4217:EUR/xbrli:shares"),
            "f": fact("ifrs-full:DilutedEarningsLossPerShare", 2.4, "2023-01-01T00:00:00/2024-01-01T00:00:00", "iso4217:EUR/xbrli:shares"),
        }}
        out = esef.extract(doc)
        assert out["revenue"] == {"2023-12-31": {"val": 100.0, "unit": "iso4217:EUR"},
                                  "2022-12-31": {"val": 90.0, "unit": "iso4217:EUR"}}
        assert out["eps"]["2023-12-31"]["val"] == 2.4  # verwässert vor unverwässert

    def test_only_annual_reports_are_used(self):
        filings = [{"end": f"2024-{m:02d}-{d}"} for m, d in ((3, 31), (6, 30), (9, 30), (12, 31))] + [{"end": "2023-12-31"}]
        assert [f["end"] for f in esef.annual_reports(filings, 12)] == ["2024-12-31", "2023-12-31"]
        assert [f["end"] for f in esef.annual_reports(filings, None)] == ["2024-12-31", "2023-12-31"]

    def test_annual_rows_adjust_splits_by_publication_not_archive_date(self, monkeypatch):
        # Bericht für 2020, erst 2024 ins Archiv aufgenommen; Split 2:1 im Jahr 2023
        filing = {"id": "f2020", "end": "2020-12-31", "added": "2024-05-01", "url": "/x.json"}
        values = {"eps": {"2020-12-31": {"val": 18.0, "unit": "iso4217:DKK/xbrli:shares"}},
                  "net_income": {"2020-12-31": {"val": 1800.0, "unit": "iso4217:DKK"}},
                  "shares": {}, "ocf": {}, "capex": {}, "revenue": {}}
        monkeypatch.setattr(esef, "lei_for_isin", lambda isin: "LEI")
        monkeypatch.setattr(esef, "filings", lambda lei: [filing])
        monkeypatch.setattr(esef, "_filing_values", lambda f: values)
        rows_ = esef.annual_rows("DK0000000000", [["2023-09-20", 2.0]], fy_month=12)
        assert rows_[0]["eps"] == pytest.approx(9.0)
        assert rows_[0]["currency"] == "DKK" and rows_[0]["shares"] == pytest.approx(200.0)

    def test_covers_countries(self):
        assert esef.covers("FR0000121014") and not esef.covers("DE000BASF111") and not esef.covers(None)


def test_short_positions_take_latest_report_per_holder():
    csv_text = ('﻿"Positionsinhaber","Emittent","ISIN","Position","Datum"\n'
                '"Fonds A","Beispiel AG","DE0001","0,80","2026-09-01"\n'
                '"Fonds A","Beispiel AG","DE0001","0,60","2026-10-01"\n'
                '"Fonds B","Beispiel AG","DE0001","0,45","2026-10-02"\n').lstrip("﻿")
    out = shorts.parse(csv_text)["DE0001"]
    assert out["total"] == pytest.approx(0.006)  # nur Fonds A (0,60 %), Fonds B unter der Meldeschwelle
    assert out["active"] == 1 and len(out["positions"]) == 2


# ---------------------------------------------------------------- Qualitätssignale

STATEMENTS = {
    "2024-12-31": {"ebit": 100.0, "tax_rate": 0.2, "invested_capital": 500.0, "net_income": 60.0, "total_assets": 1000.0,
                   "ocf": 80.0, "long_term_debt": 300.0, "current_assets": 400.0, "current_liabilities": 300.0,
                   "gross_profit": 400.0, "revenue": 1000.0, "shares_out": 100.0},
    "2025-12-31": {"ebit": 130.0, "tax_rate": 0.2, "invested_capital": 520.0, "net_income": 80.0, "total_assets": 1050.0,
                   "ocf": 110.0, "long_term_debt": 280.0, "current_assets": 450.0, "current_liabilities": 300.0,
                   "gross_profit": 460.0, "revenue": 1100.0, "shares_out": 98.0},
}


class TestFundamentals:
    def test_roic(self):
        r = fundamentals.roic(STATEMENTS, is_financial=False)
        assert r["latest"] == pytest.approx(130 * 0.8 / 520)
        assert fundamentals.roic(STATEMENTS, is_financial=True)["latest"] is None

    def test_piotroski_full_score_for_improving_company(self):
        p = fundamentals.piotroski(STATEMENTS)
        assert p["score"] == 9 and p["checked"] == 9

    def test_piotroski_needs_enough_checks(self):
        thin = {k: {"total_assets": v["total_assets"], "net_income": v["net_income"]} for k, v in STATEMENTS.items()}
        assert fundamentals.piotroski(thin)["score"] is None

    def test_share_trend_detects_buybacks(self):
        annual = [{"end": pd.Timestamp(year=2015 + i, month=12, day=31), "shares": 100 * 0.97 ** i} for i in range(11)]
        assert fundamentals.share_trend(annual)["cagr"] == pytest.approx(-0.03, abs=1e-3)

    def test_revisions_need_confirmation_by_counts(self):
        raw = {"0y": {"now": 10.0, "d30": 10.2, "d90": 9.8, "up30": 1, "down30": 10},
               "+1y": {"now": 11.0, "d30": 11.4, "up30": 0, "down30": 8}}
        r = fundamentals.revisions(raw)
        assert r["trend"] == "fallend" and r["change90"] == pytest.approx(10 / 9.8 - 1)
        up = fundamentals.revisions({"0y": {"now": 10.5, "d30": 10.0, "up30": 5, "down30": 1}})
        assert up["trend"] == "steigend"

    def test_surprises(self):
        s = fundamentals.surprises([{"surprise": 0.05}, {"surprise": -0.02}, {"surprise": None}])
        assert s["beats"] == 1 and s["average"] == pytest.approx(0.015)


class TestDcf:
    def test_implied_growth_reproduces_price(self):
        price = dcf.present_value(5.0, 0.07, 0.09)
        assert dcf.implied_growth(5.0, price, 0.09) == pytest.approx(0.07, abs=1e-6)

    def test_build_uses_average_and_rejects_negative(self):
        d = dcf.build(4.0, [2.0, 3.0, 6.0], price=100.0, is_financial=False)
        assert d["fcf"] == pytest.approx((4 + 3 + 6) / 3) and set(d["rates"]) == {"0.08", "0.09", "0.10"}
        assert dcf.build(-1.0, [-2.0], 100.0, False)["available"] is False
        assert dcf.build(4.0, [], 100.0, True)["available"] is False


class TestTax:
    RATES = {"US": {"satz": 0.15, "anrechenbar": 0.15}, "CH": {"satz": 0.35, "anrechenbar": 0.15}, "DE": {"satz": 0.0, "anrechenbar": 0.0}}

    def test_germany(self):
        assert tax.for_country("DE", self.RATES)["total"] == pytest.approx(0.26375)

    def test_us_withholding_is_credited(self):
        t = tax.for_country("US", self.RATES)
        assert t["total"] == pytest.approx(0.15 + 0.10 * 1.055) and t["refundable"] == 0

    def test_swiss_excess_is_lost_without_refund(self):
        t = tax.for_country("CH", self.RATES)
        assert t["refundable"] == pytest.approx(0.20) and t["total"] == pytest.approx(0.35 + 0.10 * 1.055)

    def test_shipped_rates_file_is_valid(self):
        rates = tax.load_rates()
        assert "US" in rates and all(0 <= r["anrechenbar"] <= r["satz"] or r["satz"] == 0 for r in rates.values())


# ---------------------------------------------------------------- Bewertungsvarianten

class TestValuationVariants:
    def test_cyclical_uses_normalized_earnings(self):
        # Gewinn schwankt stark um 4, der 5-Jahres-Durchschnitt steigt gleichmäßig
        eps = [1.0, 7.0, 2.0, 6.0, 3.0, 7.5, 2.5, 7.0, 3.5, 7.5, 4.0, 8.0, 4.5, 8.5]
        close = price_series(start="2010-01-01", end="2025-12-31", fn=lambda t: 60.0)
        result = valuation.build(close, 60.0, rows("eps", eps), {"eps": 8.0}, {})
        assert result["available"] and result["metric_key"] == "eps_norm" and result["basis_note"] == "normalized"
        assert result["short_history"] is False

    def test_revenue_fallback_for_loss_makers(self):
        close = price_series()
        annual = rows("eps", [-1.0] * 10)
        for r, v in zip(annual, [2 + i / 2 for i in range(10)]):
            r["rev_ps"] = v
        result = valuation.build(close, 100.0, annual, {"eps": -1.0, "rev_ps": 7.0}, {})
        assert result["available"] and result["metric_key"] == "rev_ps" and result["basis_note"] == "revenue"
        assert result["forecasts"] == []  # Analystenschätzungen gelten nicht für den Umsatz

    def test_loss_series_show_no_stability(self):
        close = price_series()
        annual = rows("eps", [-3.0, -2.5, -2.0, -1.5, -1.0, -0.5])
        result = valuation.build(close, 100.0, annual, {"eps": -0.4}, {})
        eps = {s["key"]: s for s in result["stabilities"]}["eps"]
        assert eps["stability"] is None and eps["losses"] and eps["issue"] == "aktuell Verlust"

    def test_revenue_is_not_used_when_earnings_work(self):
        close = price_series(fn=lambda t: 80.0)
        annual = rows("eps", [4.0] * 12)
        for r in annual:
            r["rev_ps"] = 40.0
        result = valuation.build(close, 80.0, annual, {"eps": 4.0, "rev_ps": 40.0}, {})
        assert result["metric_key"] == "eps"
        issue = {s["key"]: s["issue"] for s in result["stabilities"]}["rev_ps"]
        assert issue.startswith("nur Ersatz")

    def test_expected_return_at_fair_value_equals_growth_plus_dividend(self):
        close = price_series(fn=lambda t: 80.0)
        result = valuation.build(close, 80.0, rows("eps", [4.0] * 12), {"eps": 4.0},
                                 {"0y": {"avg": 4.4, "year_ago": 4.0}, "+1y": {"avg": 4.84}}, div_yield=0.02)
        exp = result["expected"]
        assert exp["sources"]["analysts"] == pytest.approx(0.10)
        assert exp["growth"] == pytest.approx((0.10 + 0.0) / 2)  # Historie: 0 % Wachstum
        assert exp["by_period"]["10"] == pytest.approx(0.05 + 0.02, abs=0.003)

    def test_expected_growth_is_capped(self):
        best = {"key": "eps", "growth": 0.60}
        g = valuation.expected_growth(best, {}, short_history=False)
        assert g["growth"] == valuation.GROWTH_RANGE[1]


# ---------------------------------------------------------------- Tagesstände

class TestSnapshots:
    def test_save_load_and_evaluate(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config, "SNAPSHOT_DIR", tmp_path)
        start = [{"symbol": f"S{i}", "price": 100.0, "score_total": i} for i in range(50)]
        end = [{"symbol": f"S{i}", "price": 100.0 * (1 + i / 100)} for i in range(50)]  # höherer Score, höhere Rendite
        assert snapshots.save(start, "2026-01-01") and not snapshots.save(start, "2026-01-01")
        snapshots.save(end, "2026-03-01")
        assert snapshots.dates() == ["2026-01-01", "2026-03-01"]
        r = snapshots.evaluate("2026-01-01", "2026-03-01", "score_total")
        assert r["count"] == 50 and r["days"] == 59
        means = [g["mean"] for g in r["groups"]]
        assert means == sorted(means) and r["spread"] > 0.3
        assert r["rank_correlation"] == pytest.approx(1.0)
        with gzip.open(tmp_path / "2026-01-01.json.gz") as f:
            assert json.load(f)["day"] == "2026-01-01"

    def test_lower_is_better(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config, "SNAPSHOT_DIR", tmp_path)
        snapshots.save([{"symbol": f"S{i}", "price": 10.0, "pe": i + 1} for i in range(20)], "2026-01-01")
        snapshots.save([{"symbol": f"S{i}", "price": 10.0 * (1 - i / 100)} for i in range(20)], "2026-02-01")
        r = snapshots.evaluate("2026-01-01", "2026-02-01", "pe", higher_is_better=False)
        assert r["rank_correlation"] == pytest.approx(1.0)


# ---------------------------------------------------------------- Tiefenanalyse

class TestDeep:
    ROW = {"price": 100.0, "earnings_stability": 0.92, "earnings_growth": 0.08, "quality_years": 10.0, "quality_short": False,
           "fundamentals_source": "SEC EDGAR + Yahoo Finance", "fair_value": 125.0, "deviation": -0.2,
           "rating": {"label": "unterbewertet"}, "expected_return": 0.12, "div_yield": 0.02, "div_streak": 30,
           "debt_infinite": False, "debt_years": 1.5, "scores": {"dividend_income": 6, "dividend_growth": 8, "earnings_growth": 7},
           "piotroski": 7, "net_dividend_share": 0.74}

    def test_compact_and_merge_recompute_with_current_price(self):
        d = deep.compact(self.ROW)
        assert d["src"] == "SEC" and d["rated"] and d["sc_dg"] == 8
        row = {"price": 110.0}
        deep.merge_into(row, d)
        assert row["d_dev"] == pytest.approx(110 / 125 - 1, abs=1e-4)
        # Kurs gestiegen: erwartete Rendite sinkt (Kursanteil über 5 Jahre)
        assert row["d_exp"] == pytest.approx((1 + 0.12 - 0.02) * (100 / 110) ** 0.2 - 1 + 0.02, abs=1e-4)
        assert row["d_streak"] == 30 and row["d_net_yield"] == pytest.approx(0.0148)

    def test_unrated_values_are_not_filterable(self):
        d = deep.compact({**self.ROW, "deviation": None, "rating": {"label": "unsicher (kurze Historie)"}, "quality_short": True})
        row = {"price": 100.0}
        deep.merge_into(row, d)
        assert "d_dev" not in row and "d_exp" not in row and row["d_rating"].startswith("unsicher") and row["d_short"] == 1

    def test_errors_are_skipped(self):
        row = {"price": 1.0}
        deep.merge_into(row, {"t": 1, "err": "x"})
        assert row == {"price": 1.0}

    def test_old_entries_with_stability_but_no_growth_are_renewed(self):
        now = 1_800_000_000
        assert not deep._is_fresh({"t": now, "stab": 0.46}, now)  # vor Version 2, typisch für Verlustreihen
        assert deep._is_fresh({"t": now, "stab": 0.9, "growth": 0.08}, now)
        assert deep._is_fresh({**deep.compact({**self.ROW, "earnings_growth": None}), "t": now}, now)


# ---------------------------------------------------------------- Alarme und Nutzerdaten

class TestAlerts:
    def test_price_and_fair_value_alerts(self):
        assert alerts.evaluate({"type": "price_below", "value": 100, "symbol": "X"}, 99.0, None, None)
        assert not alerts.evaluate({"type": "price_above", "value": 100, "symbol": "X"}, 99.0, None, None)
        row = {"fair_value": 120.0, "deviation": -0.2}
        assert alerts.evaluate({"type": "below_fair", "value": 10, "symbol": "X"}, 100.0, row, None)
        assert not alerts.evaluate({"type": "below_fair", "value": 20, "symbol": "X"}, 100.0, row, None)
        # ohne Einordnung (kurze Historie) kein Bewertungsalarm
        assert not alerts.evaluate({"type": "below_fair", "value": 10, "symbol": "X"}, 100.0, {"fair_value": 120.0, "deviation": None}, None)

    def test_dividend_cut_and_score(self):
        assert alerts.evaluate({"type": "dividend_cut", "baseline": 2.0, "symbol": "X"}, None, {"div_ttm": 1.5}, None)
        assert not alerts.evaluate({"type": "dividend_cut", "baseline": 2.0, "symbol": "X"}, None, {"div_ttm": 2.0}, None)
        assert alerts.evaluate({"type": "score_below", "value": 50, "symbol": "X"}, None, None, {"score_total": 40})


class TestUserdata:
    @pytest.fixture(autouse=True)
    def files(self, tmp_path, monkeypatch):
        for name in ("DEPOT_FILE", "NOTES_FILE", "ALERTS_FILE", "TRADABLE_FILE", "WATCH_GROUPS_FILE"):
            monkeypatch.setattr(config, name, tmp_path / f"{name}.json")

    def test_depot(self):
        items = userdata.add_position("MSFT", {"shares": "10", "price": "400,50", "date": "2024-05-02"})
        assert items[0]["price"] == 400.5 and items[0]["date"] == "2024-05-02"
        with pytest.raises(userdata.InvalidInput):
            userdata.add_position("MSFT", {"shares": "-1", "price": "1"})
        # Korrektur: nur die übergebenen Felder ändern sich, Id und Währung bleiben
        items = userdata.update_position(items[0]["id"], {"shares": 12, "note": "Nachkauf"})
        assert items[0]["shares"] == 12 and items[0]["price"] == 400.5 and items[0]["note"] == "Nachkauf"
        assert items[0]["currency"] == "EUR" and items[0]["date"] == "2024-05-02"
        assert userdata.update_position(items[0]["id"], {"date": ""})[0]["date"] is None
        with pytest.raises(userdata.InvalidInput):
            userdata.update_position(items[0]["id"], {"price": "0"})
        with pytest.raises(userdata.InvalidInput):
            userdata.update_position("gibtsnicht", {"shares": 1})
        assert userdata.remove_position(items[0]["id"]) == []

    def test_depot_restore_and_import(self):
        lot = userdata.add_position("MSFT", {"shares": "10", "price": "400", "note": "x"})[0]
        userdata.remove_position(lot["id"])
        # Rückgängig: gleiche Id, kein Duplikat beim zweiten Mal
        items = userdata.restore_position("MSFT", lot)
        assert [p["id"] for p in items] == [lot["id"]] and items[0]["currency"] == "EUR" and items[0]["note"] == "x"
        assert len(userdata.restore_position("MSFT", lot)) == 1
        # alter Kauf ohne Währung bleibt ohne Währung
        old = {k: v for k, v in lot.items() if k != "currency"} | {"id": "abcdef1234"}
        assert "currency" not in userdata.restore_position("MSFT", old)[-1]
        # Import: alles oder nichts, Fehler nennt die Zeile
        with pytest.raises(userdata.InvalidInput, match="Zeile 2"):
            userdata.add_positions([("SAP.DE", {"shares": "5", "price": "180,5"}), ("ALV.DE", {"shares": "0", "price": "300"})])
        assert len(userdata.positions()) == 2
        items = userdata.add_positions([("SAP.DE", {"shares": "5", "price": "180,5", "date": "2023-01-02"}),
                                        ("ALV.DE", {"shares": "2", "price": "300"})])
        assert [p["symbol"] for p in items[-2:]] == ["SAP.DE", "ALV.DE"] and items[-2]["price"] == 180.5

    def test_alert_restore(self):
        userdata.add_alert("MSFT", {"type": "price_below", "value": "300"})
        a = userdata.add_alert("SAP.DE", {"type": "below_fair", "value": "-5"})[1]
        userdata.update_alerts({a["id"]: {"triggered": "2026-10-20", "message": "x", "seen": False}})
        a = userdata.alerts()[1]
        userdata.remove_alert(a["id"])
        items = userdata.restore_alert("SAP.DE", a, 1)
        assert items[1] == a and len(items) == 2
        assert len(userdata.restore_alert("SAP.DE", a, 0)) == 2  # kein Duplikat
        with pytest.raises(userdata.InvalidInput):
            userdata.restore_alert("SAP.DE", a | {"id": "../x"})
        with pytest.raises(userdata.InvalidInput):
            userdata.restore_alert("SAP.DE", a | {"type": "unbekannt"})

    def test_tradable_overrides(self):
        assert userdata.tradable_overrides() == {}
        assert userdata.set_tradable("OKE", True) == {"OKE": True}
        userdata.set_tradable("TSM", False)
        assert userdata.tradable_overrides() == {"OKE": True, "TSM": False}
        assert userdata.set_tradable("OKE", None) == {"TSM": False}
        with pytest.raises(userdata.InvalidInput):
            userdata.set_tradable("OKE", "ja")

    def test_watch_groups(self):
        assert userdata.watch_groups() == []
        groups = userdata.save_watch_groups([
            {"id": "div", "name": "  Dividende ", "symbols": ["ko", "KO", "PEP"]},
            {"id": "us", "name": "USA", "parent": "div", "symbols": ["KO"]},
            {"id": "x", "name": "Getränke", "parent": "us"},
            {"name": "Ohne Id"},
        ])
        assert groups[0] == {"id": "div", "name": "Dividende", "parent": None, "symbols": ["KO", "PEP"]}
        assert groups[2]["parent"] == "us" and groups[3]["id"]
        assert userdata.watch_groups() == groups
        bad = [
            [{"id": "a", "name": ""}],  # ohne Namen
            [{"id": "a", "name": "A", "parent": "fehlt"}],  # unbekannte Eltern
            [{"id": "a", "name": "A", "parent": "b"}, {"id": "b", "name": "B", "parent": "a"}],  # Kreis
            [{"id": "a", "name": "A"}, {"id": "b", "name": "B", "parent": "a"}, {"id": "c", "name": "C", "parent": "b"},
             {"id": "d", "name": "D", "parent": "c"}],  # vierte Ebene
            [{"id": "a", "name": "Tech"}, {"id": "b", "name": "tech"}],  # doppelt auf derselben Ebene
            [{"id": "a", "name": "A", "symbols": ["kein ticker!"]}],
        ]
        for groups in bad:
            with pytest.raises(userdata.InvalidInput):
                userdata.save_watch_groups(groups)
        # gleicher Name unter verschiedenen Eltern ist erlaubt
        userdata.save_watch_groups([{"id": "a", "name": "A"}, {"id": "b", "name": "B"},
                                    {"id": "c", "name": "USA", "parent": "a"}, {"id": "d", "name": "USA", "parent": "b"}])

    def test_notes(self):
        assert userdata.save_note("SAP.DE", "  These  ")["text"] == "These"
        assert userdata.note("SAP.DE")["text"] == "These"
        userdata.save_note("SAP.DE", "")
        assert userdata.note("SAP.DE")["text"] == ""

    def test_alerts(self):
        items = userdata.add_alert("KO", {"type": "price_below", "value": "55"})
        assert items[0]["value"] == 55.0 and items[0]["triggered"] is None
        with pytest.raises(userdata.InvalidInput):
            userdata.add_alert("KO", {"type": "unbekannt"})
        userdata.update_alerts({items[0]["id"]: {"triggered": "2026-10-21", "seen": False}})
        assert userdata.alerts()[0]["triggered"] == "2026-10-21"


# ---------------------------------------------------------------- Gewinnstabilität bei Verlusten, Geschäftsentwicklung

def annual_rows(revenue, net, start=2022, **extra):
    return [{"end": pd.Timestamp(year=start + i, month=12, day=31), "eps": n / 100, "eps_adj": None, "fin_revenue": r,
             "fin_net": n, **{k: v[i] for k, v in extra.items()}} for i, (r, n) in enumerate(zip(revenue, net))]


class TestLossMakers:
    def test_quality_has_no_stability_for_shrinking_losses(self):
        from aktientool import service
        q = service._quality(annual_rows([1, 1, 1, 1], [-231, -284, -240, -138]), {}, pd.Timestamp("2026-10-23"))
        assert q["stability"] is None and q["loss_making"] and q["losses"] == 4 and not q["short"]

    def test_quality_keeps_stability_with_one_loss_year(self):
        from aktientool import service
        q = service._quality(annual_rows([1] * 6, [100, 120, -50, 160, 180, 200], start=2020), {}, pd.Timestamp("2026-10-23"))
        assert q["stability"] is not None and not q["loss_making"]


class TestBusiness:
    RAW = {"ttm": {"revenue": 2100.0, "gross_profit": 800.0, "net_income": -600.0},
           "annual": {"2025-12-31": {"total_assets": 1000.0, "equity": 700.0, "cash": 500.0, "total_debt": 100.0}},
           "holders": {"insiders": 0.27, "institutions": 0.22},
           "revenue_estimates": {"0y": {"avg": 3760.0, "low": 3000.0, "high": 4500.0, "analysts": 10, "growth": 0.88, "currency": "CNY"}},
           "estimates": {"0y": {"avg": -0.68, "analysts": 10, "currency": "CNY"}, "+1y": {"avg": 1.21, "analysts": 2, "currency": "CNY"}}}

    def build(self, info=None):
        from aktientool.analysis import business
        annual = annual_rows([1000.0, 1050.0, 1300.0, 2000.0], [-970.0, -1230.0, -1120.0, -700.0],
                             fin_gross=[390.0, 330.0, 370.0, 750.0], fin_fcf=[-850.0, -1500.0, -1100.0, -1200.0])
        return business.build(annual, self.RAW, info or {"totalCash": 2600.0, "totalDebt": 1000.0}, -1200.0, "CNY",
                              lambda ccy: 1.0, False)

    def test_growth_margins_and_losses(self):
        b = self.build()
        last = b["years"][-1]
        assert last["growth"] == pytest.approx(2000 / 1300 - 1) and b["years"][0]["growth"] is None
        assert last["gross_margin"] == pytest.approx(0.375) and last["net_margin"] == pytest.approx(-0.35)
        assert last["operating_margin"] is None  # nicht in den Daten
        assert b["loss_years"] == 4 and b["profit_years"] == 4
        assert b["revenue_trend"]["growth"] > 0.2

    def test_balance_runway_and_holders(self):
        b = self.build()
        bal = b["balance"]
        assert bal["net_cash"] == 1600.0 and bal["equity_ratio"] == pytest.approx(0.7)
        assert bal["runway_years"] == pytest.approx(2600 / 1200)
        assert b["holders"]["insiders"] == 0.27

    def test_estimates_are_labelled_with_fiscal_year(self):
        est = {e["key"]: e for e in self.build()["estimates"]}
        assert est["0y"]["year"] == 2026 and est["+1y"]["year"] == 2027  # aus dem letzten Geschäftsjahr abgeleitet
        assert est["0y"]["revenue"] == 3760.0 and est["+1y"]["revenue"] is None and est["+1y"]["eps"] == 1.21
        info = {"nextFiscalYearEnd": pd.Timestamp("2027-06-30", tz="UTC").timestamp()}
        assert {e["key"]: e for e in self.build(info)["estimates"]}["0y"]["year"] == 2027

    def test_financials_have_no_net_cash_or_cashflow_margin(self):
        from aktientool.analysis import business
        annual = annual_rows([100.0, 110.0], [10.0, 12.0], fin_fcf=[50.0, 60.0])
        b = business.build(annual, self.RAW, {"totalCash": 900.0, "totalDebt": 100.0}, 60.0, "EUR", lambda c: 1.0, True)
        assert b["balance"]["net_cash"] is None and b["years"][-1]["fcf_margin"] is None and b["balance"]["equity_ratio"] == 0.7

    def test_gap_in_fiscal_years_has_no_growth(self):
        from aktientool.analysis import business
        annual = annual_rows([100.0, 200.0], [1.0, 2.0])
        annual[1]["end"] = pd.Timestamp("2025-06-30")  # Umstellung des Geschäftsjahres
        assert business.build(annual, {}, {}, None, "EUR", lambda c: 1.0, False)["years"][1]["growth"] is None


class TestServerHome:
    """Sammelabfragen für die Startseite."""

    @pytest.fixture
    def client(self):
        from aktientool import server
        return server.app.test_client()

    def test_day_from_timestamp(self):
        from aktientool import server
        assert server._day(1793217600) == "2026-10-28"
        assert server._day(None) is None and server._day(0) is None

    def test_quotes_include_dates(self, client, monkeypatch):
        from aktientool.sources import yahoo_screener
        monkeypatch.setattr(yahoo_screener, "quotes", lambda syms: [{
            "symbol": "MSFT", "regularMarketPrice": 500.0, "currency": "USD", "regularMarketChangePercent": -2.0,
            "earningsTimestampStart": 1793217600, "isEarningsDateEstimate": True, "dividendDate": 1796860800}])
        q = client.get("/api/quotes?s=MSFT").get_json()[0]
        assert q["change"] == -0.02 and q["earnings_date"] == "2026-10-28" and q["earnings_estimate"] is True
        assert q["dividend_date"] == "2026-12-10"

    def test_underlying_for_option_calculator(self, client, monkeypatch, tmp_path):
        from aktientool.sources import fx, yahoo, yahoo_screener
        monkeypatch.setattr(yahoo_screener, "quotes", lambda syms: [{
            "symbol": "AAPL", "regularMarketPrice": 250.0, "currency": "USD", "longName": "Apple Inc.", "dividendYield": 0.4}])
        monkeypatch.setattr(yahoo, "closes", lambda sym: [100.0 * 1.01 ** (i % 2) for i in range(300)])
        monkeypatch.setattr(fx, "eur_quotes", lambda ccys: {"USD": {"rate": 0.9, "change": 0.0}})
        u = client.get("/api/basiswert/aapl").get_json()
        assert u["price"] == 250.0 and u["currency"] == "USD" and u["eur"] == 0.9
        assert u["div_yield"] == pytest.approx(0.004)
        assert u["vola_1y"] > 0.1 and u["vola_3m"] > 0.1

    def test_underlying_unknown_symbol(self, client, monkeypatch):
        from aktientool.sources import yahoo_screener
        monkeypatch.setattr(yahoo_screener, "quotes", lambda syms: [])
        assert client.get("/api/basiswert/XYZ").status_code == 404

    def test_depot_endpoints(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(config, "DEPOT_FILE", tmp_path / "depot.json")
        lot = client.post("/api/depot", json={"symbol": "msft", "shares": "3", "price": "400"}).get_json()[0]
        assert client.put(f"/api/depot/{lot['id']}", json={"shares": "4"}).get_json()[0]["shares"] == 4
        assert client.delete(f"/api/depot/{lot['id']}").get_json() == []
        assert client.post("/api/depot/restore", json=lot).get_json()[0]["id"] == lot["id"]
        r = client.post("/api/depot/import", json={"items": [{"symbol": "sap.de", "shares": "1", "price": "x"}]})
        assert r.status_code == 400 and "Zeile 1" in r.get_json()["error"]
        items = client.post("/api/depot/import", json={"items": [{"symbol": "sap.de", "shares": "1", "price": "180"}]}).get_json()
        assert [p["symbol"] for p in items] == ["MSFT", "SAP.DE"]
        assert client.post("/api/depot/import", json={"items": []}).status_code == 400

    def test_world_stocks_skips_unknown(self, client, monkeypatch):
        from aktientool import world
        monkeypatch.setattr(world, "stock", lambda s: {"symbol": s, "score_total": 80} if s == "MSFT" else None)
        assert client.get("/api/world/stocks?s=MSFT,XYZ").get_json() == {"MSFT": {"symbol": "MSFT", "score_total": 80}}


class TestTradeRepublic:
    LISTING = {"date": "2026-10-23", "isins": {"US8740391003": ["909800", "TAIWAN SEMICON.MANU.", "AKTIE"],
                                                "US0378331005": ["865985", "APPLE INC.", "AKTIE"]}}

    def test_home_listing_and_adr(self):
        from aktientool import world
        apple = world.trade_republic_info("AAPL", ["US0378331005"], self.LISTING, {})
        assert apple["tradable"] and apple["wkn"] == "865985" and not apple["other_listing"]
        tsmc = world.trade_republic_info("2330.TW", ["TW0002330008", "US8740391003"], self.LISTING, {})
        assert tsmc["tradable"] and tsmc["isin"] == "US8740391003" and tsmc["other_listing"]

    def test_unknown_without_list_and_override_wins(self):
        from aktientool import world
        assert world.trade_republic_info("402340.KS", ["KR7402340004"], None, {})["tradable"] is None
        assert world.trade_republic_info("402340.KS", ["KR7402340004"], self.LISTING, {})["tradable"] is False
        own = world.trade_republic_info("402340.KS", ["KR7402340004"], self.LISTING, {"402340.KS": True})
        assert own["tradable"] and own["override"]
        assert world.trade_republic_info("AAPL", ["US0378331005"], None, {"AAPL": False})["tradable"] is False

    def test_rows_get_compact_flags(self):
        from aktientool import world
        rows = [{"symbol": "2330.TW", "isin": "TW0002330008"}, {"symbol": "AAPL", "isin": "US0378331005"},
                {"symbol": "402340.KS", "isin": "KR7402340004"}, {"symbol": "X"}]
        alt = {"2330.TW": ["US8740391003"]}
        for r in rows:
            world._mark_tradable(r, alt.get(r["symbol"]), self.LISTING, {})
        assert rows[0] == {"symbol": "2330.TW", "isin": "TW0002330008", "tr": 1, "tr_isin": "US8740391003"}
        assert rows[1]["tr"] == 1 and "tr_isin" not in rows[1]
        assert rows[2]["tr"] == 0 and rows[3]["tr"] == 0
        unknown = {"symbol": "AAPL", "isin": "US0378331005"}
        world._mark_tradable(unknown, None, None, {})
        assert "tr" not in unknown
