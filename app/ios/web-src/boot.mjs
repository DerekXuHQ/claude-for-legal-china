// iOS 版入口：在 App 的网页视图里运行桌面版的服务端代码（检索、问答、Agent、台账……），
// 界面（renderer/app.js）照常用 fetch("/api/...") 调它，只是不经过 HTTP，直接调用请求处理函数。
import { setLocalApi } from "./globals.mjs"; // 必须第一个：补全局对象、接管网络
import { Buffer } from "buffer";
import { callSync, call, on, isNative } from "./native.mjs";
import { DatabaseSync } from "node:sqlite";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createServer } from "../../server/api.mjs";
import * as search from "../../server/search.mjs";
import { ensureUserTables, runSync } from "../../server/official/sync.mjs";
import { ensureOfficialColumns, promotePending } from "../../server/official/apply.mjs";
import DATA_VERSION from "../../resources/data-version.json";
import { setupPhone, setupNativeDictation, setupIosVersion, setupIosAttach, setupIosUploadLimits } from "./phone.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/build/pdf.worker.min.mjs";

// 原生能力：Vision 文字识别（中文，含繁体）、HEIC 转 JPG、录音转 WAV（服务端 ocr.mjs 会调用）
globalThis.__iosNative = {
  ocr: (img) => call("ocr.image", { data: img.data, mime: img.mime }),
  heicToJpeg: async (buffer) => ({ data: await call("image.toJpeg", { data: Buffer.from(buffer).toString("base64") }), mime: "image/jpeg" }),
  audioToWav: async (buffer, ext) => Buffer.from(await call("audio.toWav", { data: Buffer.from(buffer).toString("base64"), ext, rate: 24000 }), "base64"),
};

const DATA = "/data";
const LEGAL_DB = DATA + "/legal.db";
const USER_DB = DATA + "/user.db";
// 法规数据包：和桌面版同一个（GitHub 上的 build-inputs 预发布），首次打开时下载并在本机建索引
const DB_URL = "https://github.com/DerekXuHQ/claude-for-legal-china/releases/download/build-inputs/base.db.gz";

const setup = { phase: "准备中", progress: 0, ready: false, error: "" };
let sync = { running: false };
let syncCtrl = null;

// 官方法规更新：和桌面版同一套（server/official/sync.mjs），在页面里异步运行（主要是等网络，界面照常可用）
function startUpdate(mode = "incremental") {
  if (!setup.ready) return { ok: false, error: "资料库还在准备中" };
  if (sync.running) return { ok: false, error: "正在检查更新" };
  sync = { ...sync, running: true, mode, phase: "开始", checked: 0, fetched: 0, changes: 0, errors: 0, current: "" };
  syncCtrl = new AbortController();
  const legalDb = new DatabaseSync(LEGAL_DB), udb = new DatabaseSync(USER_DB);
  legalDb.exec("PRAGMA busy_timeout=10000;"); udb.exec("PRAGMA busy_timeout=10000;");
  runSync({ legalDb, userDb: udb, mode, signal: syncCtrl.signal, onProgress: (p) => Object.assign(sync, p, { running: true }) })
    .then((stats) => Object.assign(sync, { running: false, finished_at: new Date().toISOString(), last_result: stats }))
    .catch((err) => Object.assign(sync, { running: false, finished_at: new Date().toISOString(), last_result: { error: syncCtrl.signal.aborted ? "已停止" : String(err?.message || err) } }))
    .finally(() => { try { legalDb.close(); udb.close(); } catch { /* 已关闭 */ } });
  return { ok: true };
}
function maybeAutoUpdate() {
  let s = {};
  try { s = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(callSync("fs.read", { path: DATA + "/settings.json" })), (c) => c.charCodeAt(0)))); } catch { /* 用默认 */ }
  if (s.auto_update === false || !setup.ready || sync.running || !userDb) return;
  const last = userDb.prepare("SELECT value FROM sync_state WHERE key = 'last_check'").get()?.value;
  const days = Math.max(1, Number(s.update_interval_days) || 7);
  if (!last || Date.now() - Date.parse(last) > days * 86400000) startUpdate("incremental");
}
let userDb = null;

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
  const db = new DatabaseSync(LEGAL_DB);
  db.exec("PRAGMA busy_timeout=10000;");
  ensureOfficialColumns(db);
  promotePending(db);
  search.setDb(db);
}

