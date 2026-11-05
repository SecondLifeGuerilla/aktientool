#!/usr/bin/env bash
# Ordner $1 als einzigen Commit auf den Branch „data“ legen (ersetzt den alten Stand, damit das Repo nicht wächst).
set -euo pipefail
dir="$1"
msg="${2:-Daten}"
cd "$dir"
rm -rf .git
git init -q -b data
git add -A
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "$msg ($(date -u +%Y-%m-%dT%H:%MZ))"
git push -q -f "$DATA_REMOTE" data
echo "Branch data aktualisiert: $(du -sh . | cut -f1)"
