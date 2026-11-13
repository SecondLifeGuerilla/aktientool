"""Kandidatensuche: vorsichtige Rendite, Warnzeichen, Beständigkeit im Gesamt-Score, Heimatnotierung, Rückblick."""

import datetime as dt
import json

import numpy as np
import pytest

from aktientool import cache, config, deep, rueckblick, world
from aktientool.analysis import summary, trap, valuation

# ---------------------------------------------------------------- vorsichtige Rendite


class TestCautiousReturn:
    def test_takes_the_lower_growth_source(self):
        assert valuation.cautious_growth({"analysts": -0.01, "history": 0.20}) == pytest.approx(-0.01)
        assert valuation.cautious_growth({"analysts": 0.30, "history": 0.40}) == valuation.GROWTH_RANGE[1]
        assert valuation.cautious_growth({"history": 0.07}) == pytest.approx(0.07)
        assert valuation.cautious_growth({}) is None

    def test_no_rerating_below_fair_value(self):
        # Kurs 50 % unter dem fairen Wert: Das Modell rechnet die Aufholung ein, die vorsichtige Variante nicht
        low = valuation.cautious_return(fair_value=200.0, price=100.0, growth=0.03, div_yield=0.02)
        assert low == pytest.approx(0.05)
        model = valuation.expected_returns({"10": {"avg_multiple": 20.0}}, current=10.0, price=100.0, growth=0.03, div_yield=0.02)
        assert model["10"] > low + 0.10

    def test_overvaluation_still_reverts(self):
        low = valuation.cautious_return(fair_value=80.0, price=100.0, growth=0.05, div_yield=0.0)
        assert low == pytest.approx(0.8 ** 0.2 * 1.05 - 1)

    def test_missing_inputs(self):
        assert valuation.cautious_return(None, 100.0, 0.05, 0.0) is None
        assert valuation.cautious_return(100.0, 100.0, None, 0.0) is None


# ---------------------------------------------------------------- Warnzeichen


class TestTrap:
    def test_growth_break(self):
        assert trap.growth_break(-0.01, 0.20)  # sinkende Gewinne
        assert trap.growth_break(0.05, 0.20)  # weniger als die Hälfte des bisherigen Wachstums
        assert not trap.growth_break(0.12, 0.20)
        assert not trap.growth_break(0.02, 0.03)  # bisher kaum Wachstum: kein Bruch
        assert not trap.growth_break(None, 0.20)

    def test_revisions_and_trend(self):
        assert trap.revisions_falling(-0.05) and trap.revisions_falling(0.0, "fallend") and not trap.revisions_falling(-0.01)
        assert trap.trend_broken(-0.06, -0.2) and not trap.trend_broken(0.03, -0.2) and not trap.trend_broken(-0.06, None)

    def test_trap_needs_cheap_and_two_signs(self):
        assert trap.is_trap(-0.5, 2) and not trap.is_trap(-0.5, 1) and not trap.is_trap(0.05, 3) and not trap.is_trap(None, 3)

    def test_build_explains_the_signs(self):
        t = trap.build(-0.5, {"analysts": -0.007, "history": 0.207}, {"change90": -0.04, "trend": "fallend"}, -0.06, -0.23)
        assert t["trap"] and t["cheap"] and t["count"] == 3
        assert "−0,7 %" in t["signs"][0]["text"] and "+20,7 %" in t["signs"][0]["text"]
        calm = trap.build(-0.5, {"analysts": 0.15, "history": 0.2}, {"change90": 0.02, "trend": "steigend"}, 0.05, 0.1)
        assert not calm["trap"] and calm["count"] == 0 and calm["cheap"]

    def test_summary_text_warns_instead_of_recommending(self):
        quality = {"stability": 0.93, "growth": 0.2, "short": False}
        cards = [{"key": "earnings_growth", "label": "Gewinnwachstum", "score": 9}]
        rating = {"label": "stark unterbewertet", "status": "good"}
        plain = summary.build(quality, rating, -0.06, cards)["text"]
        warned = summary.build(quality, rating, -0.06, cards, {"trap": True, "count": 2})["text"]
        assert "günstigen Kaufzeitpunkt" in plain
        assert "günstigen Kaufzeitpunkt" not in warned and "Value-Falle" in warned


