// 本地服务：只监听 127.0.0.1，随机端口；每个请求都要带启动时生成的令牌，其他网页和程序调用不了。
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, chmodSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

// 前端画扫描版 PDF 的页用的 pdf.js（含中文编码表 cmaps）
const PDFJS_DIR = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
import * as search from "./search.mjs";
import { ask, newConversation } from "./ai/ask.mjs";
import { listModels, DEFAULT_BASE_URL, complete, client } from "./ai/models.mjs";
import { extractDoc, tidy, garbleRatio, EXT } from "./ai/docs.mjs";
import { ocrImage, ocrPages, ocrFrames, tiffToPngs, heicToJpeg, audioToWav16k } from "./ai/ocr.mjs";
import { markdownToDocx } from "./ai/export.mjs";
import { LiveDictation, transcribeWav, transcribeRobust, DEFAULT_SPEECH_MODEL } from "./ai/speech.mjs";
import * as matters from "./matters.mjs";
import { scenarioCatalog } from "./ai/tasks.mjs";
import { PIPELINES } from "./ai/pipelines.mjs";
import * as reg from "./registers.mjs";
import { rosterForUi, getAgent, skillText, profileTemplate } from "./ai/roster.mjs";
import { watcherList, runWatcher, tick as watcherTick, isRunning as watcherRunning } from "./ai/watchers.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
export const DEFAULT_SETTINGS = {
  base_url: DEFAULT_BASE_URL, api_key: "", model: "", depth: "medium", review_model: "auto", transcribe_model: DEFAULT_SPEECH_MODEL,
  auto_update: true, update_interval_days: 7,
  watchers_off: false, watchers_disabled: {}, // 定时 Agent：全部关闭 / 单个关闭
};

/**
 * @param {object} ctx
 * @param {string} ctx.staticDir
 * @param {string} ctx.settingsPath
 * @param {() => import('node:sqlite').DatabaseSync|null} ctx.userDb
 * @param {() => object} ctx.status          资料库准备进度
 * @param {() => object} ctx.updateStatus    官方更新进度
 * @param {(mode:string) => object} ctx.startUpdate
 * @param {() => void} ctx.stopUpdate
 * @param {() => object} ctx.appInfo
 */
// 把模型接口的报错翻成人话（原文附在后面，方便排查）
function friendlyError(err) {
  const raw = String(err?.message || err || "").slice(0, 300);
  const st = err?.status;
  if (st === 401 || st === 403) return `API key 无效或没有权限（HTTP ${st}）。请到「设置」检查 API key 和接口地址。`;
  if (st === 404) return `接口上没有这个模型（HTTP 404）。请在输入框下方换一个模型，或到「设置」重新读取模型清单。`;
  if (st === 429) return "请求太频繁，接口暂时限流了。稍等一两分钟再点「重试」。";
  if (st >= 500 || /connection|fetch failed|terminated|timeout|ECONN|socket/i.test(raw)) return "连接 AI 接口失败：网络或网关暂时断开，已自动重试 5 次仍不成功。稍等一会儿点「重试」，已经填的内容不用重写。";
  return `出错了：${raw}`;
}

