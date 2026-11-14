// 中国法律检索 · 账号服务
// 用户：邮箱注册即生效（离线功能马上可用）；管理员在后台为用户开通在线模型（生成或填写 API key）。
// 依赖：Node 22.13+（node:sqlite），无第三方包。
//
// 环境变量（都有默认值，可放在 data/.env 里，格式 KEY=VALUE）：
//   PORT=4870  HOST=127.0.0.1  DATA_DIR=./data
//   PUBLIC_URL=https://legal.example.com     对外地址（本机小模型清单里的下载地址用它）
//   LITELLM_URL=http://127.0.0.1:4000        可选：后台「自动生成 key」用的 LiteLLM 管理接口
//   LITELLM_MASTER_KEY=sk-...                可选：同上
//   LITELLM_PUBLIC_URL=https://api.example.com/v1   自动生成的 key 交给 App 时用的接口地址
//   LOCAL_MODEL_DIR=./data/local-model       可选：本机小模型文件（含 manifest.json）
// 管理员密码：首次启动时生成在 data/admin-password.txt（仅本人可读）。

import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, createReadStream, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(HERE, "data"));
mkdirSync(DATA_DIR, { recursive: true });
loadEnvFile(path.join(DATA_DIR, ".env"));

const PORT = Number(process.env.PORT || 4870);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://${HOST}:${PORT}`).replace(/\/+$/, "");
const LITELLM_URL = (process.env.LITELLM_URL || "").replace(/\/+$/, "");
const LITELLM_MASTER_KEY = process.env.LITELLM_MASTER_KEY || "";
const LITELLM_PUBLIC_URL = (process.env.LITELLM_PUBLIC_URL || "").replace(/\/+$/, "");
const LOCAL_MODEL_DIR = path.resolve(process.env.LOCAL_MODEL_DIR || path.join(DATA_DIR, "local-model"));
const TOKEN_DAYS = 180;

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function secretFile(name, make) {
  const f = path.join(DATA_DIR, name);
  if (!existsSync(f)) { writeFileSync(f, make(), { mode: 0o600 }); chmodSync(f, 0o600); }
  return readFileSync(f, "utf-8").trim();
}
const ENC_KEY = Buffer.from(secretFile("secret.key", () => randomBytes(32).toString("hex")), "hex");
const ADMIN_PASSWORD = secretFile("admin-password.txt", () => randomBytes(12).toString("base64url"));

