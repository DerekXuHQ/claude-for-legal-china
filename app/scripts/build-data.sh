#!/bin/sh
# 构建随安装包分发的数据包：下载法规数据集 → 抓取指导性案例 → 建 base.db → 官方全面核对 → 压缩。
# 需要 Python 3.10+（pyarrow）和 Node 22+。官方核对每个网站每秒最多一个请求，全程约半小时。
set -eu
cd "$(dirname "$0")/.."
[ -x .venv/bin/python ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
[ -d data/raw/documents ] || .venv/bin/python scripts/download_data.py
.venv/bin/python scripts/fetch_cases.py
.venv/bin/python scripts/build_index.py
# base.db 是重新建的：先把以前抓到的官方文本全部重新并入（不访问网站），再去官网看有没有新的
node scripts/official-sync.mjs --replay
node scripts/official-sync.mjs "$@"
node scripts/pack-data.mjs
