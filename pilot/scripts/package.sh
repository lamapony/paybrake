#!/usr/bin/env bash
# Zip pilot/extension into dist/paybrake-pilot.zip (files at the zip root). No `zip` binary needed.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/../dist/paybrake-pilot.zip"
mkdir -p "$(dirname "$out")"
rm -f "$out"
python3 - "$here/extension" "$out" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in sorted(files):
            if f.endswith((".log", ".DS_Store")): continue
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src))
PY
unzip -l "$out"
