#!/bin/sh
# usage: tools/run_checks.sh FIX_PARENT   (FIX_PARENT/tt holds the fixture, FIX_PARENT/ax has axe-core)
set -e
P=$1; HERE=$(cd "$(dirname "$0")/.." && pwd)
python3 "$HERE/tools/mkedge.py" "$P" >/dev/null
for d in "$P"/edge/*/; do (cd "$d" && mkdir -p sec && WHOOP_NOUPDATE=1 WHOOP_SECRET_DIR=$PWD/sec python3 whoop.py --build-only --quiet >/dev/null 2>&1); done
export NODE_PATH=$(npm root -g)
node "$HERE/tools/edge.js" "$P/edge" $(ls "$P/edge") | grep -v 'errs=\[\] bad=\[\] banners=\[\] dashes=0 overflow=false' || true
node "$HERE/tools/axe.js" "$P/edge/full/whoop_dashboard.html" "$P/ax/node_modules/axe-core/axe.min.js"
echo checks done
