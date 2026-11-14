# 交接说明：中国法律检索（桌面版 + iOS 版）

更新：2026-11-14。写给接手这个项目的人或 AI 会话：读完这一份就能接着做，不需要翻之前的聊天记录。

- 仓库：`DerekXuHQ/claude-for-legal-china`（git remote `origin`，分支 `main`）。其他 remote 是参考用的分支，不要往那里推。
- App 代码在 `app/`；仓库其余部分是 Claude Code 法律插件 marketplace（16 个插件、202 个技能），规则见根目录 `CLAUDE.md`。
- 版本号固定为 **1.0.76**，用户没说改就不改。
- 本地其他分支（2026-11-08 用 `git branch --merged main` 核对）**全部已并入 main**，没有待合并的工作，不要删：
  - `ui-redesign`（2ce71c5「Hide the empty scenario pill」，worktree 在 `~/Voyager/conversation-855f1902f12580a903cb74f8/.voyager/legal-ui`，干净）：已在 main 里；
  - `feat/desktop-app`：桌面版最初的打包改造，已并入；
  - `cleanup/zh-docs`：最初加入 app 的那次提交，已并入；
  - `fix/mcp-filesystem`：去掉诉讼、劳动插件里占位的文件系统连接器，已并入；
  - `merge/cslawyer-zh`、`merge/fork-fixes`、`merge/gcheng-criminal`、`merge/horizon-skills`：合入上游中文版、官方法源清单、刑事辩护技能、HoriZon 起草与计算技能，均已并入。

---

## 1. 现在的状态

| 部分 | 状态 |
|---|---|
| 桌面版（Electron，Mac/Windows） | 已发布。v1.0.76 安装包由 GitHub 构建；在线更新已发到第 23 号（2026-11-08） |
| 法规检索、OCR、各种上传方式 | 完成。中文识别要求 100% 准确，包括生僻字和繁体 |
| Agent 生态 | 完成：150 个命名 Agent（中文职位名）、11 个定时 Agent、台账、实务画像。覆盖情况见下 |
| 新建对话引导 | 已并入统一选择器：8 个场景交给 Agent，「Agent」页改为管理页 |
| **iOS 版** | **能跑通。** CI 在 iPhone 17 Pro 模拟器（iOS 26.2，23C54；Xcode 26.3）上自检 **33/33 全过**（run 42231995897，提交 8924dbe）。`ios.yml` 用 runner 上最新的 Xcode（`ls /Applications/Xcode_*.app \| sort -V \| tail -1`），没有固定版本，runner 升级后模拟器版本会跟着变 |
| iOS 上架 App Store | 没做。卡在用户这边的账号和备案（见第 6 节） |

**技能和 Agent 的对应关系**（`app/server/ai/roster/roster.json`，由 `npm run agents` 生成）：仓库共 202 个技能，roster 收录 192 个；150 个命名任务 Agent 覆盖其中 153 个（其中 6 个是共用参考框架，不单独成 Agent，挂在用到它的 12 个 Agent 上，例如 `nda-review` 挂在「保密协议分流」）。**没有命名 Agent 的 49 个技能**，都是有意不做的：
- 37 个配置类：各插件的 `cold-start-interview`、`customize`、`matter-workspace`（app 里由「实务画像」和「事项」承担）；
- 2 个已弃用：`legal-clinic:form-generation`、`legal-clinic:plain-language-letters`；
- 10 个 `legal-builder-hub` 技能（管理 Claude Code 插件市场本身，和 app 无关，roster 不收录）。

定时 Agent 11 个，另算，不计入上面的 150 个。

### 账号和本机小模型（2026-11-14，分支 `feat/accounts`，还没并入 main）

用户要求：为了上架时不带默认的云端大模型，App 改成「账号 + 后台开通」；不登录也能用离线功能；内嵌一个小模型做离线检索答疑。

