#!/bin/sh
# 打 macOS 安装包（DMG）。默认 Apple 芯片（arm64，M1–M5 通用）；Intel 芯片用 MAC_ARCH=x64。
# 钥匙串里有「Developer ID Application」证书时正式签名并公证（先运行一次
#   xcrun notarytool store-credentials legalchina  把公证凭据存进钥匙串）；
# 没有证书时临时签名（ad-hoc），别的 Mac 第一次打开要右键 →「打开」。
set -eu
MAC_ARCH="${MAC_ARCH:-arm64}"
case "$MAC_ARCH" in arm64|x64) ;; *) echo "MAC_ARCH 只能是 arm64 或 x64"; exit 2 ;; esac
cd "$(dirname "$0")/.."
[ -f resources/base.db.gz ] || { echo "缺少 resources/base.db.gz，先运行 npm run data"; exit 1; }
node scripts/stamp.mjs
out=$(mktemp -d /private/tmp/legalchina-mac.XXXXXX)
if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "找到 Developer ID 证书：正式签名并公证"
  APPLE_KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-legalchina}" ./node_modules/.bin/electron-builder --mac dmg --"$MAC_ARCH" -c.mac.notarize=true --config.directories.output="$out" "$@"
  for dmg in "$out"/*.dmg; do xcrun stapler staple "$dmg" || true; done
else
  echo "没有 Developer ID 证书：临时签名（ad-hoc）"
  CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --mac dmg --"$MAC_ARCH" -c.mac.identity=- --config.directories.output="$out" "$@"
fi
mkdir -p dist
cp "$out"/*.dmg dist/
echo "安装包在 dist/："; ls -lh dist/*.dmg
