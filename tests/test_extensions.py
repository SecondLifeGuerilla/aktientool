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
        for name in ("DEPOT_FILE", "NOTES_FILE", "ALERTS_FILE"):
            monkeypatch.setattr(config, name, tmp_path / f"{name}.json")

    def test_depot(self):
        items = userdata.add_position("MSFT", {"shares": "10", "price": "400,50", "date": "2024-05-02"})
        assert items[0]["price"] == 400.5 and items[0]["date"] == "2024-05-02"
        with pytest.raises(userdata.InvalidInput):
            userdata.add_position("MSFT", {"shares": "-1", "price": "1"})
        assert userdata.remove_position(items[0]["id"]) == []

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
