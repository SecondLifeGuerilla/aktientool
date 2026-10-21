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
