#!/bin/sh
# 打 Windows 安装包（NSIS，x64 和 arm64 各一个）。可以在 Mac 上直接打；没有代码签名证书时，
# 别人安装时 SmartScreen 会提示「未知发布者」，点「更多信息 → 仍要运行」。
set -eu
cd "$(dirname "$0")/.."
[ -f resources/base.db.gz ] || { echo "缺少 resources/base.db.gz，先运行 npm run data"; exit 1; }
out=$(mktemp -d /private/tmp/legalchina-win.XXXXXX)
./node_modules/.bin/electron-builder --win nsis --x64 --arm64 --config.directories.output="$out" "$@"
mkdir -p dist
cp "$out"/*.exe dist/
echo "安装包在 dist/："; ls -lh dist/*.exe