export function createServer(ctx) {
  const token = randomUUID();
  const dataDir = path.dirname(ctx.settingsPath);
  let tablesReady = false;
  const udb = () => {
    const db = ctx.userDb();
    if (db && !tablesReady) { matters.ensureMatterTables(db); reg.ensureRegisterTables(db); tablesReady = true; }
    return db;
  };
  const running = new Map(); // matterId -> AbortController
  const dictations = new Map(); // 听写 id -> { session, at }
  const modelCache = { key: "", at: 0, models: [] };

  const loadSettings = () => {
    const s = { ...DEFAULT_SETTINGS };
    if (existsSync(ctx.settingsPath)) {
      const saved = JSON.parse(readFileSync(ctx.settingsPath, "utf-8"));
      for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in saved) s[k] = saved[k];
    }
    if (!s.base_url) s.base_url = DEFAULT_BASE_URL;
    if (!s.transcribe_model) s.transcribe_model = DEFAULT_SPEECH_MODEL;
    return s;
  };
  const saveSettings = (patch) => {
    const s = loadSettings();
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (!(k in patch)) continue;
      if (k === "api_key" && patch[k] === "********") continue;
      s[k] = patch[k];
    }
    writeFileSync(ctx.settingsPath, JSON.stringify(s, null, 2), { encoding: "utf-8", mode: 0o600 });
    chmodSync(ctx.settingsPath, 0o600);
    return s;
  };

  const send = (res, status, obj) => {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
    res.end(body);
  };
  const readBody = (req, limit = 2e6) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("请求太大")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });

  const serveVendor = (res, rel) => {
    rel = decodeURIComponent(rel);
    if (!/^(build\/pdf(\.worker)?\.min\.mjs|cmaps\/[\w.-]+\.bcmap|standard_fonts\/[\w.-]+)$/.test(rel)) return send(res, 404, { error: "未找到" });
    const target = path.join(PDFJS_DIR, rel);
    if (!existsSync(target)) return send(res, 404, { error: "未找到" });
    const body = readFileSync(target);
    res.writeHead(200, { "Content-Type": rel.endsWith(".mjs") ? "application/javascript; charset=utf-8" : "application/octet-stream", "Content-Length": body.length, "Cache-Control": "max-age=86400" });
    res.end(body);
  };
  const serveStatic = (res, urlPath) => {
    const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
    const target = path.resolve(ctx.staticDir, rel);
    if (!target.startsWith(path.resolve(ctx.staticDir) + path.sep) || !existsSync(target) || !statSync(target).isFile()) return send(res, 404, { error: "未找到" });
    const body = readFileSync(target);
    res.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream", "Content-Length": body.length, "Cache-Control": "no-store" });
    res.end(body);
  };

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const p = url.pathname;
    if (p.startsWith("/vendor/pdfjs/")) return serveVendor(res, p.slice("/vendor/pdfjs/".length));
    if (!p.startsWith("/api/")) return serveStatic(res, p);
    if (req.headers["x-app-token"] !== token) return send(res, 403, { error: "forbidden" });
    const q = Object.fromEntries(url.searchParams);
    const ready = ctx.status().ready;

    if (req.method === "GET") {
      if (p === "/api/status") return send(res, 200, { ...ctx.status(), app: ctx.appInfo() });
      if (p === "/api/settings") {
        const s = loadSettings();
        return send(res, 200, { ...s, api_key: s.api_key ? "********" : "" });
      }
      if (p === "/api/updates") {
        const db = ctx.userDb();
        const items = db ? db.prepare(`SELECT id, at, source, action, title, doc_id, compare_to, url, summary FROM update_log
          WHERE action NOT IN ('confirmed', 'older') ORDER BY id DESC LIMIT ?`).all(Number(q.limit) || 300) : [];
        const last = db?.prepare("SELECT value FROM sync_state WHERE key = 'last_check'").get()?.value || "";
        const confirmed = db?.prepare("SELECT count(*) n FROM update_log WHERE action = 'confirmed'").get()?.n || 0;
        return send(res, 200, { items, last_check: last, confirmed, running: ctx.updateStatus() });
      }
      if (p === "/api/updates/status") return send(res, 200, ctx.updateStatus());
      if (p === "/api/app-update") return send(res, 200, ctx.appUpdate?.status() || { status: "unavailable" });
      if (p.startsWith("/api/updates/")) {
        const row = ctx.userDb()?.prepare("SELECT * FROM update_log WHERE id = ?").get(Number(p.split("/").pop()));
        return row ? send(res, 200, { ...row, diff: row.diff ? JSON.parse(row.diff) : null }) : send(res, 404, { error: "未找到" });
      }
      if (!ready) return send(res, 503, { error: "资料库还在准备中" });
      if (p === "/api/meta") {
        const s = loadSettings();
        return send(res, 200, { ...search.meta(), configured: !!s.api_key });
      }
      if (p === "/api/browse/laws") {
        return send(res, 200, search.browseLaws({ level: q.level || "", province: q.province || "", topic: q.topic || "", sort: q.sort || "name",
          offset: Number(q.offset) || 0, limit: Math.min(Number(q.limit) || 200, 500) }));
      }
      if (p === "/api/browse/facets") return send(res, 200, search.browseFacets({ level: q.level || "", province: q.province || "", topic: q.topic || "" }));
      if (p === "/api/browse/cases") return send(res, 200, search.browseCases({ offset: Number(q.offset) || 0, limit: Math.min(Number(q.limit) || 400, 500) }));
      if (p === "/api/browse/guides") return send(res, 200, search.browseGuides());
      if (p === "/api/search") {
        const limit = Math.min(Number(q.limit) || 20, 100), offset = Number(q.offset) || 0, text = q.q || "";
        const common = { level: q.level || "", province: q.province || "", topic: q.topic || "", current_only: true, limit, offset };
        if (q.type === "all" || !q.type) return send(res, 200, search.searchAll(text, common));
        if (q.type === "laws") return send(res, 200, search.searchLaws(text, common));
        if (q.type === "cases") return send(res, 200, search.searchCases(text, { limit, offset }));
        if (q.type === "refs") return send(res, 200, search.searchRefs(text, { limit, offset }));
        return send(res, 200, search.searchArticles(text, common));
      }
      if (p === "/api/compare") {
        const r = search.compareVersions(q.a || "", q.b || "");
        return r ? send(res, 200, r) : send(res, 404, { error: "未找到" });
      }
      if (p.startsWith("/api/item/")) {
        const [kind, ...rest] = p.slice("/api/item/".length).split("/");
        const id = decodeURIComponent(rest.join("/"));
        if (kind === "answer") {
          const r = ctx.userDb()?.prepare("SELECT * FROM answers WHERE id = ?").get(id);
          return r ? send(res, 200, { ...r, kind: "answer" }) : send(res, 404, { error: "未找到" });
        }
        const getter = { article: search.getArticle, law: search.getDoc, case: search.getCase, ref: search.getGuide }[kind];
        const item = getter ? getter(id) : null;
        return item ? send(res, 200, item) : send(res, 404, { error: "未找到" });
      }
      if (p === "/api/scenarios") {
        const cat = scenarioCatalog();
        return send(res, 200, { groups: cat.groups, pipelines: Object.fromEntries(Object.entries(PIPELINES).map(([k, v]) => [k, v.name])),
          scenarios: cat.scenarios.map((x) => ({ id: x.id, code: x.code, name: x.name, group: x.group, pipeline: x.pipeline, freq: x.freq, examples: x.examples, needsDoc: !!PIPELINES[x.pipeline]?.needsDoc || x.pipeline === "P5" })) });
      }
      if (p === "/api/models") {
        const s = loadSettings();
        if (!s.api_key) return send(res, 200, { models: [], error: "还没有填写 API key" });
        const key = s.base_url + "|" + s.api_key;
        if (q.refresh !== "1" && modelCache.key === key && Date.now() - modelCache.at < 600000) return send(res, 200, { models: modelCache.models, model: s.model, depth: s.depth });
        try {
          const models = await listModels(s);
          Object.assign(modelCache, { key, at: Date.now(), models });
          return send(res, 200, { models, model: s.model, depth: s.depth });
        } catch (err) {
          return send(res, 200, { models: [], error: `读取模型清单失败${err?.status ? "（HTTP " + err.status + "）" : ""}：${String(err?.message || err).slice(0, 200)}` });
        }
      }
      if (p === "/api/bookmarks") return send(res, 200, ctx.userDb()?.prepare("SELECT * FROM bookmarks ORDER BY created DESC").all() || []);
      if (/^\/api\/(agents|registers|profiles|runs)/.test(p) && !udb()) return send(res, 503, { error: "本机数据库还没准备好，请稍候再试" });
      if (p === "/api/agents") {
        const db = udb(), off = loadSettings().watchers_disabled || {};
        const ui = rosterForUi(db);
        ui.counts = reg.registerCounts(db);
        ui.watchers = Object.fromEntries(watcherList().map((a) => [a.id, { enabled: !off[a.id], running: watcherRunning(a.id), last: reg.lastRun(db, a.id) }]));
        ui.unseen = db.prepare("SELECT count(*) n FROM agent_runs WHERE seen = 0 AND status = 'done'").get().n;
        return send(res, 200, ui);
      }
      if (p === "/api/agents/skill") {
        const a = getAgent(q.id || "");
        return a ? send(res, 200, { id: a.id, title: a.title, skills: a.skills.map((k) => ({ key: k, text: skillText(k) })) }) : send(res, 404, { error: "未找到" });
      }
      if (p.startsWith("/api/registers/")) return send(res, 200, reg.queryRegister(udb(), p.split("/")[3], q.keyword || ""));
      if (p.startsWith("/api/profiles/")) {
        const plugin = p.split("/")[3];
        const pr = reg.getProfile(udb(), plugin);
        return send(res, 200, { plugin, text: pr?.text || "", updated: pr?.updated || 0, template: plugin === "_company" ? "" : profileTemplate(plugin) });
      }
      if (p === "/api/runs") return send(res, 200, reg.listRuns(udb(), q.agent || ""));
      if (p.startsWith("/api/runs/")) {
        const r = reg.getRun(udb(), p.split("/")[3]);
        if (r && !r.seen) udb().prepare("UPDATE agent_runs SET seen = 1 WHERE id = ?").run(r.id);
        return r ? send(res, 200, { ...r, steps: JSON.parse(r.steps || "[]") }) : send(res, 404, { error: "未找到" });
      }
      if (p === "/api/matters") return send(res, 200, matters.listMatters(udb()));
      if (p.startsWith("/api/matters/")) {
        const m = matters.getMatter(udb(), p.split("/")[3]);
        return m ? send(res, 200, { id: m.id, title: m.title, task: m.task, agent: m.state.agent || "", display: m.display, files: m.files, pending: !!m.state.pending, running: running.has(m.id) }) : send(res, 404, { error: "未找到" });
      }
      if (p.startsWith("/api/files/")) {
        const f = matters.filePath(udb(), dataDir, p.split("/").pop());
        if (!f) return send(res, 404, { error: "未找到" });
        const body = readFileSync(f.path);
        res.writeHead(200, { "Content-Type": f.mime || "application/octet-stream", "Content-Length": body.length });
        return res.end(body);
      }
      return send(res, 404, { error: "未找到" });
    }

    if (req.method === "POST") {
      if (p === "/api/settings") { saveSettings(await readBody(req)); return send(res, 200, { ok: true }); }
      if (p === "/api/updates/run") {
        const b = await readBody(req);
        return send(res, 200, ctx.startUpdate(b.mode === "full" ? "full" : "incremental"));
      }
      if (p === "/api/updates/stop") { ctx.stopUpdate(); return send(res, 200, { ok: true }); }
      if (p === "/api/app-update/check") return send(res, 200, (await ctx.appUpdate?.check()) || { status: "unavailable" });
      if (p === "/api/app-update/download") {
        ctx.appUpdate?.download();  // 在后台下载，界面轮询状态
        return send(res, 200, { ok: true });
      }
      if (p === "/api/app-update/restart") { send(res, 200, { ok: true }); setTimeout(() => ctx.appUpdate?.restart(), 300); return; }
      if (p === "/api/bookmarks") {
        const b = await readBody(req);
        ctx.userDb().prepare(`INSERT INTO bookmarks(kind, ref_id, title, subtitle, snippet, note, created) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(kind, ref_id) DO UPDATE SET note = excluded.note`)
          .run(String(b.kind), String(b.ref_id), String(b.title || ""), String(b.subtitle || ""), String(b.snippet || ""), String(b.note || ""), Date.now() / 1000);
        return send(res, 200, { ok: true });
      }
      if (p === "/api/ask") return askHandler(req, res);
      if (/^\/api\/(registers|profiles|watchers)\//.test(p) && !udb()) return send(res, 503, { error: "本机数据库还没准备好，请稍候再试" });
      if (p.startsWith("/api/registers/")) {
        const b = await readBody(req);
        return send(res, 200, reg.writeRegister(udb(), p.split("/")[3], b.data, { id: String(b.id || ""), source: "手动录入" }));
      }
      if (p.startsWith("/api/profiles/")) {
        const b = await readBody(req);
        const text = String(b.text || "").trim();
        if (text) reg.saveProfile(udb(), p.split("/")[3], text); else reg.deleteProfile(udb(), p.split("/")[3]);
        return send(res, 200, { ok: true });
      }
      if (/^\/api\/watchers\/[^/]+\/toggle$/.test(p)) {
        let id; try { id = decodeURIComponent(p.split("/")[3]); } catch { return send(res, 400, { error: "参数错误" }); }
        const b = await readBody(req);
        const off = { ...(loadSettings().watchers_disabled || {}) };
        if (b.enabled) delete off[id]; else off[id] = true;
        saveSettings({ watchers_disabled: off });
        return send(res, 200, { ok: true });
      }
      if (/^\/api\/watchers\/[^/]+\/run$/.test(p)) {
        let id; try { id = decodeURIComponent(p.split("/")[3]); } catch { return send(res, 400, { error: "参数错误" }); }
        const settings = loadSettings();
        if (!settings.api_key || !settings.model) return send(res, 400, { error: "还没有配置 API key 或模型" });
        try { return send(res, 200, await runWatcher(settings, { udb: udb(), model: settings.model, id, force: true })); }
        catch (e) { return send(res, 500, { error: friendlyError(e) }); }
      }
      if (p === "/api/matters") {
        const b = await readBody(req);
        return send(res, 200, { id: matters.createMatter(udb(), String(b.title || "")) });
      }
      if (/^\/api\/matters\/[^/]+\/rename$/.test(p)) {
        const b = await readBody(req);
        matters.saveMatter(udb(), p.split("/")[3], { title: String(b.title || "").trim() || "未命名事项" });
        return send(res, 200, { ok: true });
      }
      if (p === "/api/upload") return uploadHandler(req, res);
      if (p === "/api/ocr") return ocrHandler(req, res);
      if (p === "/api/unzip") return unzipHandler(req, res);
      if (p === "/api/fetch-url") return fetchUrlHandler(req, res);
      // 听写（照搬 CopyDeck）：start 建一条实时转写连接；append 每 200ms 送一块 24kHz PCM16，返回目前识别出的全文；
      // boundary 在说话停顿处提交一段；finish 收尾返回最终文字。
      if (p === "/api/mic-permission") return send(res, 200, ctx.micPermission ? await ctx.micPermission() : { ok: true });
      if (p === "/api/dictation/start") {
        const settings = loadSettings();
        if (!settings.api_key) return send(res, 400, { error: "听写需要先在「设置」里填 API key" });
        for (const [k, d] of dictations) if (Date.now() - d.at > 240000) { d.session.close(); dictations.delete(k); }
        const id = randomUUID();
        const session = new LiveDictation({ baseURL: settings.base_url, apiKey: settings.api_key, model: settings.transcribe_model });
        try { await session.ready; } catch (err) { return send(res, 400, { error: `听写连接失败：${err.message}` }); }
        dictations.set(id, { session, at: Date.now() });
        return send(res, 200, { id, model: settings.transcribe_model });
      }
      if (/^\/api\/dictation\/[^/]+\/(append|boundary|finish|cancel)$/.test(p)) {
        const [, , , id, action] = p.split("/");
        const d = dictations.get(id);
        if (!d) return send(res, 404, { error: "听写已经结束" });
        try {
          if (action === "cancel") { d.session.close(); dictations.delete(id); return send(res, 200, { ok: true }); }
          if (action === "append") { const b = await readBody(req, 200000); return send(res, 200, await d.session.append(String(b.audio || ""))); }
          if (action === "boundary") return send(res, 200, await d.session.boundary());
          dictations.delete(id);
          return send(res, 200, await d.session.finish());
        } catch (err) {
          d.session.close(); dictations.delete(id);
          return send(res, 400, { error: String(err?.message || err).slice(0, 300) });
        }
      }
      if (p === "/api/export") {
        const b = await readBody(req);
        const buf = await markdownToDocx(String(b.title || "法律助理产出"), String(b.markdown || ""));
        res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Length": buf.length });
        return res.end(buf);
      }
      if (/^\/api\/matters\/[^/]+\/stop$/.test(p)) {
        running.get(p.split("/")[3])?.abort();
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "未找到" });
    }

    if (req.method === "DELETE") {
      if (p.startsWith("/api/bookmarks/")) { ctx.userDb().prepare("DELETE FROM bookmarks WHERE id = ?").run(Number(p.split("/").pop())); return send(res, 200, { ok: true }); }
      if (p.startsWith("/api/matters/")) { matters.deleteMatter(udb(), dataDir, p.split("/")[3]); return send(res, 200, { ok: true }); }
      if (p.startsWith("/api/registers/")) { if (!udb()) return send(res, 503, { error: "本机数据库还没准备好" }); const [, , , kind, id] = p.split("/"); return send(res, 200, reg.deleteRegister(udb(), kind, id)); }
    }
    return send(res, 404, { error: "未找到" });
  }

  // 上传：能直接读文字的直接读；读不出的（扫描件、照片、截图、视频画面）做文字识别；录音和视频的声音转成文字。
  // 扫描版 PDF：本函数先返回需要识别的页码，前端把这些页画成图片逐页送 /api/ocr（显示进度），再带着识别结果重新提交。
  const MAX_OCR_PAGES = 150;
  async function uploadHandler(req, res) {
    const b = await readBody(req, 300e6);
    const settings = loadSettings();
    const name = String(b.name || "文件").slice(0, 200);
    const mime = String(b.mime || "");
    const matterId = String(b.matter_id || "");
    const model = String(b.model || settings.model || "");
    if (!matters.getMatter(udb(), matterId)) return send(res, 404, { error: "事项不存在" });
    const buffer = Buffer.from(String(b.data || ""), "base64");
    const ext = EXT(name);
    const needKey = (what) => { if (!settings.api_key || !model) throw new Error(`${what}需要先在「设置」里配好 API key 并选择模型`); };
    try {
      let kind = "text", text = "", ocred = 0;
      if (/^(heic|heif)$/.test(ext) || /image\/hei[cf]/.test(mime)) {
        kind = "image"; needKey("识别照片");
        text = await ocrImage(settings, { model, img: await heicToJpeg(buffer), label: "照片" }); ocred = 1;
      } else if (/^tiff?$/.test(ext) || mime === "image/tiff") {
        kind = "image"; needKey("识别扫描件");
        const pages = await tiffToPngs(buffer);
        if (!pages.length) throw new Error("读不出这个 TIFF 文件里的图像");
        const texts = await ocrPages(settings, { model, images: pages });
        text = texts.map((t, i) => (pages.length > 1 ? `【第 ${i + 1} 页】\n${t}` : t)).join("\n\n"); ocred = pages.length;
      } else if (/^image\//.test(mime) || /^(png|jpe?g|gif|webp|bmp)$/.test(ext)) {
        kind = "image"; needKey("识别图片");
        text = await ocrImage(settings, { model, img: { data: buffer.toString("base64"), mime: mime || "image/png" }, label: "图片" }); ocred = 1;
      } else if (/^(audio|video)\//.test(mime) || /^(mp3|m4a|wav|aac|ogg|oga|opus|flac|amr|webm|mp4|m4v|mov|mpeg|mpg|mpga|avi|mkv|3gp)$/.test(ext)) {
        kind = /^video\//.test(mime) || /^(mp4|m4v|mov|avi|mkv|webm|mpg|mpeg|3gp)$/.test(ext) ? "video" : "audio";
        if (!settings.api_key) throw new Error("转写录音需要先在「设置」里填 API key");
        // 前端已经把声音解码成 16kHz 单声道 WAV（b.wav16k），视频画面里的文字也已识别好（b.frames_text）
        let speech = "";
        if (!b.wav16k && buffer.length && kind === "audio") b.wav16k = (await audioToWav16k(buffer, ext)).toString("base64");
        if (b.wav16k) speech = (await transcribeRobust({ settings, client: client(settings), model: settings.transcribe_model, wav: Buffer.from(String(b.wav16k), "base64"), mergeModel: model, complete })).trim();
        const frames = String(b.frames_text || "").trim();
        if (!speech && !frames) throw new Error(kind === "video" ? "视频里既没有识别出说话内容，也没有识别出画面文字" : "录音里没有识别出说话内容");
        const note = "〔以下是录音的自动转写：同音字、人名、数字可能听错，关键语句请以原录音为准〕";
        text = kind === "video" ? [speech && `【说话内容】${note}\n${speech}`, frames && `【画面里的文字】\n${frames}`].filter(Boolean).join("\n\n") : `${note}\n${speech}`;
      } else {
        const r = await extractDoc(name, buffer);
        text = r.text;
        if (ext === "pdf" && r.ocrPages.length) {
          const given = b.ocr_pages && typeof b.ocr_pages === "object" ? b.ocr_pages : null;
          if (!given) {
            needKey("识别扫描版 PDF");
            const pages = r.ocrPages.slice(0, MAX_OCR_PAGES);
            return send(res, 200, { needs_ocr: true, pages, total: r.pages.length, truncated: r.ocrPages.length > pages.length });
          }
          const pages = r.pages.slice();
          for (const [n, t] of Object.entries(given)) if (pages[Number(n) - 1] !== undefined) { pages[Number(n) - 1] = String(t || ""); ocred++; }
          kind = ocred ? "scan" : kind;
          text = pages.map((t, i) => (pages.length > 1 ? `【第 ${i + 1} 页】\n${t}` : t)).join("\n\n");
          if (r.ocrPages.length > MAX_OCR_PAGES) text += `\n\n〔扫描页超过 ${MAX_OCR_PAGES} 页，后面的页没有识别〕`;
        } else if (r.images?.length) {
          needKey("识别文档里的图片");
          const texts = await ocrPages(settings, { model, images: r.images, labelOf: (i) => r.images[i].label });
          ocred = texts.length;
          if (r.parts) { // PPT：识别结果放回对应的幻灯片
            r.images.forEach((img, i) => { r.parts[img.slot] += `\n（图片文字）\n${texts[i]}`; });
            text = r.parts.join("\n\n");
          } else {
            text = [text.trim(), ...texts.map((t, i) => `【${r.images[i].label}（文字识别）】\n${t}`)].filter(Boolean).join("\n\n");
          }
        }
      }
      text = tidy(text);
      if (!text || /^（空白页）$/.test(text)) throw new Error("文件里没有找到文字（识别后也是空白）");
      const g = garbleRatio(text);
      const warn = g > 0.005 ? "识别结果里有少量无法辨认的字符，关键内容请对照原件" : "";
      const f = matters.addFile(udb(), dataDir, matterId, { name, kind, mime, text, buffer });
      matters.saveMatter(udb(), matterId, {});
      return send(res, 200, { ...f, preview: text.slice(0, 200), ocr_pages: ocred, warn });
    } catch (err) {
      return send(res, 400, { error: String(err?.message || err).slice(0, 400) });
    }
  }

  // zip 压缩包：展开成文件交给前端逐个处理。中文 Windows 打的包，文件名常是 GBK 编码（没有 UTF-8 标记），要按 GBK 解。
  async function unzipHandler(req, res) {
    const b = await readBody(req, 400e6);
    try {
      const JSZip = (await import("jszip")).default;
      const decodeName = (bytes) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("gb18030").decode(bytes); } };
      const zip = await JSZip.loadAsync(Buffer.from(String(b.data || ""), "base64"), { decodeFileName: decodeName });
      const files = [];
      let skipped = 0, total = 0;
      for (const [name, e] of Object.entries(zip.files)) {
        if (e.dir || /(^|\/)(__MACOSX|\.)|(^|\/)(Thumbs\.db|desktop\.ini)$/i.test(name)) continue;
        if (files.length >= 300 || /\.(zip|rar|7z)$/i.test(name)) { skipped++; continue; }
        const buf = await e.async("nodebuffer");
        if ((total += buf.length) > 300e6) { skipped++; continue; }
        files.push({ name, data: buf.toString("base64") });
      }
      return send(res, 200, { files, skipped });
    } catch (err) {
      return send(res, 400, { error: "解不开这个压缩包（可能损坏或加了密码）" });
    }
  }

  // 拖进来的链接：网页在本机打开取正文（脚本生成的内容也能取到）；指向文件的直接下载交给前端按文件处理
  async function fetchUrlHandler(req, res) {
    const b = await readBody(req);
    const url = String(b.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return send(res, 400, { error: "只支持 http/https 链接" });
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Accept-Language": "zh-CN,zh;q=0.9" } }).finally(() => clearTimeout(timer));
      if (!r.ok) throw new Error(`网站返回 ${r.status}`);
      const type = (r.headers.get("content-type") || "").toLowerCase();
      const host = new URL(r.url || url).hostname;
      if (/text\/html|application\/xhtml/.test(type) || !type) {
        let page = null;
        if (ctx.renderUrl) page = await ctx.renderUrl(url).catch(() => null);
        if (!page || (page.text || "").replace(/\s/g, "").length < 50) {
          const buf = Buffer.from(await r.arrayBuffer());
          const cs = type.match(/charset=([\w-]+)/)?.[1] || buf.toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || "utf-8";
          let html; try { html = new TextDecoder(cs).decode(buf); } catch { html = buf.toString("utf-8"); }
          const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || host;
          const { extractDoc } = await import("./ai/docs.mjs");
          page = { title, text: (await extractDoc("x.html", Buffer.from(html, "utf-8"))).text };
        }
        const text = `来源：${url}\n标题：${page.title || host}\n\n${page.text || ""}`;
        if ((page.text || "").replace(/\s/g, "").length < 50) throw new Error("这个网页读不到正文（可能需要登录，或者有验证页）");
        const name = `${(page.title || host).replace(/[\\/:*?"<>|\s]+/g, " ").trim().slice(0, 60)}.txt`;
        return send(res, 200, { name, mime: "text/plain", data: Buffer.from(text, "utf-8").toString("base64") });
      }
      const len = Number(r.headers.get("content-length") || 0);
      if (len > 200e6) throw new Error("文件太大（超过 200MB）");
      const buf = Buffer.from(await r.arrayBuffer());
      const cd = r.headers.get("content-disposition") || "";
      let name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || cd.match(/filename="?([^";]+)/i)?.[1] || decodeURIComponent(new URL(r.url || url).pathname.split("/").pop() || "") || host);
      const extByType = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx", "application/msword": ".doc", "audio/mpeg": ".mp3", "video/mp4": ".mp4", "text/plain": ".txt" };
      const ext = extByType[type.split(";")[0]];
      if (ext && !name.toLowerCase().endsWith(ext)) name += ext;
      return send(res, 200, { name, mime: type.split(";")[0], data: buf.toString("base64") });
    } catch (err) {
      return send(res, 400, { error: err.name === "AbortError" ? "打开链接超时" : String(err.message || err).slice(0, 200) });
    }
  }

  // 识别一页（扫描版 PDF 的页）或一组视频画面
  async function ocrHandler(req, res) {
    const b = await readBody(req, 40e6);
    const settings = loadSettings();
    const model = String(b.model || settings.model || "");
    if (!settings.api_key || !model) return send(res, 400, { error: "文字识别需要先在「设置」里配好 API key 并选择模型" });
    try {
      if (Array.isArray(b.frames)) return send(res, 200, { text: await ocrFrames(settings, { model, frames: b.frames.slice(0, 8) }) });
      const img = b.image && { data: String(b.image.data || ""), mime: String(b.image.mime || "image/jpeg") };
      if (!img?.data) return send(res, 400, { error: "没有图片" });
      return send(res, 200, { text: await ocrImage(settings, { model, img, label: String(b.label || "").slice(0, 60) }) });
    } catch (err) {
      return send(res, 400, { error: friendlyError ? friendlyError(err) : String(err?.message || err).slice(0, 300) });
    }
  }

  async function askHandler(req, res) {
    const body = await readBody(req);
    const settings = loadSettings();
    const matterId = String(body.matter_id || "");
    const m = matters.getMatter(udb(), matterId);
    const question = String(body.question || "").trim();
    const region = String(body.region || "").trim();
    const model = typeof body.model === "string" && body.model ? body.model : settings.model;
    const depth = ["low", "medium", "high"].includes(body.depth) ? body.depth : settings.depth;
    if (model !== settings.model || depth !== settings.depth) saveSettings({ model, depth });
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
    const ctrl = new AbortController();
    let answer = "";
    const out = { role: "assistant", task: "", steps: [], text: "", intake: null, citations: null, answer_id: "", error: "" };
    const emit = (ev) => {
      if (ev.type === "text") answer += ev.delta;
      else if (ev.type === "text_reset") answer = "";
      else if (ev.type === "step" && (ev.kind || ev.detail)) out.steps.push({ t: ev.text, k: ev.kind || "", d: ev.detail || "" });
      else if (ev.type === "step" || ev.type === "stage") out.steps.push(ev.text);
      else if (ev.type === "route") out.task = ev.name;
      else if (ev.type === "intake") out.intake = { questions: ev.questions, assumptions: ev.assumptions };
      else if (ev.type === "citations") out.citations = { checked: ev.checked, linked: ev.linked, unverified: ev.unverified };
      else if (ev.type === "error") out.error = ev.message;
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };
    const intakeAnswers = body.intake_answers && typeof body.intake_answers === "object" ? body.intake_answers : null;
    const skipIntake = !!body.skip_intake;
    const fileIds = Array.isArray(body.file_ids) ? body.file_ids.map(String) : [];
    try {
      if (!ctx.status().ready) emit({ type: "error", message: "资料库还在准备中，请稍候。" });
      else if (!m) emit({ type: "error", message: "事项不存在" });
      else if (!question && !intakeAnswers && !skipIntake && !fileIds.length) emit({ type: "error", message: "问题不能为空" });
      else if (!settings.api_key) emit({ type: "error", message: "还没有配置 API key，请点右上角「设置」。" });
      else if (!model) emit({ type: "error", message: "请先在输入框下方选择一个模型。" });
      else if (running.has(matterId)) emit({ type: "error", message: "这个事项正在处理上一条消息，请稍候。" });
      else {
        running.set(matterId, ctrl);
        const display = m.display;
        const files = m.files.filter((f) => fileIds.includes(f.id)).map((f) => ({ id: f.id, name: f.name, kind: f.kind }));
        const userEntry = { role: "user", text: question, files, intake_answers: intakeAnswers, skip_intake: skipIntake, at: Date.now() };
        // 回答追问时，在上一条助理消息上记下用户的回答
        if (intakeAnswers || skipIntake) {
          const last = [...display].reverse().find((d) => d.role === "assistant" && d.intake);
          if (last) last.intake.answered = intakeAnswers || "skipped";
        }
        if (question || files.length) display.push(userEntry);
        const conv = { history: [], route: null, pending: null, reviewed: false, ...m.state };
        const all = matters.filesForAsk(udb(), matterId);
        conv.attachments = all.filter((f) => !fileIds.includes(f.id)).map((f) => ({ name: f.name, text: f.text }));
        const attachments = all.filter((f) => fileIds.includes(f.id)).map((f) => ({ name: f.name, text: f.text }));
        const qText = question || (files.length ? `请处理我上传的文件：${files.map((f) => f.name).join("、")}` : "");
        const r = await ask(settings, {
          conv, question: qText, region, attachments, model, depth, db: search.getDb(), emit, signal: ctrl.signal,
          intakeAnswers, skipIntake, available: modelCache.models, scenario: typeof body.scenario === "string" ? body.scenario : "",
          udb: udb(), matterId, agent: typeof body.agent === "string" ? body.agent : "", clearAgent: body.clear_agent === true,
        });
        out.text = r.text || answer;
        if (!r.intake) {
          const id = randomUUID().replace(/-/g, "").slice(0, 12);
          ctx.userDb().prepare("INSERT INTO answers VALUES(?,?,?,?,?,?,?)").run(id, (m.title !== "新事项" ? m.title + "：" : "") + (question || r.route?.summary || ""), region, out.text, JSON.stringify(out.steps), model, Date.now() / 1000);
          out.answer_id = id;
        }
        display.push({ ...out, at: Date.now(), model });
        delete conv.attachments;
        const title = m.title === "新事项" ? (r.route?.summary || question).slice(0, 40) : undefined;
        matters.saveMatter(udb(), matterId, { state: conv, display, task: r.route?.name || m.task, title });
        emit({ type: "done", answer_id: out.answer_id, intake: !!r.intake, title });
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        emit({ type: "error", message: friendlyError(err) });
      }
      if (m) {
        const display = matters.getMatter(udb(), matterId).display;
        // 出错时也记下用户对追问的回答（重新打开事项时看得到，重试也用得上）
        if (intakeAnswers || skipIntake) {
          const last = [...display].reverse().find((d) => d.role === "assistant" && d.intake);
          if (last && !last.intake.answered) last.intake.answered = intakeAnswers || "skipped";
        }
        if (question) display.push({ role: "user", text: question, files: [], at: Date.now() });
        display.push({ ...out, text: answer, error: out.error || (ctrl.signal.aborted ? "已停止" : "出错"), at: Date.now() });
        matters.saveMatter(udb(), matterId, { display });
      }
    } finally {
      running.delete(matterId);
    }
    res.end();
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: String(err?.message || err) });
      else res.end();
    });
  });
  // 定时 Agent：启动 90 秒后检查一次，之后每 30 分钟检查一次
  let ticking = false;
  const runTick = async () => {
    if (ticking || !ctx.status().ready || !udb()) return;
    ticking = true;
    try { await watcherTick(loadSettings, { udb: udb(), notify: ctx.notify || (() => {}) }); }
    catch (e) { console.error("watchers", e); } finally { ticking = false; }
  };
  if (!process.env.CLS_NO_WATCHERS) { setTimeout(runTick, 90_000).unref?.(); setInterval(runTick, 30 * 60_000).unref?.(); }

  return {
    token,
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => server.close(),
  };
}
