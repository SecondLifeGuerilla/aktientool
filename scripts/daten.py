"""Täglicher Daten-Workflow für den serverlosen Betrieb (GitHub Actions, siehe .github/workflows/daten.yml).

Baut, was der Server lokal im Hintergrund erledigt, und legt es in den Ordner --out (Arbeitskopie des Branches
„data“), den der Server auf Vercel liest (aktientool/remote.py):

1. Handelsliste der LS Exchange, Weltauswahl (wenn älter als einen Tag), Closed-End-Fonds, Abschläge der Holdings
2. optional: Positionen und Verlauf der handelbaren Fonds vorladen (--warm-trusts)
3. optional: Tiefenanalyse der Weltauswahl für höchstens --deep-minutes Minuten; sie setzt beim nächsten Lauf fort
4. Tagesstand der Weltauswahl, bundle.tar.gz und snapshots/index.json schreiben

Lokal ausprobieren:  python scripts/daten.py --out /tmp/aktientool-daten --deep-minutes 2
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import logging
import os
import re
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Teile des Caches, die der Server braucht (alles andere lädt er bei Bedarf selbst)
BUNDLE_KEYS = re.compile(r"^(welt|tiefenanalyse|lsx_handelsliste|trusts_fonds|trust_positionen_.+|abschlag_kennzahlen_.+)\.json$")
SNAPSHOT_EXTRA = "abschlag_holdings.json"
WORLD_REBUILD_AFTER = 20 * 3600  # Weltauswahl täglich neu, mit etwas Spielraum für schwankende Startzeiten

log = logging.getLogger("daten")


def _setup(out: Path) -> None:
    os.environ["AKTIENTOOL_SERVERLESS"] = "0"
    os.environ.setdefault("AKTIENTOOL_DATA_DIR", str(ROOT / "data-workflow"))
    os.environ["AKTIENTOOL_SNAPSHOT_DIR"] = str(out / "snapshots")
    sys.path.insert(0, str(ROOT))


def _restore(out: Path) -> None:
    from aktientool import remote
    bundle = out / "bundle.tar.gz"
    if bundle.exists():
        manifest = remote.extract(bundle.read_bytes())
        log.info("Letzten Stand übernommen (gebaut %s)", manifest.get("built"))


def _bundle(out: Path, extra: dict) -> None:
    from aktientool import config
    buf = io.BytesIO()
    files = sorted(p for p in config.CACHE_DIR.glob("*.json") if BUNDLE_KEYS.match(p.name))
    manifest = {"built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "files": len(files), **extra}
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=9) as tar:
        raw = json.dumps(manifest, indent=1).encode()
        info = tarfile.TarInfo("manifest.json")
        info.size, info.mtime = len(raw), int(time.time())
        tar.addfile(info, io.BytesIO(raw))
        for p in files:
            tar.add(p, arcname=f"cache/{p.name}")
        rec = config.SNAPSHOT_DIR / SNAPSHOT_EXTRA
        if rec.exists():
            tar.add(rec, arcname=f"snapshots/{SNAPSHOT_EXTRA}")
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "bundle.tar.gz.part"
    tmp.write_bytes(buf.getvalue())
    tmp.replace(out / "bundle.tar.gz")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), "utf-8")
    log.info("bundle.tar.gz: %d Dateien, %.1f MB", len(files), len(buf.getvalue()) / 1e6)


def _snapshot_index(out: Path) -> None:
    from aktientool import snapshots
    folder = out / "snapshots"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.json").write_text(json.dumps({"dates": snapshots.dates()}), "utf-8")


def _step(name: str, fn) -> bool:
    started = time.time()
    try:
        fn()
        log.info("%s: fertig (%.0f s)", name, time.time() - started)
        return True
    except Exception:
        log.exception("%s fehlgeschlagen", name)
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path, help="Arbeitskopie des Branches data")
    ap.add_argument("--deep-minutes", type=float, default=0, help="höchstens so lange Tiefenanalyse")
    ap.add_argument("--warm-trusts", action="store_true", help="Positionen und Verlauf der handelbaren Fonds vorladen")
    args = ap.parse_args()
    out = args.out.resolve()
    _setup(out)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("yfinance").setLevel(logging.WARNING)

    from aktientool import cache, config, deep, snapshots, trusts, world
    from aktientool.sources import lsx

    _restore(out)
    _step("Handelsliste der LS Exchange", lsx.refresh_now)
    age = cache.cache_age(world.CACHE_KEY)
    if age is None or age > WORLD_REBUILD_AFTER:
        _step("Weltauswahl", world.build_now)
    else:
        log.info("Weltauswahl ist %.1f Stunden alt, bleibt", age / 3600)
    _step("Closed-End-Fonds", trusts.refresh_now)
    _step("Abschläge der Holdings", lambda: trusts.holding_rows())
    if args.warm_trusts:
        _step("Positionen der handelbaren Fonds", trusts.warm_now)

    universe = world.universe()
    if not universe:
        log.error("Keine Weltauswahl vorhanden")
    deep_status = None
    if universe and args.deep_minutes > 0:
        def run():
            nonlocal deep_status
            deep_status = deep.run_for(universe, args.deep_minutes * 60)
            log.info("Tiefenanalyse: %d von %d Aktien analysiert, %d Fehler", deep_status["analysed"],
                     len(universe), deep_status["errors"])
        _step("Tiefenanalyse", run)

    if universe:  # Tagesstand mit den Ergebnissen der Tiefenanalyse (überschreibt den von heute früh)
        data = json.loads(world.payload(compressed=False))
        _step("Tagesstand", lambda: snapshots.save(data["stocks"], overwrite=True))
    deep_info = deep.status(len(universe))
    _bundle(out, {"world_built_at": (cache.peek(world.CACHE_KEY) or {}).get("built_at"), "stocks": len(universe),
                  "deep_analysed": deep_info["analysed"], "deep_stale": deep_info["stale"]})
    _snapshot_index(out)
    return 0 if universe else 1


if __name__ == "__main__":
    raise SystemExit(main())
