#!/bin/bash
# 在本机 iPhone 模拟器里编译并打开 iOS 版：cd app && npm run ios:sim
# 第一次运行前：Xcode 已安装并接受许可（sudo xcodebuild -license accept），brew install xcodegen
# 参数：-autotest 运行自检（结果在 App 数据目录 data/autotest.json）
set -euo pipefail
cd "$(dirname "$0")"
BUNDLE=com.derekxuhq.chinalawsearch

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "Xcode 还不能用。请先在「终端」里运行：sudo xcodebuild -license accept"; exit 1
fi
command -v xcodegen >/dev/null || brew install xcodegen

# iOS 模拟器（Xcode 26 起需要单独下载，约 8 GB）
if ! xcrun simctl list runtimes | grep -q "iOS"; then
  echo "下载 iOS 模拟器（约 8 GB，需要一段时间）…"
  xcodebuild -downloadPlatform iOS
fi

(cd .. && npm run ios:web)
xcodegen generate >/dev/null
echo "编译中…"
xcodebuild -project ChinaLawSearch.xcodeproj -scheme ChinaLawSearch -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build -quiet

UDID=$(xcrun simctl list devices available -j | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).devices;const all=Object.entries(d).filter(([k])=>/iOS/.test(k)).sort().reverse().flatMap(([,v])=>v);const p=all.find(x=>x.state==="Booted"&&/^iPhone/.test(x.name))||all.find(x=>/^iPhone 1[5-9]( Pro)?$/.test(x.name))||all.find(x=>/^iPhone/.test(x.name));console.log(p?p.udid:"")})')
[ -n "$UDID" ] || { echo "没有可用的 iPhone 模拟器"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator --args -CurrentDeviceUDID "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" build/Build/Products/Debug-iphonesimulator/ChinaLawSearch.app
if [ "${1:-}" = "-autotest" ]; then xcrun simctl launch "$UDID" "$BUNDLE" -autotest YES; else xcrun simctl launch "$UDID" "$BUNDLE"; fi
echo "已在模拟器里打开。App 数据目录：$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)/Documents/data"
