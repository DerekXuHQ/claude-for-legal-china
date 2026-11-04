// 本地服务：只监听 127.0.0.1，随机端口；每个请求都要带启动时生成的令牌，其他网页和程序调用不了。
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, chmodSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as search from "./search.mjs";
import { ask } from "./agent.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
export const DEFAULT_SETTINGS = {
  provider: "anthropic", base_url: "", api_key: "", model: "claude-opus-5-5", effort: "medium", extra_headers: {}, fallback: true,
  auto_update: true, update_interval_days: 7,
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
export function createServer(ctx) {
  const token = randomUUID();
  const conversations = new Map();

  const loadSettings = () => {
    const s = { ...DEFAULT_SETTINGS };
    if (existsSync(ctx.settingsPath)) Object.assign(s, JSON.parse(readFileSync(ctx.settingsPath, "utf-8")));
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
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 2e6) { reject(new Error("请求太大")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });

  const serveStatic = (res, urlPath) => {
    const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
    const target = path.resolve(ctx.staticDir, rel);
    if (!target.startsWith(path.resolve(ctx.staticDir) + path.sep) || !existsSync(target) || !statSync(target).isFile()) return send(res, 404, { error: "未找到" });
    const body = readFileSync(target);
    res.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream", "Content-Length": body.length, "Cache-Control": "no-cache" });
    res.end(body);
  };

  async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const p = url.pathname;
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
      if (p.startsWith("/api/updates/")) {
        const row = ctx.userDb()?.prepare("SELECT * FROM update_log WHERE id = ?").get(Number(p.split("/").pop()));
        return row ? send(res, 200, { ...row, diff: row.diff ? JSON.parse(row.diff) : null }) : send(res, 404, { error: "未找到" });
      }
      if (!ready) return send(res, 503, { error: "资料库还在准备中" });
      if (p === "/api/meta") {
        const s = loadSettings();
        return send(res, 200, { ...search.meta(), configured: !!s.api_key || (s.provider === "openai" && !!s.base_url) });
      }
      if (p === "/api/search") {
        const limit = Math.min(Number(q.limit) || 20, 100), offset = Number(q.offset) || 0, text = q.q || "";
        const common = { level: q.level || "", province: q.province || "", topic: q.topic || "", current_only: q.all !== "1", limit, offset };
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
        const getter = { article: search.getArticle, law: search.getDoc, case: search.getCase, ref: search.getRef }[kind];
        const item = getter ? getter(id) : null;
        return item ? send(res, 200, item) : send(res, 404, { error: "未找到" });
      }
      if (p === "/api/bookmarks") return send(res, 200, ctx.userDb()?.prepare("SELECT * FROM bookmarks ORDER BY created DESC").all() || []);
      return send(res, 404, { error: "未找到" });
    }

    if (req.method === "POST") {
      if (p === "/api/settings") { saveSettings(await readBody(req)); return send(res, 200, { ok: true }); }
      if (p === "/api/updates/run") {
        const b = await readBody(req);
        return send(res, 200, ctx.startUpdate(b.mode === "full" ? "full" : "incremental"));
      }
      if (p === "/api/updates/stop") { ctx.stopUpdate(); return send(res, 200, { ok: true }); }
      if (p === "/api/bookmarks") {
        const b = await readBody(req);
        ctx.userDb().prepare(`INSERT INTO bookmarks(kind, ref_id, title, subtitle, snippet, note, created) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(kind, ref_id) DO UPDATE SET note = excluded.note`)
          .run(String(b.kind), String(b.ref_id), String(b.title || ""), String(b.subtitle || ""), String(b.snippet || ""), String(b.note || ""), Date.now() / 1000);
        return send(res, 200, { ok: true });
      }
      if (p === "/api/ask") return askHandler(req, res);
      return send(res, 404, { error: "未找到" });
    }

    if (req.method === "DELETE") {
      if (p.startsWith("/api/bookmarks/")) { ctx.userDb().prepare("DELETE FROM bookmarks WHERE id = ?").run(Number(p.split("/").pop())); return send(res, 200, { ok: true }); }
      if (p.startsWith("/api/conversation/")) { conversations.delete(p.split("/").pop()); return send(res, 200, { ok: true }); }
    }
    return send(res, 404, { error: "未找到" });
  }

  async function askHandler(req, res) {
    const body = await readBody(req);
    const settings = loadSettings();
    const question = String(body.question || "").trim();
    const region = String(body.region || "").trim();
    const convId = typeof body.conversation_id === "string" && body.conversation_id ? body.conversation_id : randomUUID();
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
    const ctrl = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ctrl.abort(); });
    let answer = "";
    const steps = [];
    const emit = (ev) => {
      if (ev.type === "text") answer += ev.delta;
      else if (ev.type === "text_reset") answer = "";
      else if (ev.type === "step") steps.push(ev.text);
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };
    try {
      if (!ctx.status().ready) emit({ type: "error", message: "资料库还在准备中，请稍候。" });
      else if (!question) emit({ type: "error", message: "问题不能为空" });
      else if (!settings.api_key && settings.provider === "anthropic") emit({ type: "error", message: "还没有配置 API key，请点右上角「设置」。" });
      else {
        const history = conversations.get(convId) || [];
        conversations.set(convId, await ask(settings, history, question, region, emit, ctrl.signal));
        const id = randomUUID().replace(/-/g, "").slice(0, 12);
        ctx.userDb().prepare("INSERT INTO answers VALUES(?,?,?,?,?,?,?)").run(id, question, region, answer, JSON.stringify(steps), settings.model, Date.now() / 1000);
        emit({ type: "done", answer_id: id, conversation_id: convId });
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const status = err?.status ? `（HTTP ${err.status}）` : "";
        emit({ type: "error", message: `${err?.name || "Error"}${status}：${String(err?.message || err).slice(0, 500)}` });
      }
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
  return {
    token,
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => server.close(),
  };
}