| 部分 | 位置 | 状态 |
|---|---|---|
| 账号服务 + 管理后台 + 隐私/帮助页 | `app/account-server/`（README 有接口和配置） | 本机测通；**还没部署**，域名待定（代码里先写 `https://legal.portkey.bond`，见 `server/account.mjs` 的 `ACCOUNT_SERVER`） |
| App 端账号 | `server/account.mjs`（本地接口 `/api/account/*`）、设置页「账号」 | 注册即生效；开通后自动拿接口和 key；改密码、退出、删除账号 |
| 模型来源换算 | `account.mjs` 的 `effectiveSettings`：账号开通的 > 自己填的接口 > 本机小模型 | `loadSettings()` 返回换算后的设置，`loadRaw()` 是保存的原始设置 |
| 本机小模型 | `server/ai/local.mjs`（检索 + 提示词）、`ios/App/Sources/LocalLLM.swift`（MLX，`llm.*` 桥接）、设置页「AI 设置」 | Qwen3-0.6B 4bit，约 350 MB，从账号服务下载；**只能真机跑**，模拟器报「不支持」 |
| 自检 | `autotest.mjs` 新增「账号状态」「本机小模型」两项 | 浏览器 mock 34/35（只差浏览器里没有的 Vision） |

本机小模型质量（2026-11-14 在 Mac 上用真实模型跑 8 个常见问题）：Qwen2.5-0.5B 经常答非所问；Qwen3-0.6B 大约一半答对、偶尔编；Qwen3-1.7B（约 940 MB）基本不错但笼统。所以回答下面一律附前三条条文原文，并标明「本机小模型，可能不准确」。换模型只换服务端文件。

---

## 2. 用户的要求和工作方式（必须遵守）

- **全部用中文交流**；界面文字按中国用户的习惯写，不要翻译腔。
- **测试自己做**：功能测试、截图看界面、代码评审都由 AI 完成，不要让用户去测。原话：「你不需要让我来做 test，你所有的 test 你都可以自己做」。
- **先决定再说**：用户说过「你先决策，后面我需要的话再改」「实在决定不了先绕过」。不要动不动停下来问。
- **建议只是假设**：先验证（测试、调研）再采纳。不要做用户没要求的工作。
- **改完就发布，不用先问**：
  1. 推到 `origin main`。GitHub 的 `app-installers.yml` 会构建四个安装包（Mac Apple 芯片、Mac Intel、Windows x64、Windows arm64），并替换 v1.0.76 Release 上的同名文件。**不要在本机打包。**
  2. 在本机发布在线更新：`cd app && node scripts/publish-update.mjs --notes "…"`。
  3. 重建过法规数据（`npm run data`）的话，还要运行 `npm run upload-build-inputs`。
- **Agent 方向**：要一套完整的、有中文名字的命名 Agent 加定时 Agent，每个对应一个技能，全部建好索引、真正用起来。不要做成「工作流模板」。

### 安全和合规红线

- 签名私钥只放在 `~/.china-law-search/release-key.pem`，**绝不进仓库、绝不上 GitHub**。
- 用户的 API key 只存在本机的 `settings.json`。**不要放进 GitHub secrets，也不要发给任何外部服务。**
- 访问官方网站：遇到验证页或反爬页面就停，不绕过；遵守 robots.txt；**不访问 flk.npc.gov.cn**；请求间隔不少于 2 秒。规则写在 `app/server/official/fetch.mjs`。
- 不要联系 HoriZon 的作者。
- 保留 Apache/MIT 署名（根目录 `NOTICE`、`app/THIRD_PARTY.md`）。
- 不要重启用户正在用的 App。

---

## 3. 桌面版架构（简要）

- `app/shell/`：Electron 外壳。改这里需要发新安装包，在线更新管不到。
- `app/renderer/`：界面（`index.html`、`app.js`、CSS），**iOS 也直接用这一份**。
- `app/server/`：本地服务端（`api.mjs` 负责路由）。
  - `server/ai/`：模型调用、问答、Agent（`roster/` 由 `npm run agents` 生成并提交进 git）、定时 Agent（`watchers.mjs`）、OCR、导出。
  - `server/official/`：从官方网站同步法规（`sync.mjs`、`fetch.mjs`）。
