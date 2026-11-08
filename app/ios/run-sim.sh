#!/bin/bash
# 在本机 iPhone 模拟器里编译并打开 iOS 版：cd app && npm run ios:sim
# 第一次运行前：Xcode 已安装并接受许可（sudo xcodebuild -license accept），brew install xcodegen
# 默认用已开着的 iPhone 18 Pro（在 Device Hub 里开好）；也可以先设 UDID=<设备 ID> 指定
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

# 选设备：已开着的 iPhone 18 Pro（本机测试用这台）→ 最新系统里已开着的 iPhone → 最新系统里的 iPhone 18 Pro / 15–19 → 任意 iPhone
UDID=${UDID:-}; [ -n "$UDID" ] || UDID=$(xcrun simctl list devices available -j | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).devices;const all=Object.entries(d).filter(([k])=>/iOS/.test(k)).sort((a,b)=>b[0].localeCompare(a[0],"en",{numeric:true})).flatMap(([,v])=>v);const on=all.filter(x=>x.state==="Booted"&&/^iPhone/.test(x.name));const p=on.find(x=>x.name==="iPhone 18 Pro")||on[0]||all.find(x=>x.name==="iPhone 18 Pro")||all.find(x=>/^iPhone 1[5-9]( Pro)?$/.test(x.name))||all.find(x=>/^iPhone/.test(x.name));console.log(p?p.udid:"")})')
[ -n "$UDID" ] || { echo "没有可用的 iPhone 模拟器"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true
# 打开模拟器窗口：Xcode 27 起叫 Device Hub，之前叫 Simulator。打不开也不影响安装和启动
DEV="$(xcode-select -p)/.."
if [ -d "$DEV/Applications/DeviceHub.app" ]; then open -a "$DEV/Applications/DeviceHub.app" --args -CurrentDeviceUDID "$UDID" || true
elif [ -d "$DEV/Developer/Applications/Simulator.app" ]; then open -a "$DEV/Developer/Applications/Simulator.app" --args -CurrentDeviceUDID "$UDID" || true
else open -a Simulator --args -CurrentDeviceUDID "$UDID" 2>/dev/null || echo "（没找到模拟器窗口程序，App 仍会装进模拟器）"; fi
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" build/Build/Products/Debug-iphonesimulator/ChinaLawSearch.app
if [ "${1:-}" = "-autotest" ]; then xcrun simctl launch "$UDID" "$BUNDLE" -autotest YES; else xcrun simctl launch "$UDID" "$BUNDLE"; fi
echo "已在模拟器里打开。App 数据目录：$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)/Documents/data"
