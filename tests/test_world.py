import pytest

from aktientool import cache, names, world

RATES = {"USD": 1.0, "EUR": 1.1, "GBP": 1.3, "TWD": 0.03, "HKD": 0.13, "CAD": 0.7, "BRL": 0.2, "INR": 0.012}


def listing(symbol, market, isin, traded, fin="USD", company=None, cap=100e9):
    return {"symbol": symbol, "market": market, "isin": isin, "traded_usd": traded, "fin_ccy": fin,
            "company": company or symbol, "cap_usd": cap, "quote": {}, "fund": {}}


class TestPickHome:
    def test_us_company_beats_its_cdr_and_bdr(self):
        group = [listing("NVDA", "US", "US67066G1040", 40e9), listing("NVDA.TO", "CA", "CA67079A1093", 30e6),
                 listing("NVDC34.SA", "BR", "BRNVDCBDR005", 20e6), listing("NVD.DE", "DE", "US67066G1040", 10e6)]
        assert world.pick_home(group)["symbol"] == "NVDA"

    def test_home_listing_beats_more_traded_adr(self):
        group = [listing("2330.TW", "TW", "TW0002330008", 2e9, "TWD"), listing("TSM", "US", "US8740391003", 4e9, "TWD")]
        assert world.pick_home(group)["symbol"] == "2330.TW"

    def test_adr_of_usd_reporting_company_loses_to_london(self):
        group = [listing("SHEL.L", "GB", "GB00BP6MXD84", 500e6), listing("SHEL", "US", "US7802593050", 450e6)]
        assert world.pick_home(group)["symbol"] == "SHEL.L"

    def test_offshore_company_in_hong_kong_beats_us_adr(self):
        group = [listing("9988.HK", "HK", "KYG017191142", 1e9, "CNY"), listing("BABA", "US", "US01609W1027", 2e9, "CNY")]
        assert world.pick_home(group)["symbol"] == "9988.HK"

    def test_without_home_listing_the_most_traded_wins(self):
        group = [listing("LIN", "US", "IE000S9YS762", 1e9), listing("LIN.DE", "DE", "IE000S9YS762", 20e6)]
        assert world.pick_home(group)["symbol"] == "LIN"

    def test_adr_only_company_keeps_us_listing(self):
        group = [listing("BNTX", "US", "US09075V1026", 200e6, "EUR"), listing("22UA.DE", "DE", "US09075V1026", 5e6, "EUR")]
        assert world.pick_home(group)["symbol"] == "BNTX"

    def test_thai_nvdr_is_not_the_home_listing(self):
        group = [listing("GULF.BK", "TH", "TH1234567890", 10e6, "THB"), listing("GULF-R.BK", "TH", "TH1234567891", 30e6, "THB")]
        assert world.pick_home(group)["symbol"] == "GULF.BK"


@pytest.mark.parametrize("symbol,market,isin,fin,expected", [
    ("SAP.DE", "DE", "DE0007164600", "EUR", "DE"),
    ("0700.HK", "HK", "KYG875721634", "CNY", "CN"),      # Kaimaninseln-Holding einer Festlandfirma
    ("0001.HK", "HK", "KYG217651051", "HKD", "HK"),      # Offshore-Sitz, Hongkonger Firma
    ("LIN", "US", "IE000S9YS762", "USD", "IE"),          # rechtlicher Sitz Irland
    ("PDD", "US", "US7223041028", "CNY", "CN"),          # ADR ohne Heimatnotierung
    ("KSPI", "US", "US48581R2058", "KZT", "KZ"),
    ("RCL", "US", "LR0008862868", "USD", "US"),          # Liberia-Sitz, US-Firma
    ("POPULAR", "US", "PR7331747001", "USD", "US"),
    ("XYZ.L", "GB", "", "GBP", "GB"),                    # ohne ISIN zählt die Börse
])
def test_country_of(symbol, market, isin, fin, expected):
    assert world.country_of(listing(symbol, market, isin, 1, fin)) == expected


def test_foreign_receipt_is_dropped_but_us_listing_abroad_is_kept():
    assert world.is_foreign_receipt(listing("RLI.VI", "AT", "US7594701077", 1, "INR"))
    assert not world.is_foreign_receipt(listing("85H1.DE", "DE", "US72703X1063", 1, "USD"))


def test_groups_merge_by_company_id_and_by_isin():
    nse = listing("TCS.NS", "IN", "INE467B01029", 1, "INR", company="finmb_1")
    bse = listing("TCS.BO", "IN", "INE467B01029", 1, "INR", company="finmb_2")
    adr = listing("TCSADR", "US", "US0000000001", 1, "INR", company="finmb_2")
    other = listing("INFY.NS", "IN", "INE009A01021", 1, "INR", company="finmb_3")
    groups = world.group_listings([nse, bse, adr, other])
    assert sorted(len(g) for g in groups) == [1, 3]