- 数据：SQLite 加 FTS5 trigram 全文索引。数据包是 `resources/base.db.gz`，不在 git 里，存放在 GitHub 的 `build-inputs` 预发布。
- 在线更新：Ed25519 签名的补丁，发到 GitHub 的 `updates` 预发布（tag `updates`），manifest 最后上传。公钥在 `app/shell/release-public-key.pem`。
- 在线更新序号：`package.json` 里的 `updateSequence` 比线上旧（例如 15 对 23）是正常的（`package.json` 不跟着每次在线更新改）。`scripts/stamp.mjs` 会在打安装包时（`app-installers.yml`）读取线上 manifest，自动写入最新序号；`publish-update.mjs` 也取线上和本地两者中较大的那个。不要手动改。
- 测试：`cd app && npm test` 只覆盖官方法规同步（`test/official.test.mjs`，9 个用例）。界面、Agent、上传、OCR、导出等功能靠 iOS 自检（第 5 节）检查，iOS 和桌面用的是同一份界面和服务端代码。

---

## 4. iOS 版架构

**做法：** 一个 WKWebView 跑桌面版的界面和服务端 JS，原生层（Swift）提供 Node 的能力。没有用 Swift 重写。

```
WKWebView  app://local/index.html   （SchemeHandler 提供 App 包里的 Web/ 目录）
 ├─ boot.js（esbuild 打包，约 9 MB）= renderer + server/api.mjs + shims
 │    fetch("/api/…")  → 直接调用 createServer(ctx).handle(req,res)，响应是 ReadableStream，SSE 可用
 │    fetch(外部网址)    → 原生 URLSession 流式请求（没有 CORS 问题）
 │    WebSocket          → __NativeWebSocket → URLSessionWebSocketTask（可以带请求头）
 │    node:fs / sqlite / crypto / zlib … → web-src/shims/*
 └─ 原生桥
      同步调用：window.prompt("__native__"+json)，由 WKUIDelegate 的文本输入面板回调接住
      异步调用：webkit.messageHandlers.native.postMessage({id,op,args})，结果经 window.__native.resolve / emit 返回
      id 带页面唯一前缀（pageId），页面重载后不会串
```

### 文件

- `app/ios/web-src/`
  - `boot.mjs`：入口。负责首次数据准备（失败自动重试并显示倒计时，只有「空间不足」算致命错误）、法规更新、localApi、加载 `app.js` 后挂上手机端功能，最后调用 `app.ready`。
  - `globals.mjs`：Buffer 和 process，以及以下 polyfill：
    - `AbortSignal.any` / `AbortSignal.timeout`；
    - `ReadableStream` 的异步迭代（pdf.js 需要，iOS WebKit 没有）；
    - fetch 改写、`NativeWebSocket`。
  - `phone.mjs`：手机端行为。
    - 抽屉菜单；阅读全屏，带返回按钮；
    - 手机上不自动弹键盘；
    - 原生语音输入兜底；
    - 版本文字显示「通过 App Store 更新」；
    - 「拍照识别」；
    - 上传上限：单个文件 200 MB，录音 50 MB；
    - `blob:` 下载交给原生分享面板。
  - `ios.css`：安全区、底部标签栏（宽度 ≤760 px 时）、16 px 输入框（防止 iOS 自动放大）、iPad 上隐藏返回按钮。
  - `autotest.mjs`：自检，详见第 5 节。
  - `native.mjs`：`callSync`、`call`、`on`。
  - `shims/`：`fs`（`/app/...` 读打包时生成的虚拟文件系统，`/data` 读写原生文件）、`sqlite`（`DatabaseSync`）、`zlib`（fflate）、`misc`（crypto、os、http 等的桩）。
