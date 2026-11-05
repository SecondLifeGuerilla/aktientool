"""Zukunftseinordnung: keine erfundenen Zuordnungen oder undatierten Belege."""

import datetime as dt
import json

import pytest

from aktientool import outlook
from aktientool.server import app

TODAY = dt.date(2026, 10, 29)


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    data = json.loads(outlook.CATALOG_FILE.read_text("utf-8"))
    path = tmp_path / "outlook.json"
    path.write_text(json.dumps(data), "utf-8")
    monkeypatch.setattr(outlook, "CATALOG_FILE", path)
    return data, path


def test_shipped_catalog_has_complete_evidence():
    data = json.loads(outlook.CATALOG_FILE.read_text("utf-8"))
    outlook.validate(data)
    assert len(data["profiles"]) >= 5
    for p in data["profiles"]:
        found = outlook.for_company(p["symbols"][0], today=dt.date.fromisoformat(p["reviewed_at"]))
        assert found["status"] == "available"
        assert len(found["profile"]["watch"]) == 3


def test_exact_identity_and_foreign_listing():
    assert outlook.for_company(" msft ", today=TODAY)["profile"]["name"] == "Microsoft"
    assert outlook.for_company("MSF.DE", "US5949181045", today=TODAY)["profile"]["name"] == "Microsoft"
    assert outlook.for_company("SAP", "US8030542042", today=TODAY)["profile"]["name"] == "SAP"
    assert outlook.for_company("MSFT", "DE0007164600", today=TODAY)["status"] == "identity_conflict"
    assert outlook.for_company("MSFT", "US0378331005", today=TODAY)["status"] == "identity_conflict"
    # Namen und Branchen werden absichtlich nicht geraten.
    for symbol in ["AAPL", "MSFTX", "MICROSOFT", "SIE.DE.EXTRA"]:
        result = outlook.for_company(symbol, today=TODAY)
        assert result["status"] == "uncovered" and "profile" not in result
        assert len(result["coverage"]) == 5


def test_freshness_boundary_and_future_review():
    before = outlook.for_company("MSFT", today=TODAY - dt.timedelta(days=1))
    assert before["status"] == "uncovered" and not before["coverage"]
    assert not outlook.for_company("MSFT", today=TODAY + dt.timedelta(days=89))["stale"]
    overdue = outlook.for_company("MSFT", today=TODAY + dt.timedelta(days=90))
    assert overdue["stale"] and overdue["age_days"] == 90
    assert overdue["next_review"] == "2027-01-27"


@pytest.mark.parametrize("mutation", [
    lambda p: p["sources"][0].update(url="javascript:alert(1)"),
    lambda p: p["sources"][0].update(url="https://user:secret@example.com"),
    lambda p: p["sources"][0].update(published="2026-10-30"),
    lambda p: p.update(reviewed_at="2026-02-30"),
    lambda p: p["opportunity"].update(source_ids=["missing"]),
    lambda p: p["risk"].update(level="certain"),
    lambda p: p["evidence"][0].update(kind="proven"),
    lambda p: p.update(evidence=[]),
    lambda p: p["dimensions"].pop(),
    lambda p: p["watch"].pop(),
    lambda p: p["symbols"].append("SAP.DE"),
])
def test_invalid_editorial_data_fails_closed(catalog, mutation):
    data, path = catalog
    mutation(data["profiles"][0])
    path.write_text(json.dumps(data), "utf-8")
    assert outlook.for_company("MSFT", today=TODAY) == {"status": "unavailable", "coverage": []}


def test_missing_or_broken_catalog_does_not_break_profile(catalog):
    _, path = catalog
    path.write_text("{", "utf-8")
    assert outlook.for_company("MSFT", today=TODAY)["status"] == "unavailable"
    path.unlink()
    assert outlook.for_company("MSFT", today=TODAY)["status"] == "unavailable"


def test_editorial_updates_are_visible_without_cache_reset(catalog):
    data, path = catalog
    assert outlook.for_company("MSFT", today=TODAY)["profile"]["summary"]
    data["profiles"][0]["summary"] = "Neu geprüfte Einschätzung."
    path.write_text(json.dumps(data), "utf-8")
    assert outlook.for_company("MSFT", today=TODAY)["profile"]["summary"] == "Neu geprüfte Einschätzung."


def test_api_is_independent_of_financial_sources(monkeypatch):
    from aktientool import service, world

    def no_network(*args, **kwargs):
        pytest.fail("Die Zukunftseinordnung darf keine Finanzdaten laden")

    monkeypatch.setattr(service, "build_profile", no_network)
    monkeypatch.setattr(world, "stock", no_network)
    real = outlook.for_company
    monkeypatch.setattr(outlook, "for_company", lambda s, i: real(s, i, today=TODAY))
    with app.test_client() as client:
        r = client.get("/api/outlook/MSFT?isin=US5949181045")
        assert r.status_code == 200 and r.json["status"] == "available"
        assert r.headers["Cache-Control"] == "no-store"
        assert client.get("/api/outlook/AAPL").json["status"] == "uncovered"
        assert client.get("/api/outlook/MSFT?isin=DE0007164600").json["status"] == "identity_conflict"
        assert client.get("/api/outlook/MSFT?isin=invalid").status_code == 400
        assert client.get("/api/outlook/invalid%20symbol").status_code == 400