class TestMakeListing:
    def quote(self, **kw):
        return {"symbol": "HSBA.L", "quoteType": "EQUITY", "currency": "GBp", "marketCap": 200e9,
                "regularMarketPrice": 1400.0, "averageDailyVolume3Month": 1e6, "messageBoardId": "finmb_9",
                "fundamentals": {"isin": "gb0005405286"}, **kw}

    def test_pence_prices_and_major_currency_market_cap(self):
        l = world.make_listing(self.quote(), "GB", RATES)
        assert l["cap_usd"] == pytest.approx(200e9 * 1.3)
        assert l["traded_usd"] == pytest.approx(1e6 * 14.0 * 1.3)  # 1.400 Pence = 14 Pfund
        assert l["isin"] == "GB0005405286" and l["company"] == "finmb_9"

    @pytest.mark.parametrize("symbol,name", [("BAC-PB", "Bank of America"), ("CSE-PA.TO", "Capstone"),
                                             ("VOLO-PREF.ST", "Volati"), ("BPCOG.PA", "Groupe BPCE 3.1% NTS 17/02/27")])
    def test_preferred_shares_and_bonds_are_skipped(self, symbol, name):
        assert world.make_listing(self.quote(symbol=symbol, longName=name), "US", RATES) is None

    @pytest.mark.parametrize("symbol", ["BRK-B", "NOVO-B.CO", "BIP-UN.TO", "BF-B"])
    def test_share_classes_are_kept(self, symbol):
        assert world.make_listing(self.quote(symbol=symbol), "US", RATES) is not None

    def test_unknown_currency_is_skipped(self):
        assert world.make_listing(self.quote(currency="XYZ"), "GB", RATES) is None


def test_make_row_converts_units_and_drops_missing_values():
    l = listing("KO", "US", "US1912161007", 1e9, cap=400e9)
    l["quote"] = {"longName": "The Coca-Cola Company", "currency": "USD", "regularMarketPrice": 92.123456,
                  "dividendYield": 2.27, "epsTrailingTwelveMonths": 3.0, "epsForward": 3.3,
                  "averageAnalystRating": "1.7 - Buy", "fiftyTwoWeekChangePercent": 32.0, "trailingPE": 0.5}
    l["fund"] = {"sector": "Consumer Defensive", "industry": "Beverages—Non-Alcoholic",
                 "peratio": {"lasttwelvemonths": 28.0}, "returnonequity": {"lasttwelvemonths": 42.05},
                 "lastclosemarketcaptotalrevenue": {"lasttwelvemonths": 8.0},
                 "consecutive_years_of_dividend_growth_count": 23}
    row = world.make_row(l, "US", eur_usd=1.1)
    assert row["sector"] == "Basiskonsum" and row["industry"] == "Alkoholfreie Getränke"
    assert row["market_cap"] == pytest.approx(400e9 / 1.1, rel=1e-3)
    assert row["revenue"] == pytest.approx(row["market_cap"] / 8, rel=1e-3)
    assert row["div_yield"] == pytest.approx(0.0227)
    assert row["payout"] == pytest.approx(0.0227 * 28, rel=1e-3)
    assert row["roe"] == pytest.approx(0.4205)
    assert row["eps_growth_next"] == pytest.approx(0.1)
    assert row["perf_1y"] == pytest.approx(0.32)
    assert row["rating"] == 1.7 and row["div_years"] == 23
    assert row["price"] == pytest.approx(92.1235)  # Kurs auf 6 Stellen, Kennzahlen auf 4
    assert "debt_equity" not in row and "forward_pe" not in row


def test_make_row_ignores_implausible_pe():
    l = listing("AMC.L", "GB", "NL0015074C60", 1)
    l["quote"] = {"trailingPE": 0.0001}
    l["fund"] = {"peratio": 0.3}
    assert "pe" not in world.make_row(l, "NL", eur_usd=1.1)


def test_make_row_caps_base_effects_and_data_errors():
    # BASF: Gewinn je Aktie +1.432 % nach dem Einbruch; Biotech ohne Umsatz: Bruttomarge −176.000 %
    l = listing("BAS.DE", "DE", "DE000BASF111", 1)
    l["quote"] = {"epsTrailingTwelveMonths": 0.01, "epsForward": 2.0}
    l["fund"] = {"epsgrowth": 1432.0, "grossprofitmargin": -176400.0, "returnonequity": 12.0, "beta": 95.2}
    row = world.make_row(l, "DE", eur_usd=1.1)
    assert row["eps_growth"] == 3.0 and row["eps_growth_next"] == 3.0 and row["gross_margin"] == -1.0
    assert row["roe"] == pytest.approx(0.12) and row["beta"] == 5.0
    assert sorted(row["capped"]) == ["beta", "eps_growth", "eps_growth_next", "gross_margin"]