- `app/ios/build-web.mjs`：esbuild 打包，再把 `index.html` 改成 iOS 版（viewport-fit、CSP、`data-platform="ios"`）。
- `app/ios/App/Sources/`（Swift）
  - `WebViewController.swift`：WKWebView 和 SchemeHandler；alert、confirm、prompt 面板；下载和分享；通知；授予麦克风权限；WebContent 进程崩溃后调用 `bridge.reset()`。
  - `Bridge.swift`：所有 op 的分发表，必须和 `dev/mock-native.mjs` 一一对应。
  - `SQLite.swift`：自带的 SQLite 3.54.1（`-DSQLITE_ENABLE_FTS5`）。
  - `DataSetup.swift`：首次启动时下载 `base.db.gz`（116 MB）→ 校验 sha256 → 解压 → 在后台建 FTS → 写 `legal.version`，并排除出 iCloud 备份。启动前检查剩余空间不少于 3 GB。
  - `Net.swift`：流式 HTTP 和 WebSocket。
  - `Media.swift`：Vision OCR（简体、繁体、英文）、HEIC 转 JPEG、音频转 WAV。
  - `Speech.swift`：SFSpeechRecognizer 语音识别。
- `app/ios/project.yml`：XcodeGen 配置，生成的 `.xcodeproj`、`App/Web`、`App/Info.plist` 都不进 git。
  - Bundle ID：`com.derekxuhq.chinalawsearch`；最低 iOS 16.0；版本 1.0.76。
  - `PrivacyInfo.xcprivacy` 已写好。
- `app/ios/dev/mock-native.mjs`：在 Node 里实现同一套原生桥，可以用浏览器（包括 Safari）测试网页部分。`ws.*` 的事件格式和 `Net.swift` 一样；在 macOS 上 `image.toJpeg` 用 `sips`、`audio.toWav` 用 `afconvert`。只做了桩的有：`speech.*`、`ocr.image`（返回空串，所以浏览器自检里「本机文字识别（Vision）」这一项必定失败，其余 32 项应全过）、`setup.prepare`、`share.file`、`debug.*`。
- `app/ios/dev/mock-model.mjs`：模拟 OpenAI 兼容接口的测试模型服务，不用真实 API key 就能走通问答和 Agent。
- 文档：
  - `app/ios/README.md`：怎么编译、怎么测试；
  - `app/docs/ios-app-store.md`：上架和备案清单；
  - `app/docs/ios-listing.md`：商店文案、关键词、隐私政策、审核备注（草稿）。

### 给桌面共享代码的改动（桌面版也能用，已随在线更新 20–22 发布）

- `server/api.mjs`：`createServer` 返回 `handle`；HTTP server 改为在 `listen` 时才创建。
- `server/ai/ocr.mjs`：iOS 上走原生 OCR、HEIC 转换、音频转换的钩子。
- `server/ai/models.mjs`：加了 `dangerouslyAllowBrowser: true`。
- `server/ai/docs.mjs`：传给 mammoth 时同时带上 `buffer` 和 `arrayBuffer`。
- 界面文字：「这台电脑」改为「本机」。

**规则：** 改 `app/renderer` 或 `app/server` 会同时影响桌面版和 iOS 版。两边都要测：桌面运行 `npm test`，iOS 跑 CI 或用 mock 测，然后按第 2 节发布。

---

## 5. 怎么测试 iOS 版

### A. CI（主要手段）

`.github/workflows/ios.yml`：只要推送改动了 `app/ios/**`、`app/renderer/**`、`app/server/**` 等路径，就会自动运行。

- 运行机器是 `macos-15-intel`（arm64 机器一直分配不到）。
- 流程：编译模拟器版 → 启动 mock 模型 → 把 `settings.json` 写进 App 的容器 → 用 `-autotest YES` 启动 → 录屏并截图 → 上传 artifact `ios-simulator`。
  - artifact 里有 `autotest.json`、`shots/*.png`、`shots/autotest.mp4`、`ChinaLawSearch.app.zip`。
