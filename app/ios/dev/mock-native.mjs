// 开发用：在浏览器里模拟 iOS 原生层，不用 Xcode 就能测 iOS 版的网页部分。
// 实现的接口和 ios/App/Sources/Bridge.swift 一一对应（这里也是原生接口的说明书）。
// 用法：node ios/dev/mock-native.mjs <数据目录>   然后浏览器打开打印出来的地址
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../App/Web");
const DATA = path.resolve(process.argv[2] || "./ios-dev-data");
mkdirSync(DATA, { recursive: true });
const real = (p) => { const r = path.join(DATA, String(p).replace(/^\/data\/?/, "")); if (!r.startsWith(DATA)) throw new Error("越界"); return r; };
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".bcmap": "application/octet-stream" };

const dbs = new Map(); let dbSeq = 0;
const enc = (r) => { if (r) for (const k in r) if (r[k] instanceof Uint8Array) r[k] = { $b64: Buffer.from(r[k]).toString("base64") }; return r; };
const bind = (a) => { const dec = (v) => (v && typeof v === "object" && "$b64" in v ? Buffer.from(v.$b64, "base64") : v); if (a.named) return [Object.fromEntries(Object.entries(a.named).map(([k, v]) => [k, dec(v)]))]; return (a.positional || []).map(dec); };
const stmtCache = new Map();
const stmt = (a) => { const k = a.db + "\0" + a.sql; if (!stmtCache.has(k)) stmtCache.set(k, dbs.get(a.db).prepare(a.sql)); return stmtCache.get(k); };

