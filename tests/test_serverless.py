"""Serverloser Betrieb: Daten-Bündel entpacken, Korrekturen je Anfrage, keine Hintergrund-Läufe. Ohne Netzwerk."""

import gzip
import io
import json
import os
import tarfile
import time

import pytest

from aktientool import cache, config, deep, remote, server, userdata, world
from aktientool.names import CONTINENTS


def _world_data():
    return {"format": world.FORMAT, "built_at": "2026-11-05T04:00:00+00:00", "min_cap_eur": 2e9, "eur_usd": 1.08,
            "count": 2, "listings": 2, "countries": {"US": {"name": "USA", "continent": "Nordamerika"}},
            "continents": CONTINENTS, "sectors": ["Technologie"], "warnings": [],
            "stocks": [{"symbol": "MSFT", "name": "Microsoft", "isin": "US5949181045", "country": "US", "price": 400.0,
                        "sector": "Technologie", "market_cap": 3e12, "score_total": 80},
                       {"symbol": "OKE", "name": "ONEOK", "isin": "US6826801036", "country": "US", "price": 70.0,
                        "sector": "Energie", "market_cap": 4e10, "score_total": 60}],
            "alt_isins": {}}


def _bundle(files: dict[str, bytes], mtime: float) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, raw in files.items():
            info = tarfile.TarInfo(name)
            info.size, info.mtime = len(raw), int(mtime)
            tar.addfile(info, io.BytesIO(raw))
    return buf.getvalue()


@pytest.fixture
def serverless(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SERVERLESS", True)
    monkeypatch.setattr(config, "SNAPSHOT_DIR", tmp_path / "snapshots")
    world._payload.clear()
    yield
    world._payload.clear()


def test_extract_keeps_mtime_and_rejects_paths(serverless, tmp_path):
    old = time.time() - 5 * 86400
    data = _bundle({"manifest.json": b'{"built": "x"}', "cache/welt.json": json.dumps(_world_data()).encode(),
                    "snapshots/abschlag_holdings.json": b"{}", "../boese.json": b"x", "cache/../../boese.json": b"x"}, old)
    assert remote.extract(data) == {"built": "x"}
    path = cache.CACHE_DIR / "welt.json"
    assert path.exists() and abs(path.stat().st_mtime - old) < 2
    assert (config.SNAPSHOT_DIR / "abschlag_holdings.json").exists()
    assert not (tmp_path / "boese.json").exists()
    # fünf Tage alt: lokal würde die Weltauswahl neu gebaut, serverlos nicht
    assert world.status()["ready"] and world.status()["managed"] and not world.status()["running"]
    assert world.start() is False and deep.start([{"symbol": "MSFT"}]) is False


def test_overrides_apply_per_request_only(serverless):
    cache.store(world.CACHE_KEY, _world_data())
    plain = json.loads(world.payload(compressed=False))
    assert all("tr" not in r for r in plain["stocks"])  # ohne Handelsliste unbekannt
    with userdata.use_context({"tradable": {"OKE": True}}):
        rows = {r["symbol"]: r for r in json.loads(gzip.decompress(world.payload(compressed=True)))["stocks"]}
        assert rows["OKE"]["tr"] == 1 and "tr" not in rows["MSFT"]
        assert world.stock("OKE")["tr"] == 1
        assert world.tradable_flags(["OKE", "XYZ"]) == {"OKE": True}
        key = world.status()["version"]
    assert world.status()["version"] != key  # andere Korrekturen, andere Datenversion
    assert "tr" not in world.stock("OKE")


def test_deep_rows_reload_when_file_changes(serverless):
    cache.store(config.DEEP_KEY, {"rows": {"MSFT": {"t": 1, "stab": 0.9}}})
    assert deep.rows()["MSFT"]["stab"] == 0.9
    time.sleep(0.01)
    cache.store(config.DEEP_KEY, {"rows": {"MSFT": {"t": 2, "stab": 0.5}}})
    os.utime(cache._path(config.DEEP_KEY), (time.time() + 5, time.time() + 5))
    assert deep.rows()["MSFT"]["stab"] == 0.5


def test_world_endpoint_without_data_explains(serverless, monkeypatch):
    monkeypatch.setattr(remote, "ensure", lambda force=False: None)
    client = server.app.test_client()
    st = client.get("/api/world/status").get_json()
    assert not st["ready"] and st["managed"] and st["error"]
    assert client.get("/api/info").get_json()["serverless"] is True


# ---------------------------------------------------------------- Live-Kurse von Tradegate

def test_tradegate_parse():
    from aktientool.sources import tradegate
    q = tradegate.parse({"bid": 158.56, "ask": 158.64, "delta": -5.27, "executions": 15083, "last": "158,70",
                         "high": 160.26, "low": 156.16, "close": 167.52})
    assert q["price"] == 158.70 and abs(q["change"] + 0.0527) < 1e-9 and q["bid"] == 158.56 and q["source"] == "Tradegate"
    assert tradegate.parse({"last": "1.234,50", "close": "1.200,00", "executions": 3})["price"] == 1234.5
    assert tradegate.parse({"last": "1.234,50", "close": "1.200,00", "executions": 3})["change"] == pytest.approx(1234.5 / 1200 - 1)
    assert tradegate.parse({"last": "158,70", "executions": 0}) is None  # heute kein Handel
    assert tradegate.parse({"last": "-", "executions": 5}) is None


def test_quotes_prefer_live_price(monkeypatch):
    from aktientool.sources import tradegate
    monkeypatch.setattr(tradegate, "quotes", lambda isins: {
        "US67066G1040": {"price": 158.7, "change": -0.0527, "bid": 158.5, "ask": 158.9, "source": "Tradegate"},
        "XX0000000000": {"price": 5.0, "change": 0.1, "bid": None, "ask": None, "source": "Tradegate"}})
    rows = [{"symbol": "NVDA", "price": 166.76, "change": 0.0233, "currency": "EUR", "original_price": 186.64},
            {"symbol": "ODD", "price": 100.0, "change": 0.0, "currency": "EUR"},
            {"symbol": "KO", "price": 60.0, "change": 0.01, "currency": "EUR"}]
    out = {r["symbol"]: r for r in server._with_live(rows, {"NVDA": "US67066G1040", "ODD": "XX0000000000"})}
    assert out["NVDA"]["price"] == 158.7 and out["NVDA"]["live_source"] == "Tradegate" and out["NVDA"]["original_price"] == 186.64
    assert out["ODD"]["price"] == 100.0 and "live_source" not in out["ODD"]  # andere Gattung: verworfen
    assert out["KO"]["price"] == 60.0
