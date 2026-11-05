import pytest

from aktientool import cache


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    """Jeder Test bekommt einen eigenen, leeren Cache: Attrappen (etwa für Yahoo-Kurse) landen sonst im echten
    Cache unter data/cache und verfälschen das laufende Tool."""
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")
