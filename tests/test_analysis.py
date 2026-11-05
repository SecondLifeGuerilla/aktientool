import math

import numpy as np
import pandas as pd
import pytest

from aktientool.analysis import dividends, metrics, scorecard, summary, valuation


def yearly(values, start=2015):
    return [(pd.Timestamp(year=start + i, month=12, day=31), v) for i, v in enumerate(values)]


class TestTrendStats:
    def test_exponential_growth_is_recovered(self):
        stats = metrics.trend_stats(yearly([100 * 1.1 ** i for i in range(11)]))
        assert stats["growth"] == pytest.approx(0.10, abs=1e-3)
        assert stats["stability"] > 0.95
        assert stats["count"] == 11

    def test_straight_line_has_stability_one(self):
        stats = metrics.trend_stats(yearly([1, 2, 3, 4, 5, 6]))
        assert stats["stability"] == pytest.approx(1.0)

    def test_falling_series_has_negative_stability(self):
        stats = metrics.trend_stats(yearly([6, 5, 4, 3, 2, 1]))
        assert stats["stability"] == pytest.approx(-1.0)
        assert stats["growth"] < 0

    def test_uses_only_last_eleven_points(self):
        stats = metrics.trend_stats(yearly([1000, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
        assert stats["stability"] == pytest.approx(1.0)
        assert stats["start"].startswith("2016")

    def test_too_few_points(self):
        stats = metrics.trend_stats(yearly([1, 2]))
        assert stats["stability"] is None and stats["growth"] is None

    def test_loss_years_fall_back_to_three_year_averages(self):
        stats = metrics.trend_stats(yearly([-1, 1, 3, 4, 5, 6, 7, 8]))
        # Ø erste drei Jahre = 1, Ø letzte drei = 7, Abstand der Mittelpunkte = 5 Jahre
        assert stats["growth"] == pytest.approx(7 ** (1 / 5) - 1, rel=0.01)

    def test_constant_positive_series_is_stable(self):
        assert metrics.trend_stats(yearly([2, 2, 2, 2]))["stability"] == 1.0

    def test_shrinking_losses_are_mostly_losses(self):
        # UBTech 2022–2025: steigende Trendlinie (R² 0,46), aber nur Verluste
        stats = metrics.trend_stats(yearly([-2.31, -2.84, -2.40, -1.38]))
        assert stats["stability"] > 0 and stats["losses"] == 4
        assert metrics.mostly_losses(stats)

    def test_single_loss_year_keeps_stability(self):
        stats = metrics.trend_stats(yearly([1, 2, -1, 4, 5, 6]))
        assert stats["losses"] == 1 and not metrics.mostly_losses(stats)
        assert metrics.mostly_losses(metrics.trend_stats(yearly([-3, -2, -1, 1, 2, 3])))  # Hälfte Verluste


def test_cagr():
    assert metrics.cagr(100, 121, 2) == pytest.approx(0.1)
    assert metrics.cagr(-1, 121, 2) is None


def price_series(start="2010-01-01", end="2025-12-31", fn=lambda t: 100.0):
    idx = pd.bdate_range(start, end)
    t = (idx - idx[0]).days / 365.25
    return pd.Series([fn(x) for x in t], index=idx)


class TestPriceMetrics:
    def test_period_returns(self):
        close = price_series(fn=lambda t: 100 * 1.1 ** t)
        rows = {r["label"]: r for r in metrics.period_returns(close, close, close.index[-1])}
        assert rows["5 Jahre"]["price_pa"] == pytest.approx(0.10, abs=0.002)
        assert rows["20 Jahre"]["price"] is None  # Historie zu kurz

    def test_momentum_and_ath(self):
        close = price_series(fn=lambda t: 100 + t)
        assert metrics.momentum(close) > 0
        assert metrics.all_time_high(close)["distance"] == pytest.approx(0)

    def test_volatility(self):
        rng = np.random.default_rng(1)
        prices = 100 * np.exp(np.cumsum(rng.normal(0, 0.3 / math.sqrt(252), 5000)))
        assert metrics.volatility(prices, 5000) == pytest.approx(0.3, rel=0.03)
        # nur die letzten Tage zählen: eine ruhige Phase davor ändert die 3-Monats-Volatilität nicht
        assert metrics.volatility([100.0] * 500 + list(prices[-64:]), 63) == pytest.approx(metrics.volatility(prices, 63))
        assert metrics.volatility([100.0, 101.0], 250) is None


class TestValuation:
    def test_constant_multiple_gives_fair_price(self):
        eps = lambda t: 5 * 1.08 ** t  # noqa: E731
        close = price_series(fn=lambda t: 20 * eps(t))
        annual = [{"end": pd.Timestamp(year=2010 + i, month=12, day=31), "eps": eps(i + 1), "eps_adj": None, "ocf_ps": None}
                  for i in range(15)]
        price = float(close.iloc[-1])
        result = valuation.build(close, price, annual, {"eps": eps(16)}, {})
        assert result["available"] and result["metric_key"] == "eps"
        ten = result["periods"]["10"]
        assert ten["avg_multiple"] == pytest.approx(20, rel=0.02)
        assert abs(ten["deviation"]) < 0.03
        assert ten["rating"]["label"] == "fair bewertet"

    def test_all_multiples_are_returned_even_if_cashflow_is_used(self):
        # Cashflow steigt perfekt gleichmäßig, Gewinn schwankt: bewertet wird mit dem KCV, das KGV gibt es trotzdem
        ocf = lambda t: 4 * 1.08 ** t  # noqa: E731
        close = price_series(fn=lambda t: 15 * ocf(t))
        annual = [{"end": pd.Timestamp(year=2010 + i, month=12, day=31), "eps": 3 * 1.08 ** (i + 1) * (1.3 if i % 2 else 0.7),
                   "eps_adj": None, "ocf_ps": ocf(i + 1)} for i in range(15)]
        result = valuation.build(close, float(close.iloc[-1]), annual, {"eps": 3 * 1.08 ** 16, "ocf_ps": ocf(16)}, {})
        assert result["metric_key"] == "ocf_ps"
        by_key = {m["key"]: m for m in result["multiples"]}
        assert {"eps", "ocf_ps"} <= set(by_key) <= {"eps", "ocf_ps", "eps_norm"}
        assert by_key["ocf_ps"]["used"] and not by_key["eps"]["used"]
        assert by_key["eps"]["label"] == "KGV" and by_key["eps"]["series"]
        assert by_key["ocf_ps"]["averages"]["10"] == pytest.approx(result["periods"]["10"]["avg_multiple"])

    def test_missing_kgv_is_explained_for_loss_makers(self):
        # Gewinn immer negativ, Cashflow positiv (wie bei XPeng): KGV fehlt mit Begründung, KCV ist da
        close = price_series()
        annual = [{"end": pd.Timestamp(year=2012 + i, month=12, day=31), "eps": -1.0 - i / 10, "eps_adj": None,
                   "ocf_ps": 2 + i / 5} for i in range(12)]
        result = valuation.build(close, float(close.iloc[-1]), annual, {"eps": -0.5, "ocf_ps": 4.5}, {})
        assert [m["key"] for m in result["multiples"]] == ["ocf_ps"]
        missing = {m["key"]: m for m in result["multiples_missing"]}
        assert missing["eps"]["reason"] == "Verlust in allen verfügbaren Jahren"
        assert missing["eps"]["current_value"] == -0.5
        assert missing["eps_adj"]["reason"] == "keine Daten"

    def test_kgv_history_shown_when_loss_only_now(self):
        # früher Gewinn, aktuell Verlust: kein fairer Wert über das KGV, aber der Verlauf bis zum Verlust bleibt
        close = price_series()
        annual = [{"end": pd.Timestamp(year=2012 + i, month=12, day=31), "eps": 3.0 + i / 10, "eps_adj": None, "ocf_ps": None}
                  for i in range(11)] + [{"end": pd.Timestamp(year=2023, month=12, day=31), "eps": -2.0, "eps_adj": None, "ocf_ps": None}]
        result = valuation.build(close, float(close.iloc[-1]), annual, {"eps": -2.5}, {})
        assert result["available"] is False
        kgv = result["multiples"][0]
        assert kgv["key"] == "eps" and kgv["loss_now"] and kgv["current"] is None and kgv["series"]

    @staticmethod
    def yearly_rows(key, values, start=2014):
        return [{"end": pd.Timestamp(year=start + i, month=12, day=31), "eps": None, "eps_adj": None, "ocf_ps": None, key: v}
                for i, v in enumerate(values)]

    def test_no_fair_value_when_cashflow_only_recently_positive(self):
        # wie XPeng: Cashflow in 2 von 4 Jahren negativ, zuletzt positiv -> keine verlässliche Bewertung
        close = price_series()
        annual = self.yearly_rows("ocf_ps", [-5.5, 0.6, -1.1, 4.8], start=2022)
        result = valuation.build(close, float(close.iloc[-1]), annual, {"ocf_ps": 5.0}, {})
        assert result["available"] is False and result["reason"] == valuation.NO_BASIS
        issue = {s["key"]: s["issue"] for s in result["stabilities"]}["ocf_ps"]
        assert issue == "negativer Cashflow in 2 der letzten 4 Geschäftsjahre"

    def test_one_loss_year_in_five_is_tolerated(self):
        close = price_series()
        eps = [2.0 + i / 5 for i in range(12)]
        eps[-3] = -0.5  # ein Verlustjahr innerhalb der letzten 5
        result = valuation.build(close, float(close.iloc[-1]), self.yearly_rows("eps", eps), {"eps": 5.0}, {})
        assert result["available"] and result["metric_key"] == "eps"

    def test_loss_in_last_fiscal_year_excludes_metric(self):
        close = price_series()
        eps = [2.0 + i / 5 for i in range(11)] + [-1.0]
        result = valuation.build(close, float(close.iloc[-1]), self.yearly_rows("eps", eps), {"eps": 1.0}, {})
        assert result["available"] is False
        assert result["stabilities"][0]["issue"] == "Verlust im letzten Geschäftsjahr"

    def test_short_adjusted_series_does_not_replace_long_loss_history(self):
        # 12 Jahre bilanzierter Gewinn mit vielen Verlusten, 4 Jahre bereinigter Gewinn positiv (wie Palantir/Uber)
        close = price_series()
        annual = self.yearly_rows("eps", [-1.0, -0.8, -0.5, -0.4, -0.3, -0.2, -0.1, -0.2, -0.1, 0.1, -0.05, 0.2])
        for r, v in zip(annual[-4:], [0.3, 0.4, 0.5, 0.6]):
            r["eps_adj"] = v
        result = valuation.build(close, float(close.iloc[-1]), annual, {"eps": 0.25, "eps_adj": 0.7}, {})
        assert result["available"] is False
        assert {s["key"]: s["issue"] for s in result["stabilities"]}["eps_adj"] == "kürzere Historie, nicht verwendet"

    def test_needs_two_years_of_prices_with_positive_metric(self):
        close = price_series(start="2024-06-01")  # nur 1,5 Jahre Kurse
        annual = self.yearly_rows("eps", [2.0, 2.2, 2.4, 2.6], start=2021)
        result = valuation.build(close, float(close.iloc[-1]), annual, {"eps": 2.7}, {})
        assert result["available"] is False
        assert result["stabilities"][0]["issue"] == "weniger als 2 Jahre verwertbare Kursdaten"

    def test_earnings_dip_does_not_inflate_average_multiple(self):
        # Kurs folgt einem KGV von 20 auf den normalen Gewinn; ein Einbruchsjahr (Gewinn 0,4 statt 4) treibt
        # das tägliche KGV dort auf 200 – das soll den Durchschnitt nicht aufblähen (adidas 2023/24)
        eps = [4.0] * 7 + [0.4, 4.0, 4.0, 4.0, 4.0]
        close = price_series(fn=lambda t: 80.0)
        result = valuation.build(close, 80.0, self.yearly_rows("eps", eps), {"eps": 4.0}, {})
        ten = result["periods"]["10"]
        assert ten["avg_multiple"] == pytest.approx(20, rel=0.03)
        assert 0.05 < ten["excluded_share"] < 0.3
        assert ten["rating"]["label"] == "fair bewertet"
        kgv = result["multiples"][0]
        assert kgv["excluded"] and kgv["excluded"][0][0].startswith("2021")  # Einbruch Ende 2021
        assert result["dip_now"] is False

    def test_steady_growth_is_not_treated_as_dip(self):
        eps = [2.0 * 1.15 ** i for i in range(12)]  # 15 % pro Jahr
        close = price_series()
        result = valuation.build(close, float(close.iloc[-1]), self.yearly_rows("eps", eps), {"eps": eps[-1] * 1.1}, {})
        assert result["periods"]["10"]["excluded_share"] == pytest.approx(0, abs=0.01)
        assert result["multiples"][0]["excluded"] == []

    def test_current_dip_is_flagged(self):
        eps = [4.0] * 11 + [1.5]  # letzter Jahreswert eingebrochen, aber positiv
        close = price_series(fn=lambda t: 80.0)
        result = valuation.build(close, 80.0, self.yearly_rows("eps", eps), {"eps": 1.5}, {})
        assert result["available"] and result["dip_now"] is True
        # rechnerisch stark überbewertet, aber nur wegen des Einbruchs: keine Einordnung
        assert result["periods"]["10"]["deviation"] > 0.3
        assert result["periods"]["10"]["rating"]["label"] == "nicht aussagekräftig"

    def test_short_history_gives_fair_value_without_rating(self):
        # nur 4 Geschäftsjahre (Firmen ohne SEC-Berichte): fairer Wert ja, Einordnung nein; 10 Jahre wäre eine Kopie von 5
        close = price_series(start="2012-01-01", end="2026-10-21", fn=lambda t: 50.0)
        annual = self.yearly_rows("eps", [1.2, 1.5, 1.8, 2.0], start=2022)
        result = valuation.build(close, 50.0, annual, {"eps": 2.2}, {})
        assert result["available"] and result["short_history"] is True
        assert result["history_years"] == pytest.approx(3.8, abs=0.1)
        assert result["periods"]["10"] is None and result["default_period"] == "5"
        five = result["periods"]["5"]
        assert five["deviation"] < -0.1  # rechnerisch unterbewertet …
        assert five["rating"] == valuation.SHORT  # … aber ohne Einordnung

    def test_long_history_is_rated(self):
        close = price_series(fn=lambda t: 80.0)
        result = valuation.build(close, 80.0, self.yearly_rows("eps", [4.0] * 12), {"eps": 4.0}, {})
        assert result["short_history"] is False
        assert result["periods"]["10"]["rating"]["label"] == "fair bewertet"

    def test_unavailable_without_positive_metric(self):
        close = price_series()
        annual = [{"end": pd.Timestamp(year=2015 + i, month=12, day=31), "eps": -1.0, "eps_adj": None, "ocf_ps": None} for i in range(5)]
        assert valuation.build(close, 100.0, annual, {"eps": -1.0}, {})["available"] is False

    @pytest.mark.parametrize("dev,label", [(0.5, "stark überbewertet"), (0.2, "überbewertet"), (0.0, "fair bewertet"),
                                           (-0.2, "unterbewertet"), (-0.5, "stark unterbewertet")])
    def test_rating(self, dev, label):
        assert valuation.rating(dev)["label"] == label

    def test_forecast_scales_with_estimate_growth(self):
        last = (pd.Timestamp("2025-12-31"), 10.0)
        est = {"0y": {"avg": 2.2, "low": 2.0, "high": 2.4, "year_ago": 2.0}, "+1y": {"avg": 2.42}}
        fc = valuation.forecast_points(last, est, pd.Timestamp("2026-06-01"))
        assert [f["date"] for f in fc] == ["2026-12-31", "2027-12-31"]
        assert fc[0]["avg"] == pytest.approx(11.0)
        assert fc[0]["low"] == pytest.approx(10.0)
        assert fc[1]["avg"] == pytest.approx(12.1)

    def test_no_forecast_for_stale_data(self):
        last = (pd.Timestamp("2020-12-31"), 10.0)
        est = {"0y": {"avg": 2.2, "year_ago": 2.0}}
        assert valuation.forecast_points(last, est, pd.Timestamp("2026-06-01")) == []


class TestDividends:
    def make(self, years, growth=0.05, last_year=2025):
        pays = []
        for i, y in enumerate(range(last_year - years + 1, last_year + 1)):
            amount = 0.25 * (1 + growth) ** i
            pays += [[f"{y}-{m:02d}-15", amount] for m in (3, 6, 9, 12)]
        return pays

    def test_growing_dividend(self):
        close = price_series("2010-01-01", "2026-05-29")
        d = dividends.build(self.make(15), close, 100.0, eps_ttm=2.0, fcf_ps_ttm=4.0)
        assert d["pays"] and not d["suspended"]
        assert d["growth"] == pytest.approx(0.05, abs=1e-3)
        assert d["increase_streak"] == 14
        assert d["uninterrupted_since"] == 2011
        assert d["payout_eps"] == pytest.approx(d["ttm"] / 2.0)
        assert d["avg_yield"]["10"] > 0

    def test_suspended_dividend(self):
        close = price_series("2010-01-01", "2026-05-29")
        d = dividends.build(self.make(5, last_year=2020), close, 100.0, None, None)
        assert d["suspended"] and d["yield"] == 0

    def test_no_dividend(self):
        assert dividends.build([], price_series(), 100.0, None, None) == {"pays": False}


class TestScorecard:
    def test_discount_score(self):
        assert scorecard.discount_score(0.5) == 1
        assert scorecard.discount_score(0.0) == pytest.approx(5.5)
        assert scorecard.discount_score(-0.5) == 10
        assert scorecard.discount_score(None) is None

    def test_debt_normalization(self):
        assert scorecard.normalize("debt_years", 1.0, None, None) == 1.0
        assert scorecard.normalize("debt_years", 4.0, None, None) == 0.5
        assert scorecard.normalize("debt_years", math.inf, None, None) == 0.0

    def test_low_yield_caps_dividend_income_score(self):
        strong = {"earnings_stability": 0.95, "earnings_growth": 0.15, "debt_years": 0.5, "momentum": 0.15,
                  "discount": 6, "div_stability": 0.95, "div_growth": 0.08}
        low = {s["key"]: s["score"] for s in scorecard.build({**strong, "div_yield": 0.003})}
        high = {s["key"]: s["score"] for s in scorecard.build({**strong, "div_yield": 0.05})}
        assert low["dividend_income"] <= 2
        assert high["dividend_income"] >= 8
        assert low["earnings_growth"] == high["earnings_growth"]

    def test_missing_values_are_neutral_or_zero(self):
        cards = scorecard.build({})
        assert all(1 <= c["score"] <= 10 for c in cards)
        crit = {c["key"]: c for c in cards[2]["criteria"]}
        assert crit["discount"]["norm"] is None

    def test_short_history_counts_at_most_neutral(self):
        # BASF 2022–2025: vier Werte nach einem Einbruch ergeben Stabilität 0,92 und +115 % Wachstum pro Jahr
        values = {"earnings_stability": 0.92, "earnings_growth": 1.15, "debt_years": 3.0, "momentum": 0.05, "discount": 8}
        long = {c["key"]: c for c in scorecard.build(values, years={"earnings_stability": 10, "earnings_growth": 10})}
        short = {c["key"]: c for c in scorecard.build(values, years={"earnings_stability": 3, "earnings_growth": 3})}
        assert short["earnings_growth"]["score"] < long["earnings_growth"]["score"]
        crit = {c["key"]: c for c in short["earnings_growth"]["criteria"]}
        assert crit["earnings_growth"]["short"] and crit["earnings_growth"]["norm"] == 1.0  # Wert selbst bleibt sichtbar
        assert crit["earnings_growth"]["label"] == "Gewinnwachstum (3J.)"
        assert not crit["momentum"]["short"]

    def test_short_history_does_not_raise_weak_values(self):
        values = {"earnings_stability": -0.4, "earnings_growth": -0.1}
        crit = {c["key"]: c for c in scorecard.build(values, years={"earnings_growth": 3})[2]["criteria"]}
        assert crit["earnings_growth"]["norm"] == 0.0 and crit["earnings_growth"]["short"]


def test_summary_explains_distorted_valuation():
    text = summary.build({"stability": 0.9, "growth": 0.08}, valuation.DISTORTED, 0.05, [])["text"]
    assert "nicht aussagekräftig" in text and "fair bewertet" not in text


def test_summary_does_not_judge_short_history():
    cards = [{"key": "earnings_growth", "label": "Gewinnwachstum", "score": 7}]
    s = summary.build({"stability": 0.92, "growth": 1.15, "short": True}, valuation.SHORT, 0.05, cards)
    assert s["earnings"]["reliability"] == "kaum beurteilbar"
    assert s["earnings"]["growth"] is None and s["earnings"]["outlook"] is None
    assert "unsicher" in s["text"] and "günstigen Kaufzeitpunkt" not in s["text"] and "Dank" not in s["text"]


def test_summary_names_loss_making_earnings():
    s = summary.build({"stability": None, "growth": None, "loss_making": True, "short": False}, None, 0.05, [])
    assert s["earnings"]["reliability"] == "von Verlusten geprägt" and s["earnings"]["outlook"] is None


def test_is_short():
    assert metrics.is_short(3.0) and metrics.is_short(None)
    assert not metrics.is_short(5.0) and not metrics.is_short(10)