// ---------- 数据库 ----------
const db = new DatabaseSync(path.join(DATA_DIR, "accounts.db"));
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  org TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'registered',        -- registered 已注册（未开通） / active 已开通 / suspended 已停用
  note TEXT NOT NULL DEFAULT '',                     -- 给用户看的说明（例如停用原因）
  key_source TEXT NOT NULL DEFAULT '',               -- litellm / manual
  base_url TEXT NOT NULL DEFAULT '',
  key_enc TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  budget REAL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  last_seen TEXT,
  platform TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user_id INTEGER,                                   -- NULL = 管理员
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);`);

const now = () => new Date().toISOString();
const log = (email, action, detail = "") => db.prepare("INSERT INTO events (at, user_email, action, detail) VALUES (?, ?, ?, ?)").run(now(), email, action, detail);

// ---------- 密码、令牌、加密 ----------
function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 32).toString("hex")}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split("$");
  if (!salt || !hash) return false;
  const got = scryptSync(pw, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(got, Buffer.from(hash, "hex"));
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
function newToken(userId, days = TOKEN_DAYS) {
  const t = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO tokens (hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha(t), userId, now(), new Date(Date.now() + days * 864e5).toISOString());
  return t;
}
function encrypt(text) {
  if (!text) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const body = Buffer.concat([c.update(text, "utf-8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}
function decrypt(enc) {
  if (!enc) return "";
  const [iv, tag, body] = enc.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf-8");
}

// ---------- 限流（按 IP，登录/注册） ----------
const hits = new Map();
function limited(ip, kind, max, windowMs) {
  const k = `${kind}:${ip}`, t = Date.now();
  const list = (hits.get(k) || []).filter((x) => t - x < windowMs);
  list.push(t); hits.set(k, list);
  return list.length > max;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

// ---------- LiteLLM ----------
async function litellm(pathname, body) {
  if (!LITELLM_URL || !LITELLM_MASTER_KEY) throw httpError(400, "服务端没有配置 LiteLLM，只能手动填写 key");
  const r = await fetch(LITELLM_URL + pathname, {
    method: "POST", headers: { Authorization: `Bearer ${LITELLM_MASTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  if (!r.ok) throw httpError(502, `LiteLLM 返回 ${r.status}：${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
async function revokeKey(u) {
  if (u.key_source !== "litellm" || !u.key_enc) return;
  try { await litellm("/key/delete", { keys: [decrypt(u.key_enc)] }); }
  catch (e) { log(u.email, "revoke_failed", e.message); }
}

// ---------- 工具 ----------
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function send(res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store", ...headers });
  res.end(body);
}
function readBody(req, limit = 64e3) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(httpError(413, "请求太大")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); } catch { reject(httpError(400, "请求格式不对")); } });
    req.on("error", reject);
  });
}
const clientIp = (req) => String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "");
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

function auth(req, { admin = false } = {}) {
  const m = String(req.headers.authorization || "").match(/^Bearer\s+(\S+)$/);
  if (!m) throw httpError(401, "请先登录");
  const row = db.prepare("SELECT user_id, expires_at FROM tokens WHERE hash = ?").get(sha(m[1]));
  if (!row || row.expires_at < now()) throw httpError(401, "登录已过期，请重新登录");
  if (admin) { if (row.user_id !== null) throw httpError(403, "需要管理员"); return null; }
  if (row.user_id === null) throw httpError(403, "管理员令牌不能用于 App");
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  if (!u) throw httpError(401, "账号不存在");
  return { user: u, tokenHash: sha(m[1]) };
}

const STATUS_TEXT = {
  registered: "已注册。在线模型还没开通，检索、浏览、台账和本机小模型可以正常用。",
  active: "在线模型已开通。",
  suspended: "账号已停用。",
};
// 给 App 的账号信息：开通后才带上接口地址和 key
function me(u) {
  const out = {
    email: u.email, name: u.name, org: u.org, status: u.status,
    message: u.note || STATUS_TEXT[u.status] || "", created_at: u.created_at, activated_at: u.activated_at,
    provision: null,
  };
  if (u.status === "active" && u.key_enc) out.provision = { base_url: u.base_url, api_key: decrypt(u.key_enc), model: u.model };
  return out;
}
const adminView = (u) => ({
  id: u.id, email: u.email, name: u.name, org: u.org, purpose: u.purpose, status: u.status, note: u.note,
  key_source: u.key_source, base_url: u.base_url, key_tail: u.key_enc ? decrypt(u.key_enc).slice(-4) : "", model: u.model, budget: u.budget,
  created_at: u.created_at, activated_at: u.activated_at, last_seen: u.last_seen, platform: u.platform,
});

// ---------- 本机小模型文件 ----------
function modelManifest() {
  const f = path.join(LOCAL_MODEL_DIR, "manifest.json");
  if (!existsSync(f)) return null;
  const m = JSON.parse(readFileSync(f, "utf-8"));
  return { ...m, url: `${PUBLIC_URL}/v1/assets/local-model` };
}
function serveModelFile(req, res, name) {
  const m = modelManifest();
  const entry = m?.files?.find((x) => x.name === name);
  if (!entry) return send(res, 404, { error: "未找到" });
  const file = path.join(LOCAL_MODEL_DIR, entry.name);
  const size = statSync(file).size;
  const range = String(req.headers.range || "").match(/^bytes=(\d+)-(\d*)$/);
  if (range) {
    const start = Number(range[1]), end = Math.min(size - 1, range[2] ? Number(range[2]) : size - 1);
    if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { "Content-Type": "application/octet-stream", "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": size, "Accept-Ranges": "bytes" });
  createReadStream(file).pipe(res);
}

// ---------- 路由 ----------
const routes = {
  // 注册：提交即生效
  "POST /v1/register": async (req, res) => {
    if (limited(clientIp(req), "register", 10, 3600e3)) throw httpError(429, "注册太频繁，请一小时后再试");
    const b = await readBody(req);
    const email = clip(b.email, 320).toLowerCase(), pw = String(b.password || "");
    if (!EMAIL_RE.test(email)) throw httpError(400, "邮箱格式不对");
    if (pw.length < 8 || pw.length > 200) throw httpError(400, "密码至少 8 位");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw httpError(409, "这个邮箱已经注册过了，请直接登录");
    const r = db.prepare("INSERT INTO users (email, pw, name, org, purpose, created_at, last_seen, platform) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(email, hashPassword(pw), clip(b.name, 60), clip(b.org, 120), clip(b.purpose, 500), now(), now(), clip(b.platform, 20));
    log(email, "register", clip(b.platform, 20));
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(r.lastInsertRowid);
    send(res, 200, { token: newToken(u.id), account: me(u) });
  },
  "POST /v1/login": async (req, res) => {
    const ip = clientIp(req);
    if (limited(ip, "login", 20, 900e3)) throw httpError(429, "尝试次数太多，请 15 分钟后再试");
    const b = await readBody(req);
    const u = db.prepare("SELECT * FROM users WHERE email = ?").get(clip(b.email, 320).toLowerCase());
    if (!u || !checkPassword(String(b.password || ""), u.pw)) throw httpError(401, "邮箱或密码不对");
    db.prepare("UPDATE users SET last_seen = ?, platform = ? WHERE id = ?").run(now(), clip(b.platform, 20) || u.platform, u.id);
    log(u.email, "login");
    send(res, 200, { token: newToken(u.id), account: me(u) });
  },
  "GET /v1/me": async (req, res) => {
    const { user } = auth(req);
    db.prepare("UPDATE users SET last_seen = ? WHERE id = ?").run(now(), user.id);
    send(res, 200, { account: me(user) });
  },
  "POST /v1/me/profile": async (req, res) => {
    const { user } = auth(req);
    const b = await readBody(req);
    db.prepare("UPDATE users SET name = ?, org = ?, purpose = ? WHERE id = ?")
      .run(clip(b.name ?? user.name, 60), clip(b.org ?? user.org, 120), clip(b.purpose ?? user.purpose, 500), user.id);
    send(res, 200, { account: me(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)) });
  },
  "POST /v1/me/password": async (req, res) => {
    const { user, tokenHash } = auth(req);
    const b = await readBody(req);
    if (!checkPassword(String(b.old_password || ""), user.pw)) throw httpError(401, "原密码不对");
    const pw = String(b.new_password || "");
    if (pw.length < 8 || pw.length > 200) throw httpError(400, "新密码至少 8 位");
    db.prepare("UPDATE users SET pw = ? WHERE id = ?").run(hashPassword(pw), user.id);
    db.prepare("DELETE FROM tokens WHERE user_id = ? AND hash != ?").run(user.id, tokenHash); // 其他设备退出
    log(user.email, "password");
    send(res, 200, { ok: true });
  },
  "POST /v1/logout": async (req, res) => {
    const { tokenHash } = auth(req);
    db.prepare("DELETE FROM tokens WHERE hash = ?").run(tokenHash);
    send(res, 200, { ok: true });
  },
  // 删除账号（App Store 5.1.1(v)）：吊销 key，删掉账号和所有登录
  "POST /v1/me/delete": async (req, res) => {
    const { user } = auth(req);
    const b = await readBody(req);
    if (!checkPassword(String(b.password || ""), user.pw)) throw httpError(401, "密码不对");
    await revokeKey(user);
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    log(user.email, "delete_account");
    send(res, 200, { ok: true });
  },

  "GET /v1/assets/local-model/manifest": async (req, res) => {
    const m = modelManifest();
    if (!m) throw httpError(404, "服务器上还没有放本机小模型");
    send(res, 200, m);
  },

  // ---------- 管理员 ----------
  "POST /v1/admin/login": async (req, res) => {
    if (limited(clientIp(req), "admin", 10, 900e3)) throw httpError(429, "尝试次数太多，请 15 分钟后再试");
    const b = await readBody(req);
    const a = Buffer.from(String(b.password || "")), e = Buffer.from(ADMIN_PASSWORD);
    if (a.length !== e.length || !timingSafeEqual(a, e)) throw httpError(401, "密码不对");
    send(res, 200, { token: newToken(null, 7) });
  },
  "GET /v1/admin/users": async (req, res) => {
    auth(req, { admin: true });
    const users = db.prepare("SELECT * FROM users ORDER BY (status = 'registered') DESC, created_at DESC").all().map(adminView);
    send(res, 200, { users, litellm: Boolean(LITELLM_URL && LITELLM_MASTER_KEY), litellm_public_url: LITELLM_PUBLIC_URL });
  },
  "GET /v1/admin/events": async (req, res) => {
    auth(req, { admin: true });
    send(res, 200, { events: db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 200").all() });
  },
};

// /v1/admin/users/:id/(assign|revoke|suspend|resume|delete|reset-password)
async function adminUserAction(req, res, id, action) {
  auth(req, { admin: true });
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!u) throw httpError(404, "用户不存在");
  const b = await readBody(req);
  if (action === "assign") {
    let key, baseUrl, source, budget = null;
    const model = clip(b.model, 120);
    if (b.mode === "litellm") {
      if (!LITELLM_PUBLIC_URL) throw httpError(400, "服务端没有配置 LITELLM_PUBLIC_URL");
      budget = Number(b.budget) > 0 ? Number(b.budget) : null;
      const models = Array.isArray(b.models) ? b.models.map((m) => clip(m, 120)).filter(Boolean) : [];
      await revokeKey(u);
      const r = await litellm("/key/generate", {
        key_alias: `legal-${u.id}-${Date.now()}`, user_id: `legal:${u.email}`,
        ...(budget ? { max_budget: budget, budget_duration: clip(b.budget_duration, 10) || "30d" } : {}),
        ...(models.length ? { models } : {}), metadata: { app: "china-law-search", email: u.email },
      });
      key = r.key; baseUrl = LITELLM_PUBLIC_URL; source = "litellm";
    } else {
      baseUrl = clip(b.base_url, 300).replace(/\/+$/, "");
      key = clip(b.api_key, 400);
      if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(baseUrl + "/")) throw httpError(400, "接口地址要以 https:// 开头");
      if (!key) throw httpError(400, "请填写 API key");
      if (u.key_source === "litellm") await revokeKey(u);
      source = "manual";
    }
    db.prepare("UPDATE users SET status = 'active', note = '', key_source = ?, base_url = ?, key_enc = ?, model = ?, budget = ?, activated_at = ? WHERE id = ?")
      .run(source, baseUrl, encrypt(key), model, budget, now(), u.id);
    log(u.email, "assign", `${source} ${baseUrl}${model ? " " + model : ""}`);
  } else if (action === "revoke") {
    await revokeKey(u);
    db.prepare("UPDATE users SET status = 'registered', key_source = '', base_url = '', key_enc = '', model = '', budget = NULL WHERE id = ?").run(u.id);
    log(u.email, "revoke");
  } else if (action === "suspend") {
    await revokeKey(u);
    db.prepare("UPDATE users SET status = 'suspended', note = ?, key_source = '', base_url = '', key_enc = '', model = '' WHERE id = ?").run(clip(b.note, 200), u.id);
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(u.id);
    log(u.email, "suspend", clip(b.note, 200));
  } else if (action === "resume") {
    db.prepare("UPDATE users SET status = 'registered', note = '' WHERE id = ?").run(u.id);
    log(u.email, "resume");
  } else if (action === "reset-password") {
    const pw = randomBytes(6).toString("base64url");
    db.prepare("UPDATE users SET pw = ? WHERE id = ?").run(hashPassword(pw), u.id);
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(u.id);
    log(u.email, "reset_password");
    return send(res, 200, { ok: true, password: pw });
  } else if (action === "delete") {
    await revokeKey(u);
    db.prepare("DELETE FROM tokens WHERE user_id = ?").run(u.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    log(u.email, "admin_delete");
    return send(res, 200, { ok: true });
  } else throw httpError(404, "未知操作");
  send(res, 200, { user: adminView(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id)) });
}

const STATIC = { "/admin": "admin.html", "/admin/": "admin.html", "/privacy": "privacy.html", "/support": "support.html" };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "GET" && STATIC[p]) {
      const body = readFileSync(path.join(HERE, STATIC[p]));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
      return res.end(body);
    }
    if (req.method === "GET" && p === "/healthz") return send(res, 200, { ok: true });
    if (req.method === "GET" && p.startsWith("/v1/assets/local-model/") && p !== "/v1/assets/local-model/manifest")
      return serveModelFile(req, res, decodeURIComponent(p.slice("/v1/assets/local-model/".length)));
    const m = p.match(/^\/v1\/admin\/users\/(\d+)\/([a-z-]+)$/);
    if (req.method === "POST" && m) return await adminUserAction(req, res, Number(m[1]), m[2]);
    const route = routes[`${req.method} ${p}`];
    if (!route) return send(res, 404, { error: "未找到" });
    await route(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "服务器出错了" });
  }
});

// 过期令牌每天清一次
setInterval(() => db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(now()), 864e5).unref();

server.listen(PORT, HOST, () => {
  console.log(`账号服务已启动：http://${HOST}:${PORT}  （后台 /admin，管理员密码在 ${path.join(DATA_DIR, "admin-password.txt")}）`);
});
