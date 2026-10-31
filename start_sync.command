#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")" || exit 1
if [ ! -f .local/publisher.json ]; then
  echo "缺少本机同步设置 .local/publisher.json"
  exit 1
fi
nohup python3 -B publish.py --watch >> .local/publisher.log 2>&1 < /dev/null &