- 查看结果：

```bash
gh run list -R DerekXuHQ/claude-for-legal-china --workflow ios.yml -L 3
```

```bash
gh run download <run-id> -R DerekXuHQ/claude-for-legal-china -n ios-simulator -D <空目录>
```

- 自检项目共 33 项：
  - 数据准备、检索、案例、浏览、场景、Agent、台账、画像；
  - 文本上传（含生僻字）、Word 导出后再读回、PDF 上传（pdf.js 在网页视图里解析）、Vision OCR；
  - secure context、网络、AI 问答、命名 Agent、定时 Agent；
  - 15 步界面巡览截图，以及通过分享面板导出 Word。

### B. 浏览器里测网页部分（不需要 Xcode，速度最快）

```bash
cd app && npm run ios:web && node ios/dev/mock-native.mjs <数据目录>
```

- 数据目录里放一份 `legal.db`（用 `cp -c` 从桌面版的数据目录克隆，不额外占空间）和 `settings.json`。
- 打开它打印的地址，后面加 `?autotest` 就会跑自检。视口设成 390×844。
- 要测试 AI 链路但不用真实 key：运行 `node ios/dev/mock-model.mjs 8791`，接口地址填 `http://127.0.0.1:8791/v1`。

### C. 本机模拟器

```bash
cd app && npm run ios:sim -- -autotest
```

- **本机测试设备：iPhone 18 Pro 模拟器**（用户在 Device Hub 里开好的那台，UDID `5926FAE6-64BE-42D7-95E6-2841C8569AA7`，iOS 27.2）。以后本机测试都用它，不要新建模拟器。`run-sim.sh` 默认就选它：已开着的 iPhone 18 Pro → 已开着的其他 iPhone → 最新系统里的 iPhone；也可以用 `UDID=<设备 ID> npm run ios:sim` 指定。
- **Xcode 27 没有 Simulator.app 了**，模拟器窗口在 `Device Hub` 里（`/Applications/Xcode.app/Contents/Applications/DeviceHub.app`）。`run-sim.sh` 会先找 Device Hub，再找旧的 Simulator，都打不开也会照常安装、启动 App。
- 本机环境已就绪（2026-11-08 核对）：Xcode 27.2 许可已接受（`xcodebuild -checkFirstLaunchStatus` 返回 0），iOS 27.2 模拟器运行环境已装好（`xcrun simctl list runtimes`）。不用再下载。
- **本机磁盘只剩十几 GB**：`ios/build`（DerivedData）约 1 GB，模拟器里的 App 数据约 1.2 GB，用完可以删掉 App。
- `run-sim.sh` 不会写 `settings.json`，直接用它跑自检时 AI 相关几项会失败。要走通 AI 链路，按下面的顺序手动跑（和 CI 一样）：
  1. 编译（同 `run-sim.sh`），`xcrun simctl install` 装上；
  2. 启动 `node ios/dev/mock-model.mjs 8791`；
  3. 把 `{"base_url":"http://127.0.0.1:8791/v1","api_key":"test","model":"mock-model","depth":"low"}` 写进 `$(xcrun simctl get_app_container <UDID> com.derekxuhq.chinalawsearch data)/Documents/data/settings.json`；
  4. `xcrun simctl launch <UDID> com.derekxuhq.chinalawsearch -autotest YES`，结果在同一目录的 `autotest.json`。
- **最近一次本机结果（2026-11-08）**：iPhone 17 模拟器，iOS 27.2，mock 模型，**33/33 全过**（包括原生 Vision OCR、原生网络、AI 问答、命名 Agent、定时 Agent）。同一天又用真实 API key 跑了一遍，也是 33/33（见第 6 节）。
- 注意：首次准备数据时，如果 App 被切到后台（比如模拟器回到主屏幕），解压和建索引会暂停，回到前台后才继续。自检卡在「资料库准备」时先看 App 是不是在前台。
- 可以用 iOS Simulator 工具（`mcp__Claude_Code_iOS_Simulator__control`）看界面、点按。