# ---------------------------------------------------------------- Tiefenanalyse: neue Felder


class TestDeepFields:
    ROW = {"price": 100.0, "earnings_stability": 0.92, "earnings_growth": 0.2, "quality_years": 7.0, "quality_short": False,
           "fundamentals_source": "SEC EDGAR + Yahoo Finance", "fair_value": 200.0, "deviation": -0.5,
           "rating": {"label": "stark unterbewertet"}, "expected_return": 0.30, "expected_cautious": 0.04,
           "cautious_growth": -0.01, "analyst_growth": -0.01, "warning_signs": 2, "div_yield": 0.05, "roic": 0.33,
           "roic_avg": 0.45, "div_no_cut": 8, "scores": {}}

    def test_cautious_return_and_trap_follow_the_current_price(self):
        d = deep.compact(self.ROW)
        row = {"price": 100.0}
        deep.merge_into(row, d)
        assert row["d_exp_lo"] == pytest.approx(-0.01 + 0.05, abs=1e-4)
        assert row["d_trap"] == 1 and row["d_warn"] == 2 and row["d_roic_avg"] == 0.45 and row["d_nocut"] == 8
        # Kurs über den fairen Wert gestiegen: nicht mehr günstig, also keine Falle; das Multiple fällt zurück
        high = {"price": 250.0}
        deep.merge_into(high, d)
        assert "d_trap" not in high and high["d_exp_lo"] == pytest.approx(0.8 ** 0.2 * 0.99 - 1 + 0.05, abs=1e-4)

    def test_rows_without_cautious_growth_have_no_cautious_return(self):
        d = deep.compact({**self.ROW, "expected_cautious": None})
        row = {"price": 100.0}
        deep.merge_into(row, d)
        assert "d_exp_lo" not in row and "d_exp" in row

    def test_sec_outage_is_retried_the_next_day(self):
        now = 1_800_000_000
        d = {**deep.compact({**self.ROW, "sec_failed": True}), "t": now}
        assert d["sec_err"] is True
        assert deep._is_fresh(d, now + 3600) and not deep._is_fresh(d, now + deep.ERROR_RETRY + 1)
        ok = {**deep.compact(self.ROW), "t": now}
        assert "sec_err" not in ok and deep._is_fresh(ok, now + deep.ERROR_RETRY + 1)

    def test_loss_makers_are_marked(self):
        row = {"price": 10.0}
        deep.merge_into(row, deep.compact({"price": 10.0, "loss_making": True, "quality_years": 8.0}))
        assert row["d_loss"] == 1 and "d_stab" not in row


# ---------------------------------------------------------------- Gesamt-Score mit Beständigkeit


def _peer(i, **extra):
    """Aktie i von 40 im selben Sektor: alle Kennzahlen steigen mit i, die Stabilität je nach Test."""
    return {"symbol": f"S{i}", "sector": "Energie", "roe": 0.05 + i / 100, "roa": 0.02 + i / 200, "net_margin": 0.05 + i / 100,
            "ebitda_margin": 0.1 + i / 100, "net_debt_ebitda": 3 - i / 20, "pe": 30 - i / 2, "forward_pe": 28 - i / 2,
            "pb": 4 - i / 20, "ps": 3 - i / 20, "ev_ebitda": 15 - i / 5, "revenue_growth": i / 100, "eps_growth": i / 50,
            "eps_growth_next": i / 100, "perf_1y": i / 50, "momentum": i / 100, "from_high": -0.4 + i / 100, **extra}


