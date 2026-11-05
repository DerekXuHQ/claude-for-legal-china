// 中国法律检索：Electron 主进程。
// 启动本地检索服务（只监听 127.0.0.1），第一次运行时在后台准备资料库，定期检查官方网站的法规更新。
import { app, BrowserWindow, Menu, shell, dialog, systemPreferences, Notification } from "electron";
import { Worker } from "node:worker_threads";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createServer, DEFAULT_SETTINGS } from "./server/api.mjs";
import * as search from "./server/search.mjs";
import { ensureUserTables } from "./server/official/sync.mjs";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
// 后台线程的脚本放在 asar 外面（package.json 的 asarUnpack），Worker 才能直接加载
const UNPACKED = APP_DIR.replace(/app\.asar(?=$|[\\/])/, "app.asar.unpacked");
const RES = app.isPackaged ? process.resourcesPath : path.join(APP_DIR, "resources");
// 改名前的数据文件夹：设置、收藏和已建好的资料库原样搬过来
for (const oldName of ["AI for Legal China", "Claude for Legal China"]) {
  const oldDir = path.join(app.getPath("appData"), oldName);
  if (existsSync(path.join(oldDir, "data")) && !existsSync(path.join(app.getPath("userData"), "data"))) {
    mkdirSync(app.getPath("userData"), { recursive: true });
    renameSync(path.join(oldDir, "data"), path.join(app.getPath("userData"), "data"));
    rmSync(oldDir, { recursive: true, force: true });
    break;
  }
}
const DATA = path.join(app.getPath("userData"), "data");
const LEGAL_DB = path.join(DATA, "legal.db");
const USER_DB = path.join(DATA, "user.db");
const SETTINGS = path.join(DATA, "settings.json");

// 启动器（boot.mjs）已经拿到单实例锁并选好了版本；在线更新模块在外壳里，不随补丁替换
const BOOT = globalThis.__clsBoot || null;
const SHELL_DIR = path.join(BOOT?.builtin || APP_DIR, "shell");
let updater = null;

let win = null;
let legalDb = null;
let userDb = null;
const setup = { ready: false, phase: "启动中", progress: 0, error: "" };
let sync = { running: false, mode: "", phase: "", checked: 0, fetched: 0, changes: 0, errors: 0, current: "", finished_at: "", last_result: null };
let syncWorker = null;

// 法规数据包：安装包自带的和在线更新下载的，取最新的一个
function dataPack() {
  if (updater) return updater.dataPack();
  try { return { gz: path.join(RES, "base.db.gz"), info: JSON.parse(readFileSync(path.join(RES, "data-version.json"), "utf-8")) }; } catch { return null; }
}
function dataVersion() { return dataPack()?.info || null; }

