#!/bin/sh
# 打 Windows 安装包（NSIS，x64 和 arm64 各一个）。可以在 Mac 上直接打；没有代码签名证书时，
# 别人安装时 SmartScreen 会提示「未知发布者」，点「更多信息 → 仍要运行」。
set -eu
cd "$(dirname "$0")/.."
[ -f resources/base.db.gz ] || { echo "缺少 resources/base.db.gz，先运行 npm run data"; exit 1; }
node scripts/stamp.mjs
out=$(mktemp -d /private/tmp/legalchina-win.XXXXXX)
./node_modules/.bin/electron-builder --win nsis --x64 --arm64 --config.directories.output="$out" "$@"
mkdir -p dist
# 同时打两种芯片时 electron-builder 还会多出一个合并安装包（不带芯片名），不需要
cp "$out"/*-win-x64-setup.exe "$out"/*-win-arm64-setup.exe dist/
echo "安装包在 dist/："; ls -lh dist/*.exe