class TestStabilityScore:
    def test_unstable_leader_falls_behind_steady_one(self):
        rows = [_peer(i, d_stab=0.5, d_roic_avg=0.10) for i in range(40)]
        rows[39].update(d_stab=-0.6, d_roic_avg=0.02)  # Zykliker auf dem Hoch: überall vorn, aber Gewinne unstet
        rows[38].update(d_stab=0.95, d_roic_avg=0.30)
        world.add_scores(rows)
        assert rows[39]["score_stability"] < 10 and rows[38]["score_stability"] > 90
        assert rows[38]["score_total"] > rows[39]["score_total"]

    def test_without_deep_data_the_total_uses_four_parts(self):
        rows = [_peer(i) for i in range(40)]
        world.add_scores(rows)
        assert all("score_stability" not in r for r in rows)
        assert rows[39]["score_total"] == 100 and rows[0]["score_total"] == 0

    def test_short_history_counts_at_most_neutral(self):
        assert world._factor({"d_stab": 0.98, "d_short": 1}, "d_stab") == world.SHORT_STABILITY_CAP
        assert world._factor({"d_stab": -0.7, "d_short": 1}, "d_stab") == -0.7  # ein Einbruch zeigt sich trotzdem
        assert world._factor({"d_stab": 0.98}, "d_stab") == 0.98
        assert world._factor({"d_roic": 0.2}, "d_roic_avg") == 0.2  # jüngste Kapitalrendite, solange der Ø fehlt

    def test_rescoring_drops_stale_scores(self):
        rows = [_peer(i) for i in range(40)]
        world.add_scores(rows)
        for r in rows:
            r.pop("perf_1y"), r.pop("momentum"), r.pop("from_high")
        world.add_scores(rows)
        assert all("score_momentum" not in r for r in rows)


# ---------------------------------------------------------------- Fonds, Heimatnotierung, Suche


@pytest.mark.parametrize("name,dropped", [
    ("iShares Trust - iShares Core S&P 500 ETF", True), ("Vanguard All-World ex-US Shares Index ETF", True),
    ("iShares NAFTRAC", True), ("Sprott Physical Gold Trust", True), ("Moneda Deuda Latinoamericana fondo de inversion", True),
    ("Northern Trust Corporation", False), ("Vanguard International Semiconductor Corporation", False),
    ("Realty Income Corporation", False), ("F&C Investment Trust Ord", False), ("HAL Trust", False),
])
def test_exchange_traded_funds_are_not_stocks(name, dropped):
    quote = {"symbol": "X", "longName": name, "currency": "USD", "marketCap": 5e9, "regularMarketPrice": 10.0}
    assert (world.make_listing(quote, "US", {"USD": 1.0}) is None) == dropped


@pytest.fixture
def small_world(monkeypatch):
    stocks = [{"symbol": "NOVO-B.CO", "name": "Novo Nordisk A/S", "isin": "DK0062498333", "country": "DK", "price": 280.0, "market_cap": 160e9},
              {"symbol": "SAP.DE", "name": "SAP SE", "isin": "DE0007164600", "country": "DE", "price": 200.0, "market_cap": 240e9}]
    data = {"format": world.FORMAT, "built_at": "2026-11-12T12:00:00+00:00", "min_cap_eur": 2e9, "eur_usd": 1.1, "count": 2,
            "listings": 2, "countries": {"DK": {"name": "Dänemark", "continent": "Europa"}, "DE": {"name": "Deutschland", "continent": "Europa"}},
            "continents": ["Europa"], "sectors": [], "warnings": [], "stocks": stocks, "alt_isins": {"NOVO-B.CO": ["US6701002056"]}}
    cache.store(world.CACHE_KEY, data)
    monkeypatch.setattr(config, "SNAPSHOT_DIR", cache.CACHE_DIR.parent / "snapshots")
    world._payload.clear()
    yield
    world._payload.clear()


