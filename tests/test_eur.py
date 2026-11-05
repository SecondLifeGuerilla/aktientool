"""Anzeige in Euro: Wechselkurse (fx) und Umrechnung von Profil, Kennzahlenzeile, Kursen und Alarmen (eur, alerts)."""

import copy

import pandas as pd
import pytest

from aktientool import alerts, eur
from aktientool.sources import fx, yahoo, yahoo_screener

# 1 EUR = 1,25 USD bis Ende 2019, danach 1 EUR = 1,00 USD; heute 1 EUR = 1,10 USD
USD_HISTORY = [["2003-12-01", 1 / 1.25], ["2019-12-31", 1 / 1.25], ["2020-01-02", 1.0], ["2024-12-31", 1.0]]
RATES = {"USD": {"rate": 1 / 1.1, "change": 0.01}, "GBp": {"rate": 0.0119, "change": 0.0},
         "GBP": {"rate": 1.19, "change": 0.0}, "EUR": {"rate": 1.0, "change": 0.0}}


@pytest.fixture
def fake_fx(monkeypatch):
    monkeypatch.setattr(fx, "eur_quotes", lambda ccys: {c: RATES[c] for c in ccys if c in RATES})
    monkeypatch.setattr(fx, "eur_history", lambda ccy: USD_HISTORY if fx.split_currency(ccy)[0] == "USD" else [])


class TestFx:
    def test_eur_quotes_inverts_and_ignores_foreign_symbols(self, monkeypatch):
        monkeypatch.setattr(yahoo_screener, "quotes", lambda syms: [
            {"symbol": "EURUSD=X", "regularMarketPrice": 1.25, "regularMarketChangePercent": -1.0},
            {"symbol": "MSFT", "regularMarketPrice": 500.0},  # gehört nicht zur Anfrage
        ])
        q = fx.eur_quotes(["USD", "GBp", "EUR"])
        assert q["USD"]["rate"] == pytest.approx(0.8)
        # Euro je Dollar steigt, wenn der Euro in Dollar fällt
        assert q["USD"]["change"] == pytest.approx(1 / 0.99 - 1)
        assert q["EUR"]["rate"] == 1.0 and "GBp" not in q

    def test_minor_units_divide_by_factor(self, monkeypatch):
        monkeypatch.setattr(yahoo_screener, "quotes", lambda syms: [{"symbol": "EURGBP=X", "regularMarketPrice": 0.8}])
        assert fx.eur_quotes(["GBp"])["GBp"]["rate"] == pytest.approx(1.25 / 100)

    def test_at_uses_day_rates_and_now_for_the_last_day(self, fake_fx):
        to = fx.ToEur("USD", now=RATES["USD"])
        r = to.at(["1999-06-01", "2015-03-02", "2022-05-05", "2026-10-22"])
        assert r[0] == pytest.approx(0.8)  # vor Beginn der Historie: erster bekannter Kurs
        assert r[1] == pytest.approx(0.8) and r[2] == pytest.approx(1.0)
        assert r[3] == pytest.approx(1 / 1.1)  # letzter Tag: aktueller Kurs

    def test_daily_history_drops_one_day_spikes(self, monkeypatch):
        idx = pd.date_range("2008-10-01", periods=9, freq="B")
        close = [1.36, 1.37, 1.36, 1.50, 1.36, 1.35, 1.10, 1.10, 1.10]  # Ausreißer am 4. Tag, echter Sprung danach
        hist = pd.DataFrame({"Close": close}, index=idx)
        monkeypatch.setattr(yahoo.yf, "Ticker", lambda pair: type("T", (), {"history": lambda self, **kw: hist})())
        values = [v for _, v in yahoo.fx_history("EURUSD=X", interval="1d")]
        assert values[3] == pytest.approx(1.36)
        assert values[-1] == pytest.approx(1.10)


def usd_profile():
    return {
        "symbol": "TEST", "currency": "USD",
        "facts": {"price": 110.0, "market_cap": 1e9},
        "data": {"financial_currency": "USD"},
        "annual": [{"eps": 5.0, "fcf_ps": 4.0, "revenue": 1e8, "fin_revenue": 1e8}],
        "ttm": {"eps": 5.5},
        "quality": {"points": [["2019-12-31", 5.0]], "forecasts": [{"date": "2027-12-31", "avg": 6.0}]},
        "business": {"currency": "USD", "years": [{"revenue": 1e8}], "ttm": {"revenue": 1.1e8},
                     "balance": {"cash": 5e7}, "estimates": [{"revenue": 1.2e8, "eps": 6.0, "eps_currency": "USD"}]},
        "price": {"series": [["2018-06-01", 50.0, 40.0], ["2022-06-01", 100.0, 90.0], ["2026-10-22", 110.0, 110.0]],
                  "returns": [], "ath": {}},
        "valuation": {"current_value": 5.5, "periods": {"5": {"fair_value": 99.0, "deviation": 0.11}},
                      "metric_series": [["2018-06-01", 4.0], ["2026-10-22", 5.5]], "multiples": [{"current_value": 5.5}],
                      "forecasts": [{"avg": 6.0, "low": 5.0, "high": 7.0}]},
        "dcf": {"fcf": 4.0},
        "dividends": {"ttm": 2.2, "per_year": [[2025, 2.2, False]], "payments": [["2025-05-01", 0.55]], "yield": 0.02},
        "debt": {"net_debt": 1e7},
        "analysts": {"target_mean": 121.0, "revisions": {"periods": {"0y": {"now": 6.0}}},
                     "surprises": {"quarters": [{"actual": 1.5, "estimate": 1.4}]}},
        "insider": {"transactions": [{"value": 1000.0}]},
    }