async function prepareData() {
  // 下载失败（没网、网断了、中途切到后台）就自动重试；只有空间不足这类重试也没用的才报错
  for (let attempt = 1; ; attempt++) {
    try {
      const st = callSync("setup.status", { version: DATA_VERSION.version });
      if (!st.ready) {
        // 原生层在后台线程下载、解压、建全文索引，进度通过事件推回来
        const off = on("setup", (ev) => { setup.phase = ev.phase || setup.phase; setup.progress = ev.progress ?? setup.progress; });
        try { await call("setup.prepare", { url: DB_URL, sha256: DATA_VERSION.sha256, version: DATA_VERSION.version }); } finally { off(); }
      }
      setup.phase = "打开资料库"; setup.progress = 0.99;
      openLegalDb();
      setup.ready = true; setup.phase = "完成"; setup.progress = 1;
      return;
    } catch (e) {
      const msg = String(e.message || e);
      if (/空间不足/.test(msg)) { setup.error = msg; return; }
      const wait = Math.min(60, 15 * attempt);
      for (let t = wait; t > 0; t--) {
        setup.phase = `准备失败（${msg.slice(0, 60)}），${t} 秒后自动重试（第 ${attempt} 次）。请确认网络正常，并保持 App 在前台`;
        setup.progress = 0;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}

function appInfo() {
  const info = isNative ? callSync("app.info") : {};
  return { version: info.version || "dev", sequence: 0, data: DATA_VERSION.version, data_dir: "App 内", platform: "ios", arch: "arm64", build: info.build || "" };
}

// 把 fetch 的 Request 变成服务端代码要的 req / res，响应写进一个流式 Response（问答的 SSE 照常逐字显示）
function makeLocalApi(handle) {
  const counts = new Map();
  return async (u, request) => {
    if (/[?&]debug\b/.test(location.search)) { // 调试：同一接口 3 秒内被调用上百次时报出来
      const k = u.pathname; const c = (counts.get(k) || 0) + 1; counts.set(k, c);
      if (c === 1) setTimeout(() => counts.delete(k), 3000);
      if (c > 200) { window.__loop = k; throw new Error("循环调用：" + k); }
    }
    const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
    const handlers = {};
    const req = {
      url: u.pathname + u.search, method: request.method,
      headers: Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v])),
      on(ev, fn) { handlers[ev] = fn; return req; }, destroy() {},
    };
    let ctrl, resolveHead;
    const head = new Promise((r) => { resolveHead = r; });
    const stream = new ReadableStream({ start(c) { ctrl = c; } });
    const res = {
      headersSent: false, writableEnded: false, statusCode: 200, _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this._headers, headers); this.headersSent = true; resolveHead(); return this; },
      write(chunk) { if (!this.headersSent) this.writeHead(200); if (chunk != null) ctrl.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)); return true; },
      end(chunk) { if (this.writableEnded) return; if (chunk != null) this.write(chunk); else if (!this.headersSent) this.writeHead(this.statusCode); this.writableEnded = true; try { ctrl.close(); } catch { /* 已关闭 */ } },
    };
    handle(req, res);
    // 请求体：服务端代码按 Node 的事件方式读
    queueMicrotask(() => { if (body?.length) handlers.data?.(body); handlers.end?.(); });
    await head;
    const h = { ...res._headers };
    delete h["Content-Length"]; delete h["content-length"];
    return new Response(stream, { status: res.statusCode, headers: h });
  };
}

async function main() {
  try { callSync("fs.mkdir", { path: DATA }); callSync("fs.mkdir", { path: DATA + "/tmp" }); } catch { /* 原生层会建好 */ }
  openUserDb();
  const server = createServer({
    staticDir: "/web",
    settingsPath: DATA + "/settings.json",
    userDb: () => userDb,
    status: () => ({ ...setup }),
    updateStatus: () => ({ ...sync }),
    startUpdate,
    stopUpdate: () => syncCtrl?.abort(),
    appInfo,
    notify: ({ title, body, runId }) => call("notify", { title: `${title}`, body, runId }).catch(() => {}),
  });
  setLocalApi(makeLocalApi(server.handle));
  location.hash = "t=" + server.token;
  prepareData().then(() => { setTimeout(maybeAutoUpdate, 30000); setInterval(maybeAutoUpdate, 6 * 3600 * 1000); });
  // 服务端准备好之后再加载界面脚本（界面一启动就会调 /api/status）
  const launch = window.__launch || {};
  if (launch.autotest || /[?&]autotest\b/.test(location.search)) import("./autotest.mjs").then((m) => m.autotest()).then((r) => { window.__autotestDone = r; });
  if (/[?&]noui\b/.test(location.search)) { window.__bootDone = true; return; } // 调试：只启动服务端
  for (const src of ["shortcuts.js", "app.js"]) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("加载失败：" + src));
      document.body.appendChild(s);
    });
  }
  setupPhone();
  setupNativeDictation();
  setupIosVersion();
  setupIosAttach();
  setupIosUploadLimits();
  call("app.ready").catch(() => {}); // 原生层：页面准备好了（冷启动时点通知要打开的报告在这之后打开）
  // 启动参数 -view agents 等：直接打开某个页面（截图测试用）
  if (launch.view && typeof window.showView === "function") setTimeout(() => window.showView(launch.view), 300);
}

main().catch((e) => {
  document.body.insertAdjacentHTML("afterbegin", `<pre style="padding:16px;color:#a00;white-space:pre-wrap">启动失败：${String(e?.stack || e)}</pre>`);
});
