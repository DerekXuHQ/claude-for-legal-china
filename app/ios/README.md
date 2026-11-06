# 中国法律检索 iOS 版

iPhone / iPad 版。界面和桌面版相同，检索、法律助理、150 个 Agent、定时 Agent、台账、实务画像都在手机本机运行；
只有调用 AI 模型、联网搜索、下载法规数据包需要网络。

## 怎么做出来的

- **网页部分**（`web-src/`）：桌面版的界面（`renderer/`）和服务端代码（`server/`）原样打包进 App 的网页视图里运行。
  界面照常用 `fetch("/api/...")`，只是不经过 HTTP，直接调用服务端的请求处理函数（`boot.mjs`）。
  Node 的内置模块换成替身（`shims/`），背后是原生接口。
- **原生部分**（`App/Sources/`，Swift）：网页视图、App 自带的 SQLite 3.54（FTS5 全文索引）、网络请求（流式）、
  WebSocket、文字识别（Vision）、照片和录音转换、语音输入、首次打开时下载法规数据包并建索引、通知、导出文件。
- **原生接口说明**：`App/Sources/Bridge.swift` 和 `dev/mock-native.mjs`（浏览器里的模拟实现）一一对应。

## 最快的测试方法（模拟器）

```bash
cd app && npm run ios:sim            # 编译、打开 iPhone 模拟器、装上并启动
cd app && npm run ios:sim -- -autotest   # 同上，并把主要功能自检一遍
```

第一次需要：Xcode（App Store）、在终端运行一次 `sudo xcodebuild -license accept`、`brew install xcodegen`；
脚本会自动下载 iOS 模拟器（约 8 GB）。

## 在模拟器或自己的 iPhone 上运行

需要 Mac、Xcode（App Store 免费下载）和 Node.js。

```bash
cd app
npm ci
npm run ios:project      # 生成网页部分和 Xcode 工程（需要 brew install xcodegen）
open ios/ChinaLawSearch.xcodeproj
```

在 Xcode 里：

1. 第一次打开：Xcode → Settings → Accounts 登录 Apple ID；选中项目 → Signing & Capabilities → Team 选你的账号。
2. 顶部选一个模拟器（例如 iPhone 17），或者用数据线连上的 iPhone，点 ▶︎ 运行。
3. 用免费 Apple ID 装到真机：iPhone 上「设置 → 通用 → VPN 与设备管理」信任开发者；免费账号装的 App 7 天后要重新运行一次。

第一次打开会下载约 110 MB 的法规数据包并在本机建全文索引（几分钟，请保持 App 在前台），之后离线可检索。
在「设置」里填上 API key 才能用法律助理和 Agent。

不想自己编译：GitHub 上每次构建（Actions → iOS app → 最近一次运行 → Artifacts → ios-simulator）都有模拟器版
`ChinaLawSearch.app.zip`，解压后 `xcrun simctl install booted ChinaLawSearch.app` 装进已打开的模拟器。

## 测试

- **浏览器里测网页部分**（不需要 Xcode）：`npm run ios:web && node ios/dev/mock-native.mjs <数据目录>`，
  浏览器打开它打印的地址。数据目录里放一份 `legal.db`（桌面版数据目录里的那份可以直接复制）和 `settings.json`。
- **自检**：启动参数 `-autotest YES`（Xcode → Product → Scheme → Edit Scheme → Arguments）会把主要功能走一遍，
  结果写进 App 数据目录的 `data/autotest.json`。GitHub 每次构建都在模拟器里跑一遍并截图。
- **调试网页部分**：Mac 上的 Safari → 开发 → 模拟器 / iPhone → 中国法律检索。

## 上架 App Store 前要做的

见 `../docs/ios-app-store.md`。