function openUserDb() {
  userDb = new DatabaseSync(USER_DB);
  userDb.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS bookmarks(id INTEGER PRIMARY KEY, kind TEXT, ref_id TEXT, title TEXT,
      subtitle TEXT, snippet TEXT, note TEXT, created REAL, UNIQUE(kind, ref_id));
    CREATE TABLE IF NOT EXISTS answers(id TEXT PRIMARY KEY, question TEXT, region TEXT, answer TEXT,
      steps TEXT, model TEXT, created REAL);`);
  ensureUserTables(userDb);
}

function openLegalDb() {
  legalDb = new DatabaseSync(LEGAL_DB);
  legalDb.exec("PRAGMA busy_timeout=10000;");
  search.setDb(legalDb);
}

function installedVersion() {
  if (!existsSync(LEGAL_DB)) return null;
  try {
    const db = new DatabaseSync(LEGAL_DB, { readOnly: true });
    const v = db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get()?.value;
    db.close();
    return v || null;
  } catch { return null; }
}

function prepareData() {
  const pack = dataPack();
  const dv = pack?.info;
  const gz = pack?.gz || path.join(RES, "base.db.gz");
  if (!dv || !existsSync(gz)) {
    if (existsSync(LEGAL_DB)) { openLegalDb(); Object.assign(setup, { ready: true, phase: "完成", progress: 1 }); return; }
    Object.assign(setup, { error: "安装包里缺少法规数据（resources/base.db.gz）。开发环境请先运行 npm run data。" });
    return;
  }
  if (installedVersion() === dv.version) {
    openLegalDb();
    Object.assign(setup, { ready: true, phase: "完成", progress: 1 });
    afterReady();
    return;
  }
  const out = LEGAL_DB + ".new";
  const w = new Worker(path.join(UNPACKED, "server/workers/setup-worker.mjs"), {
    workerData: { gzPath: gz, outPath: out, userDbPath: USER_DB, dataVersion: dv.version },
  });
  w.on("message", (m) => {
    if (m.error) { Object.assign(setup, { error: m.error }); return; }
    Object.assign(setup, { phase: m.phase, progress: m.progress });
    if (m.done) {
      legalDb?.close();
      for (const suf of ["", "-wal", "-shm"]) rmSync(LEGAL_DB + suf, { force: true });
      renameSync(out, LEGAL_DB);
      for (const suf of ["-wal", "-shm"]) if (existsSync(out + suf)) renameSync(out + suf, LEGAL_DB + suf);
      openLegalDb();
      setup.ready = true;
      afterReady();
    }
  });
  w.on("error", (err) => Object.assign(setup, { error: String(err?.stack || err) }));
}

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS, "utf-8")) }; } catch { return { ...DEFAULT_SETTINGS }; }
}

function startUpdate(mode = "incremental") {
  if (!setup.ready) return { ok: false, error: "资料库还在准备中" };
  if (sync.running) return { ok: false, error: "正在检查更新" };
  sync = { ...sync, running: true, mode, phase: "开始", checked: 0, fetched: 0, changes: 0, errors: 0, current: "" };
  syncWorker = new Worker(path.join(UNPACKED, "server/workers/sync-worker.mjs"), {
    workerData: { legalDbPath: LEGAL_DB, userDbPath: USER_DB, mode },
  });
  syncWorker.on("message", (m) => {
    if (m.progress) Object.assign(sync, m.progress, { running: !m.progress.done || sync.running });
    if (m.done || m.error) {
      Object.assign(sync, { running: false, finished_at: new Date().toISOString(), last_result: m.error ? { error: m.error } : m.stats });
      syncWorker = null;
    }
  });
  syncWorker.on("error", (err) => {
    Object.assign(sync, { running: false, finished_at: new Date().toISOString(), last_result: { error: String(err?.message || err) } });
    syncWorker = null;
  });
  return { ok: true };
}

function stopUpdate() {
  syncWorker?.postMessage("abort");
}

function maybeAutoUpdate() {
  const s = loadSettings();
  if (!s.auto_update || !setup.ready || sync.running) return;
  const last = userDb.prepare("SELECT value FROM sync_state WHERE key = 'last_check'").get()?.value;
  const days = Math.max(1, Number(s.update_interval_days) || 7);
  if (!last || Date.now() - Date.parse(last) > days * 86400000) startUpdate("incremental");
}

let autoTimer = null;
function afterReady() {
  if (autoTimer) return;
  setTimeout(maybeAutoUpdate, 15000);
  autoTimer = setInterval(maybeAutoUpdate, 6 * 3600 * 1000);
}

async function createWindow(port, token) {
  win = new BrowserWindow({
    width: 1380, height: 900, minWidth: 980, minHeight: 640,
    title: "中国法律检索", backgroundColor: "#f7f5f2", show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  // 外部链接（官方网站原文等）用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.on("closed", () => { win = null; });
  await win.loadURL(`http://127.0.0.1:${port}/#t=${token}`);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about", label: "关于中国法律检索" }, { type: "separator" },
        { role: "hide", label: "隐藏" }, { role: "hideOthers", label: "隐藏其他" }, { role: "unhide", label: "全部显示" },
        { type: "separator" }, { role: "quit", label: "退出" },
      ],
    }] : []),
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" },
        { role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" }, { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新载入" }, { role: "resetZoom", label: "实际大小" }, { role: "zoomIn", label: "放大" }, { role: "zoomOut", label: "缩小" },
        { type: "separator" }, { role: "togglefullscreen", label: "全屏" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools", label: "开发者工具" }]),
      ],
    },
    { label: "窗口", submenu: [{ role: "minimize", label: "最小化" }, { role: "zoom", label: "缩放" }, ...(isMac ? [{ role: "front", label: "前置全部窗口" }] : [{ role: "close", label: "关闭" }])] },
    {
      label: "帮助",
      submenu: [
        { label: "数据来源与许可", click: () => shell.openPath(path.join(RES, "THIRD_PARTY.md")) },
        { label: "打开数据文件夹", click: () => shell.openPath(DATA) },
        { label: "项目主页", click: () => shell.openExternal("https://github.com/DerekXuHQ/claude-for-legal-china") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setAboutPanelOptions({
  applicationName: "中国法律检索",
  applicationVersion: app.getVersion(),
  copyright: "Apache-2.0。仅供参考，不构成法律意见。",
});

app.whenReady().then(async () => {
  mkdirSync(DATA, { recursive: true });
  try {
    const { Updater } = await import(pathToFileURL(path.join(SHELL_DIR, "updater.mjs")).href);
    const { ReleaseState } = await import(pathToFileURL(path.join(SHELL_DIR, "release-state.mjs")).href);
    updater = new Updater({
      dir: BOOT?.updatesDir || path.join(app.getPath("userData"), "updates"),
      builtin: BOOT?.builtin || APP_DIR, resources: RES,
      state: BOOT?.state || new ReleaseState({ dir: path.join(app.getPath("userData"), "updates") }),
    });
  } catch (err) {
    console.error("在线更新模块加载失败", err);
  }
  openUserDb();
  buildMenu();
  const server = createServer({
    staticDir: path.join(APP_DIR, "renderer"),
    settingsPath: SETTINGS,
    userDb: () => userDb,
    status: () => ({ ...setup }),
    updateStatus: () => ({ ...sync }),
    startUpdate,
    stopUpdate,
    appInfo: () => ({ version: app.getVersion(), sequence: updater?.installedSequence() || 0, data: dataVersion(), data_dir: DATA, platform: process.platform, arch: process.arch }),
    // 定时 Agent 的报告：发系统通知，点一下打开 app 并显示这份报告
    notify: ({ title, body, runId }) => {
      try {
        if (!Notification.isSupported()) return;
        const n = new Notification({ title: `${title}（中国法律检索）`, body });
        n.on("click", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.executeJavaScript(`window.openAgentRun && window.openAgentRun(${JSON.stringify(runId)})`).catch(() => {}); } });
        n.show();
      } catch (e) { console.error("notify", e); }
      try { win?.webContents.executeJavaScript("window.refreshAgentBadge && window.refreshAgentBadge()").catch(() => {}); } catch { /* 窗口已关 */ }
    },
    // 拖进来的网页链接：在不显示的窗口里打开（独立会话，不带任何登录状态），等脚本跑完取标题和正文
    renderUrl: (url) => new Promise((resolve, reject) => {
      const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: "linkfetch", javascript: true, nodeIntegration: false, contextIsolation: true, sandbox: true, images: false } });
      const done = (fn) => { clearTimeout(timer); try { w.destroy(); } catch { /* 已关闭 */ } fn(); };
      const timer = setTimeout(() => done(() => reject(new Error("超时"))), 40000);
      w.webContents.setAudioMuted(true);
      w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      w.webContents.session.on("will-download", (e) => e.preventDefault());
      w.loadURL(url).then(async () => {
        await new Promise((r) => setTimeout(r, 2500));
        const page = await w.webContents.executeJavaScript(`({ title: document.title, text: (document.querySelector("article, main, #js_content, .rich_media_content") || document.body).innerText })`);
        done(() => resolve(page));
      }).catch((err) => done(() => reject(err)));
    }),
    // 麦克风权限（照搬 CopyDeck）：没定过就弹系统授权；以前拒绝过（系统不会再弹）就打开系统设置的麦克风页面
    micPermission: async () => {
      if (process.platform !== "darwin") return { ok: true };
      const st = systemPreferences.getMediaAccessStatus("microphone");
      if (st === "granted") return { ok: true };
      if (st === "not-determined") {
        const ok = await systemPreferences.askForMediaAccess("microphone").catch(() => false);
        return ok ? { ok: true } : { ok: false, message: "没有麦克风权限，语音输入用不了；打字照常可以用。" };
      }
      shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone").catch(() => {});
      return { ok: false, message: "麦克风权限之前被拒绝了：已经打开「系统设置 → 隐私与安全性 → 麦克风」，把「中国法律检索」打开后再点一次话筒。" };
    },
    appUpdate: {
      status: () => updater?.snapshot() || { status: "unavailable" },
      check: () => updater?.check(),
      download: () => updater?.download(),
      restart: () => { app.relaunch(); app.exit(0); },
    },
  });
  const port = await server.listen();
  // 开发模式下打印地址，便于在浏览器里调试界面
  if (!app.isPackaged) console.log(`[dev] http://127.0.0.1:${port}/#t=${server.token}`);
  prepareData();
  await createWindow(port, server.token);
  // 窗口和本地服务都起来了：这个版本健康，试运行的候选版本转正
  if (BOOT?.selected?.load) {
    BOOT.state.confirmHealthy(BOOT.selected.sequence);
    BOOT.healthRecorded = true;
  }
  // 检查在线更新：启动后一会儿查一次，之后每小时；有新版本就在后台下载（签名校验通过才算下载完成），
  // 下载好后导航栏右侧出现「新版本已就绪 · 点击重启更新」，用户点一下就重启生效
  if (updater && app.isPackaged) {
    const autoUpdate = async () => {
      try {
        await updater.check();
        if (updater.snapshot().status === "available") updater.download();
      } catch { /* 下次再查 */ }
    };
    setTimeout(autoUpdate, 20000);
    setInterval(autoUpdate, 3600 * 1000).unref?.();
  }
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(port, server.token); });
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}).catch((err) => {
  dialog.showErrorBox("启动失败", String(err?.stack || err));
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  syncWorker?.postMessage("abort");
  try { legalDb?.close(); userDb?.close(); } catch { /* 退出时忽略 */ }
});
