#!/bin/sh
# Claude for Legal China：一键启动。首次运行会建虚拟环境、下载数据、抓取指导性案例并建索引（约 10 分钟）。
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
if [ ! -x .venv/bin/python ]; then
  echo "创建 Python 虚拟环境…"
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
if [ ! -f data/legal.db ] || [ "$1" = "--rebuild" ]; then
  .venv/bin/python scripts/download_data.py
  [ -f data/cases.jsonl ] || .venv/bin/python scripts/fetch_cases.py
  .venv/bin/python scripts/build_index.py
fi
( sleep 1.5; open "http://127.0.0.1:$PORT" 2>/dev/null || xdg-open "http://127.0.0.1:$PORT" 2>/dev/null || true ) &
exec .venv/bin/python server.py --port "$PORT"