class TestHomeListing:
    def test_adr_points_to_the_home_listing(self, small_world):
        assert world.home_listing("NVO", "Novo Nordisk A/S") == {"symbol": "NOVO-B.CO", "name": "Novo Nordisk A/S"}
        assert world.home_listing("NOVO-B.CO", "Novo Nordisk A/S") is None  # steht selbst in der Weltauswahl
        assert world.home_listing("XYZ", "Unbekannt AG") is None and world.home_listing("XYZ", None) is None

    def test_tradability_falls_back_to_the_home_listing(self, small_world, monkeypatch):
        from aktientool.sources import lsx
        seen = {}
        monkeypatch.setattr(lsx, "current", lambda: {"date": "2026-11-12"})
        monkeypatch.setattr(lsx, "find", lambda listing, isins: seen.update(isins=isins) or (isins[0], ("A3EU6F", "NOVO-NORDISK B", None)))
        info = world.trade_republic("NVO", None, "NOVO-B.CO")
        assert seen["isins"] == ["DK0062498333", "US6701002056"] and info["tradable"] and info["isin"] == "DK0062498333"

    def test_search_lists_world_members_first(self, small_world, monkeypatch):
        from aktientool import server
        from aktientool.sources import yahoo
        monkeypatch.setattr(yahoo, "search", lambda q: [{"symbol": "NVO", "name": "Novo Nordisk A/S"}, {"symbol": "NOVO-B.CO", "name": "Novo Nordisk A/S"},
                                                         {"symbol": "NOV.DE", "name": "Novo Nordisk A/S"}])
        got = [r["symbol"] for r in server.app.test_client().get("/api/search?q=novo").get_json()]
        assert got == ["NOVO-B.CO", "NVO", "NOV.DE"]


# ---------------------------------------------------------------- Rückblick


def _daily(start, days, growth_per_day):
    d0 = dt.date.fromisoformat(start)
    return [[(d0 + dt.timedelta(days=i)).isoformat(), 100 * (1 + growth_per_day) ** i, 100 * (1 + growth_per_day) ** i] for i in range(days)]