class TestProfile:
    def test_current_values_use_todays_rate(self, fake_fx):
        p = eur.profile(usd_profile())
        assert p["currency"] == "EUR" and p["eur"]["original_currency"] == "USD" and p["eur"]["original_price"] == 110.0
        assert p["facts"]["price"] == pytest.approx(100.0)
        assert p["valuation"]["periods"]["5"]["fair_value"] == pytest.approx(90.0)
        assert p["valuation"]["periods"]["5"]["deviation"] == pytest.approx(0.11)  # Verhältnisse bleiben
        assert p["analysts"]["target_mean"] == pytest.approx(110.0)
        assert p["dividends"]["ttm"] == pytest.approx(2.0)
        # Jahreswerte zum heutigen Kurs: Wachstumsraten bleiben unverfälscht
        assert p["quality"]["points"][0][1] == pytest.approx(5.0 / 1.1)
        assert p["dividends"]["per_year"][0] == [2025, pytest.approx(2.0), False]
        assert p["business"]["currency"] == "EUR" and p["business"]["estimates"][0]["eps_currency"] == "EUR"
        assert p["insider"]["transactions"][0]["value"] == pytest.approx(1000 / 1.1)

    def test_price_history_uses_the_rate_of_each_day(self, fake_fx):
        p = eur.profile(usd_profile())
        series = p["price"]["series"]
        assert series[0][1] == pytest.approx(50 * 0.8) and series[1][1] == pytest.approx(100.0)
        assert series[-1][1] == pytest.approx(p["facts"]["price"])  # letzter Punkt = angezeigter Kurs
        # fairer Wert im Kursdiagramm zum selben Tageskurs wie der Kurs
        assert p["valuation"]["metric_series"][0][1] == pytest.approx(4.0 * 0.8)
        assert p["price"]["ath"]["price"] == pytest.approx(100.0)
        assert p["eur"]["historical"] is True

    def test_minor_unit_market_cap_uses_major_currency(self, fake_fx):
        raw = usd_profile()
        raw.update(currency="GBp")
        raw["data"]["financial_currency"] = "GBP"
        p = eur.profile(raw)
        assert p["facts"]["price"] == pytest.approx(110 * 0.0119)
        assert p["facts"]["market_cap"] == pytest.approx(1e9 * 1.19)  # Pfund, nicht Pence

    def test_euro_quote_keeps_prices_but_converts_dollar_financials(self, fake_fx):
        raw = usd_profile()
        raw["currency"] = "EUR"
        p = eur.profile(copy.deepcopy(raw))
        assert p["facts"]["price"] == 110.0 and p["price"]["series"] == raw["price"]["series"]
        assert p["eur"]["historical"] is False
        assert p["business"]["ttm"]["revenue"] == pytest.approx(1e8)  # 1,1e8 USD zum heutigen Kurs

    def test_daily_change_includes_currency_move(self, fake_fx):
        raw = usd_profile()
        raw["facts"]["change"] = 0.02
        assert eur.profile(raw)["facts"]["change"] == pytest.approx(1.02 * 1.01 - 1)

    def test_missing_rates_pass_through(self, fake_fx):
        raw = usd_profile()
        raw["currency"] = "XYZ"
        p = eur.profile(raw)
        assert p["eur"] is None and p["currency"] == "XYZ" and p["facts"]["price"] == 110.0


def test_summary_and_quotes(fake_fx):
    row = eur.summary({"symbol": "T", "currency": "USD", "price": 110.0, "fair_value": 99.0, "div_ttm": 2.2,
                       "market_cap": 1e9, "deviation": 0.11})
    assert row["currency"] == "EUR" and row["original_currency"] == "USD"
    assert row["price"] == pytest.approx(100.0) and row["deviation"] == 0.11
    q = eur.quotes([{"symbol": "T", "currency": "USD", "price": 110.0, "change": 0.02}])[0]
    assert q["price"] == pytest.approx(100.0) and q["original_price"] == 110.0
    assert q["change"] == pytest.approx(1.02 * 1.01 - 1)  # Aktie und Wechselkurs


class TestAlerts:
    def test_price_threshold_in_euro(self):
        a = {"type": "price_below", "value": 95.0, "symbol": "T", "currency": "EUR"}
        assert alerts.evaluate(a, 110.0, None, None, rate=1 / 1.1) is None  # 100 € > 95 €
        msg = alerts.evaluate(a, 100.0, None, None, rate=1 / 1.1)
        assert "90,91 €" in msg and "95,00 €" in msg
        assert alerts.evaluate(a, 100.0, None, None, rate=None) is None

    def test_old_alerts_compare_in_quote_currency(self):
        a = {"type": "price_above", "value": 105.0, "symbol": "T"}
        assert alerts.evaluate(a, 110.0, None, None, rate=1 / 1.1) == "T: Kurs 110,00 ist über 105,00 gestiegen."

    def test_dividend_cut_compares_in_quote_currency_and_reports_euro(self):
        a = {"type": "dividend_cut", "symbol": "T", "baseline": 2.2}
        msg = alerts.evaluate(a, 110.0, {"div_ttm": 1.1}, None, rate=1 / 1.1)
        assert "1,00 €" in msg and "2,00 €" in msg
