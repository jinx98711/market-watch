#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")" || exit 1
if [ ! -f .local/publisher.json ]; then
  echo "缺少本机同步设置 .local/publisher.json"
  exit 1
fi
python3 -B - <<'PY'
from pathlib import Path
import subprocess, sys
root = Path.cwd()
with (root/'.local/publisher.log').open('a') as log:
    subprocess.Popen([sys.executable, '-B', str(root/'publish.py'), '--watch'],
                     stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                     start_new_session=True)
PY