class TestRueckblick:
    def test_monthly_closes_use_complete_months_and_fill_gaps(self):
        prices = [["2026-01-15", 10, 10.0], ["2026-01-30", 11, 11.0], ["2026-03-31", 12, 12.0], ["2026-04-10", 13, 13.0]]
        m = rueckblick.monthly_closes(prices, today=dt.date(2026, 4, 20))
        assert m == {"e": "2026-03", "v": [11.0, 11.0, 12.0]}  # Februar ohne Handel, April läuft noch
        assert rueckblick.monthly_closes([], today=dt.date(2026, 4, 20)) is None
        long = rueckblick.monthly_closes(_daily("2010-01-01", 6000, 0.0003), today=dt.date(2026, 6, 15))
        assert len(long["v"]) == rueckblick.MONTHS

    def _prices(self, n=300, months=rueckblick.MONTHS, persistent=True, seed=1):
        """Aktien mit eigenem Trend: Bei `persistent` hält er an (Momentum zahlt sich aus), sonst wechselt er jeden Monat."""
        rng = np.random.default_rng(seed)
        out = {}
        for i in range(n):
            drift = rng.normal(0.005, 0.02)
            steps = rng.normal(drift if persistent else 0.005, 0.03 if persistent else 0.06, months)
            out[f"S{i}"] = {"e": "2026-10", "v": [float(x) for x in 100 * np.exp(np.cumsum(steps))]}
        return out

    def test_momentum_is_found_where_trends_persist(self):
        r = rueckblick.evaluate(self._prices(), "mom121", 6)
        assert r["available"] and r["months"] > 100 and r["count"] == 300
        means = [g["mean"] for g in r["groups"]]
        assert means[-1] > means[0] + 0.05 and r["spread"] == pytest.approx(means[-1] - means[0])
        assert r["rank_correlation"] > 0.1 and r["hit_rate"] > 0.8

    def test_no_effect_in_random_walks(self):
        r = rueckblick.evaluate(self._prices(persistent=False), "mom121", 6)
        assert abs(r["rank_correlation"]) < 0.05

    def test_too_few_stocks_or_months(self):
        assert not rueckblick.evaluate(self._prices(n=50), "mom121", 6)["available"]
        assert not rueckblick.evaluate(self._prices(months=20), "perf12", 12)["available"]
        with pytest.raises(KeyError):
            rueckblick.evaluate({}, "kgv", 6)

    def test_stocks_with_older_data_are_aligned_by_month(self):
        prices = {"A": {"e": "2026-10", "v": [1.0, 2.0, 3.0]}, "B": {"e": "2026-09", "v": [5.0, 6.0]}}
        mat, grid = rueckblick._matrix(prices)
        assert grid[-1] == "2026-10" and list(mat[0, -3:]) == [1.0, 2.0, 3.0]
        assert list(mat[1, -3:-1]) == [5.0, 6.0] and np.isnan(mat[1, -1])

    def test_build_store_and_serve(self, monkeypatch):
        monkeypatch.setattr(config, "SERVERLESS", False)
        rueckblick.reset()
        for sym, p in self._prices(n=220).items():
            rueckblick.put(sym, p)
        rueckblick.put("LEER", None)
        result = rueckblick.result()
        assert result["stocks"] == 220 and set(result["results"]) == {f"{f}:{h}" for f in rueckblick.FACTORS for h in rueckblick.HORIZONS}
        assert result["results"]["mom121:12"]["available"] and result["factors"][0] == ["mom121", "Momentum 12-1"]
        assert json.loads(json.dumps(result))  # reines JSON
        # nur Aktien der Weltauswahl zählen
        assert rueckblick.build(cache.peek(config.MONTHLY_KEY), {"S1", "S2"})["stocks"] == 2
        rueckblick.reset()

    def test_serverless_serves_only_the_delivered_result(self, monkeypatch):
        monkeypatch.setattr(config, "SERVERLESS", True)
        rueckblick.reset()
        assert rueckblick.result()["results"] == {}
        cache.store(config.RUECKBLICK_KEY, {"stocks": 5, "results": {"mom121:6": {"available": False}}})
        assert rueckblick.result()["stocks"] == 5
        rueckblick.reset()


# ---------------------------------------------------------------- Lauf der Tiefenanalyse


def test_deep_run_stores_monthly_prices_and_counts_sec_outages(monkeypatch):
    from aktientool import service
    monkeypatch.setattr(config, "DEEP_DELAY", 0)
    monkeypatch.setattr(config, "SERVERLESS", False)
    monkeypatch.setattr(deep, "_store", None)
    rueckblick.reset()

    def fake_row(symbol, light=False, isin=None):
        assert light
        if symbol == "KAPUTT":
            raise ValueError("keine Daten")
        return {**TestDeepFields.ROW, "symbol": symbol, "sec_failed": symbol == "MSFT",
                "monthly": {"e": "2026-10", "v": [1.0, 2.0, 3.0]}}

    monkeypatch.setattr(service, "summary_row", fake_row)
    status = deep.run_for([{"symbol": s, "isin": None} for s in ("MSFT", "SAP.DE", "KAPUTT")], seconds=30)
    assert status["analysed"] == 2 and status["errors"] == 1 and status["sec_errors"] == 1 and status["long_history"] == 2
    rows = deep.rows()
    assert rows["MSFT"]["sec_err"] is True and rows["MSFT"]["v"] == deep.VERSION and "err" in rows["KAPUTT"]
    assert set(cache.peek(config.MONTHLY_KEY)) == {"MSFT", "SAP.DE"}
    # zweiter Lauf: frische Einträge bleiben, nichts wird doppelt geladen
    monkeypatch.setattr(service, "summary_row", lambda *a, **k: pytest.fail("frischer Eintrag neu geladen"))
    assert deep.run_for([{"symbol": "SAP.DE", "isin": None}], seconds=30)["analysed"] == 2
    monkeypatch.setattr(deep, "_store", None)
    rueckblick.reset()