def test_make_row_drops_ratios_with_flipped_sign():
    l = listing("BIO", "US", "US0000000002", 1)
    l["fund"] = {"ebitdamargin": -35.0, "netdebtebitda": -4.2, "totaldebtequity": -250.0}
    row = world.make_row(l, "US", eur_usd=1.1)
    assert row["ebitda_margin"] == pytest.approx(-0.35)
    assert "net_debt_ebitda" not in row  # negatives EBITDA, kein Nettoguthaben
    assert "debt_equity" not in row  # negatives Eigenkapital
    assert "capped" not in row


def test_industry_names_from_profile_and_screener():
    assert names.industry_de("Software - Infrastructure") == "Software: Infrastruktur"
    assert names.industry_de("Software—Infrastructure") == "Software: Infrastruktur"
    assert names.industry_de("Unbekannte Branche") == "Unbekannte Branche"
    assert names.industry_de(None) is None


def test_every_market_has_a_country_name():
    assert all(code in names.COUNTRIES for code in world.MARKETS)
    assert all(continent in names.CONTINENTS for _, continent in names.COUNTRIES.values())


def test_cache_store_and_peek(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path)
    assert cache.peek("welt") is None
    cache.store("welt", {"stocks": [1, 2]})
    assert cache.peek("welt") == {"stocks": [1, 2]}
    assert cache.cache_age("welt") < 5


class TestScores:
    def test_percentile_ranks(self):
        assert world.percentile_ranks([10, None, 30, 20]) == [0.0, None, 1.0, 0.5]
        assert world.percentile_ranks([5, 5, 7]) == [0.25, 0.25, 1.0]  # Gleichstand gemittelt
        assert world.percentile_ranks([None, 3]) == [None, 0.5]

    def rows(self, n=30):
        # je höher i, desto profitabler, günstiger und wachstumsstärker
        return [{"symbol": f"S{i}", "sector": "Industrie", "roe": i / 100, "roa": i / 200, "net_margin": i / 100,
                 "ebitda_margin": i / 50, "net_debt_ebitda": 5 - i / 10, "pe": 40 - i, "forward_pe": 35 - i, "pb": 5 - i / 10,
                 "ps": 4 - i / 10, "ev_ebitda": 25 - i / 2, "revenue_growth": i / 100, "eps_growth": i / 50, "eps_growth_next": i / 80,
                 "perf_1y": i / 100, "momentum": i / 200, "from_high": -0.3 + i / 100, "div_yield": 0.0 if i < 10 else i / 1000,
                 "div_years": i, "payout": 0.5, "ev_ebit": 30 - i / 2, "roc": i / 100} for i in range(n)]

    def test_better_metrics_give_higher_scores(self):
        rows = self.rows()
        world.add_scores(rows)
        best, worst = rows[-1], rows[0]
        for key in ("score_quality", "score_value", "score_growth", "score_momentum", "score_total", "magic_formula"):
            assert best[key] == 100 and worst[key] == 0, key
        assert "score_dividend" not in worst  # zahlt keine Dividende
        assert rows[-1]["score_dividend"] == 100

    def test_scores_compare_within_sector(self):
        rows = self.rows()
        banks = [{**r, "symbol": f"B{i}", "sector": "Finanzen", "pe": r["pe"] / 4} for i, r in enumerate(self.rows())]
        world.add_scores(rows + banks)
        # Banken sind absolut viel günstiger, im eigenen Sektor aber gleich verteilt
        assert banks[-1]["score_value"] == rows[-1]["score_value"]
        assert "magic_formula" not in banks[-1]  # wie bei Greenblatt ohne Finanzwerte

    def test_too_few_metrics_give_no_score(self):
        rows = [{"symbol": f"S{i}", "sector": "Industrie", "pe": 10 + i} for i in range(30)]
        world.add_scores(rows)
        assert "score_value" not in rows[0] and "score_total" not in rows[0]


def test_theme_matcher_by_symbol_isin_industry_and_name():
    match = world.theme_matcher({
        "KI": {"aktien": ["NVDA", "DE0007164600"], "namen": ["\\bAI\\b"]},
        "Erneuerbare": {"branchen": ["Solar"]},
    })
    assert match({"symbol": "NVDA", "name": "NVIDIA Corporation"}) == ["KI"]
    assert match({"symbol": "SAP.DE", "isin": "DE0007164600", "name": "SAP SE"}) == ["KI"]
    assert match({"symbol": "SOUN", "name": "SoundHound AI, Inc."}) == ["KI"]
    assert match({"symbol": "MAIN", "name": "Main Street Capital"}) == []  # „AI“ nur als eigenes Wort
    assert match({"symbol": "FSLR", "name": "First Solar", "industry": "Solar"}) == ["Erneuerbare"]


def test_shipped_themes_file_is_valid():
    themes = world.load_themes()
    assert "Künstliche Intelligenz" in themes and "Robotik & Automatisierung" in themes
    match = world.theme_matcher(themes)  # alle Muster kompilieren
    assert "Künstliche Intelligenz" in match({"symbol": "NVDA", "name": "NVIDIA Corporation"})
    assert all(t.get("kurz") and t.get("beschreibung") for t in themes.values())