---

## 6. 没做完的事

### 需要用户本人做

1. 加入 Apple Developer Program（每年 99 美元）。
2. 在 App Store Connect 创建 App；生成 API key；在 GitHub 仓库里加 4 个 secrets：
   - `APPLE_TEAM_ID`
   - `ASC_KEY_ID`
   - `ASC_ISSUER_ID`
   - `ASC_KEY_P8`

   加好以后，`ios.yml` 里的 `testflight` job 会自动打包并上传 TestFlight。
3. 中国区上架需要的 ICP 备案，以及生成式 AI 相关的备案或登记：见 `app/docs/ios-app-store.md`，其中标了〔待核实〕的条目要先核实。
4. 隐私政策需要放到一个公开网页上（文字在 `ios-listing.md`），审核用的测试 API key 也由用户提供。

### AI 可以接着做

- [x] 本机模拟器跑通（2026-11-08，iOS 27.2，mock 模型，33/33）。Xcode 许可早已接受，这一步不再需要用户操作。
- [x] 本机模拟器用**真实 API key** 走通（2026-11-08，用户同意后做）：把桌面版本机 `settings.json` 复制进模拟器 App 容器，模型 `gpt-6-luna`，iOS 27.2，自检 **33/33 全过**。AI 问答（流式）19 秒，回答 766 字；命名 Agent「保密协议分流」14 秒，1288 字；定时 Agent「合同续约监控」17 秒，报告 879 字。测完已卸载模拟器里的 App（key 随容器一起删除），key 没有进 git，也没上传到任何地方。
- [ ] App Store 截图：6.9 英寸 iPhone（1320×2868）和 13 英寸 iPad（2064×2752）。可以复用 autotest 的截图流程，改一下尺寸和内容。
- [ ] 真机测试：需要用户的 Apple ID，或者等 TestFlight 上线。
- [ ] 加了 secrets 以后：检查 `testflight` job（签名、版本号、上传）。

---

## 7. 踩过的坑（避免重复）

- **iOS WebKit 缺的 API**：
  - `AbortSignal.any`（iOS 17.4 之前没有）；
  - `ReadableStream` 的 `for await`。

  这两个都已在 `globals.mjs` 补上。再遇到 `undefined is not a function (near '...x of y...')`，先查是不是又对某个对象用了异步迭代。
- Safari 的 `e.stack` 里不带错误消息，记录错误时要拼成 `name: message` 再加上 stack。
- iOS 上 `<a download>` 不能用，导出一律走 `share.file`（系统分享面板）。
- 同源的 `/api` 绝不能交给 `nativeFetch`，否则会无限递归。
- mock 的 SSE 要监听 `res.on("close")`，不能监听 `req`。
- mammoth 在浏览器环境里需要 `arrayBuffer`。
- 本机命令行工具（CLT）里的 Swift 在装了 Xcode 之后会崩溃。要在本机画图，就用浏览器 canvas 加 `sips`。
- 磁盘接近满：复制大文件用 `cp -c`（APFS 克隆，不额外占空间）；不要在本机打安装包。

---

## 8. 相关记忆文件（AI 会话的持久记忆，在本机 `~/.claude/projects/.../memory/`）

- `release-after-changes.md`：发布流程。
- `online-update-system.md`：在线更新的签名和发布。
- `ios-app.md`：iOS 版的要点。
- `chinese-input-fidelity.md`：每种输入方式都要支持，中文必须 100% 正确。
- `agent-ecosystem-direction.md`：Agent 生态的方向。
- `suggestions-are-hypotheses.md`：建议先验证；先复制 CopyDeck；不做用户没要求的工作。