function sync(op, a) {
  switch (op) {
    case "app.info": return { version: "1.0.76", build: "dev" };
    case "setup.status": return { ready: existsSync(real("/data/legal.db")) };
    case "fs.exists": return existsSync(real(a.path));
    case "fs.read": return readFileSync(real(a.path)).toString("base64");
    case "fs.write": mkdirSync(path.dirname(real(a.path)), { recursive: true }); writeFileSync(real(a.path), Buffer.from(a.data, "base64")); return true;
    case "fs.readdir": return readdirSync(real(a.path));
    case "fs.stat": { const p = real(a.path); if (!existsSync(p)) return null; const s = statSync(p); return { size: s.size, dir: s.isDirectory(), mtime: s.mtimeMs / 1000 }; }
    case "fs.mkdir": mkdirSync(real(a.path), { recursive: true }); return true;
    case "fs.rm": rmSync(real(a.path), { recursive: true, force: true }); return true;
    case "fs.rename": renameSync(real(a.from), real(a.to)); return true;
    case "crypto.hash": return createHash(a.alg).update(Buffer.from(a.data, "base64")).digest("hex");
    case "sqlite.open": { const id = ++dbSeq; dbs.set(id, new DatabaseSync(real(a.path), { readOnly: !!a.readOnly })); return id; }
    case "sqlite.all": return stmt(a).all(...bind(a)).map(enc);
    case "sqlite.get": return enc(stmt(a).get(...bind(a))) ?? null;
    case "sqlite.run": { const r = stmt(a).run(...bind(a)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }
    case "sqlite.exec": dbs.get(a.db).exec(a.sql); return true;
    case "sqlite.close": dbs.get(a.db)?.close(); dbs.delete(a.db); return true;
    default: throw new Error("未知的同步接口：" + op);
  }
}

// 异步接口：结果和事件通过 /__events（SSE）推给页面
const clients = new Set();
const push = (m) => { for (const c of clients) c.write(`data: ${JSON.stringify(m)}\n\n`); };
const resolve = (id, value, error) => push({ kind: "resolve", id, value, error });
const emit = (event, data) => push({ kind: "emit", event, data });
const nets = new Map();

async function asyncOp(id, op, a) {
  try {
    switch (op) {
      case "net.fetch": {
        const ctrl = new AbortController(); nets.set(a.id, ctrl);
        resolve(id, true);
        try {
          const r = await fetch(a.url, { method: a.method, headers: a.headers, body: a.body ? Buffer.from(a.body, "base64") : undefined, signal: ctrl.signal, redirect: "follow" });
          emit("net:" + a.id, { type: "head", status: r.status, statusText: r.statusText, headers: Object.fromEntries(r.headers) });
          for await (const chunk of r.body || []) emit("net:" + a.id, { type: "data", b64: Buffer.from(chunk).toString("base64") });
          emit("net:" + a.id, { type: "end" });
        } catch (e) { emit("net:" + a.id, { type: "error", message: String(e.message || e) }); }
        nets.delete(a.id);
        return;
      }
      case "net.cancel": nets.get(a.id)?.abort(); return resolve(id, true);
      case "notify": console.log("[通知]", a.title, a.body); return resolve(id, true);
      case "app.ready": return resolve(id, true);
      case "share.file": console.log("[分享]", a.name, Math.round((a.data || "").length * 0.75), "字节"); return resolve(id, true);
      case "debug.presented": return resolve(id, "UIActivityViewController"); // 浏览器里没有分享面板
      case "debug.snapshot": return resolve(id, true); // 浏览器里截不了网页视图，跳过
      case "speech.start": case "speech.stop": case "speech.cancel": return resolve(id, null, "开发模式没有语音识别");
      case "ocr.image": return resolve(id, ""); // 模拟器里没有 Vision：返回空，服务端会直接用模型识别
      case "setup.prepare": return resolve(id, null, "开发模式：请先把 legal.db 放进数据目录");
      default: return resolve(id, null, "开发模式不支持：" + op);
    }
  } catch (e) { resolve(id, null, String(e.message || e)); }
}

const MOCK = `<script>
if (location.search.includes("trace")) { window.__tm = {}; const wrap = (name) => { const orig = window[name]; window[name] = function (...a) { const k = name + " " + (new Error().stack.split("\\n")[2] || "").trim().slice(0, 140); window.__tm[k] = (window.__tm[k] || 0) + 1; return orig.apply(this, a); }; }; ["setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask"].forEach(wrap); }
window.webkit = { messageHandlers: { native: { postMessage(m) { fetch("/__async", { method: "POST", body: JSON.stringify(m) }); } } } };
window.prompt = (msg) => { const x = new XMLHttpRequest(); x.open("POST", "/__sync", false); x.send(msg.slice(10)); return x.responseText; };
new EventSource("/__events").onmessage = (e) => { const m = JSON.parse(e.data); if (m.kind === "resolve") window.__native?.resolve(m.id, m.value, m.error); else window.__native?.emit(m.event, m.data); };
</script>`;

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf-8");
    if (u.pathname === "/__sync") {
      const { op, args } = JSON.parse(body);
      let out; try { out = { value: sync(op, args) }; } catch (e) { out = { error: String(e.message || e) }; }
      if (process.env.MOCK_LOG) { const n = JSON.stringify(out).length; if (n > 200000) console.log("[大结果]", op, Math.round(n / 1024) + "KB", String(args.sql || args.path || "").slice(0, 160)); }
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(out));
    }
    if (u.pathname === "/__async") { const m = JSON.parse(body); asyncOp(m.id, m.op, m.args); res.writeHead(204); return res.end(); }
    if (u.pathname === "/__events") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }); clients.add(res); res.on("close", () => clients.delete(res)); return; }
    const rel = u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname.slice(1));
    const f = path.join(WEB, rel);
    if (!f.startsWith(WEB) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    let data = readFileSync(f);
    if (rel === "index.html") data = Buffer.from(data.toString("utf-8").replace("<head>", "<head>" + MOCK).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ""));
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(Number(process.env.PORT || 8790), "127.0.0.1", function () { console.log(`[mock] http://127.0.0.1:${this.address().port}/  数据目录 ${DATA}`); });
