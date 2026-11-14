// 账号：邮箱注册即生效；管理员开通后，账号服务把接口地址和 API key 发到本机。
// 账号不是必需的：检索、浏览、事项、台账和本机小模型不登录也能用。
// 账号服务的代码在 app/account-server/（单独部署，不随 App 打包）。

export const ACCOUNT_SERVER = "https://legal.portkey.bond";
export const LOCAL_MODEL_ID = "本机小模型";

// 本机保存的账号字段（都在 settings.json 里，文件权限 0600）
export const ACCOUNT_DEFAULTS = { account_server: "", account_token: "", account: null, model_source: "auto" };

/**
 * 把保存的设置换算成实际调用模型用的设置。
 * model_source：auto（有账号开通的 key 就用，否则用自己填的）/ account / custom / local
 */
export function effectiveSettings(raw, { localAvailable = false } = {}) {
  const s = { ...raw };
  const prov = raw.account?.status === "active" ? raw.account.provision : null;
  const src = raw.model_source || "auto";
  s.source = "none";
  if (s.model === LOCAL_MODEL_ID) s.model = ""; // 旧设置：本机小模型不作为在线模型
  if ((src === "account" || src === "auto") && prov?.api_key) {
    Object.assign(s, { base_url: prov.base_url, api_key: prov.api_key, source: "account" });
    if (!s.model && prov.model) s.model = prov.model;
  } else if ((src === "custom" || src === "auto") && raw.api_key) {
    s.source = "custom";
  } else {
    s.api_key = "";
  }
  if (src === "local" || (s.source === "none" && localAvailable)) {
    if (src === "local") s.api_key = "";
    if (localAvailable) { s.source = "local"; s.model = LOCAL_MODEL_ID; }
  }
  return s;
}

function server(raw) { return (raw.account_server || ACCOUNT_SERVER).replace(/\/+$/, ""); }

async function call(raw, method, path, body, { token = raw.account_token } = {}) {
  let r;
  try {
    r = await fetch(server(raw) + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
  } catch {
    const e = new Error("连不上账号服务，请检查网络后再试"); e.offline = true; throw e;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `账号服务出错（${r.status}）`); e.status = r.status; throw e; }
  return j;
}

// 给界面看的账号信息：不带 key
export function publicAccount(raw) {
  const a = raw.account;
  return {
    signed_in: Boolean(raw.account_token && a),
    email: a?.email || "", name: a?.name || "", org: a?.org || "",
    status: a?.status || "", message: a?.message || "",
    online: Boolean(a?.status === "active" && a?.provision?.api_key),
    model: a?.provision?.model || "",
    model_source: raw.model_source || "auto",
    has_custom_key: Boolean(raw.api_key),
    server: server(raw),
  };
}

/**
 * 账号相关的本地接口。返回 true 表示已处理。
 * ctx: { loadRaw, saveRaw, send, readBody, platform, onChange }
 */
export async function handleAccount(req, res, p, ctx) {
  const { loadRaw, saveRaw, send, readBody, platform } = ctx;
  const fail = (err) => send(res, err.status && err.status < 500 ? 400 : 502, { error: err.message, offline: !!err.offline });
  const signOut = () => saveRaw({ account_token: "", account: null });

  if (req.method === "GET" && p === "/api/account") {
    let raw = loadRaw();
    const url = new URL(req.url, "http://x");
    if (url.searchParams.get("refresh") === "1" && raw.account_token) {
      try {
        const { account } = await call(raw, "GET", "/v1/me");
        raw = saveRaw({ account });
        ctx.onChange?.();
      } catch (err) {
        if (err.status === 401) { raw = signOut(); ctx.onChange?.(); return send(res, 200, { ...publicAccount(raw), notice: err.message }); }
        return send(res, 200, { ...publicAccount(raw), notice: err.offline ? "离线：显示的是上次同步的状态" : err.message });
      }
    }
    return send(res, 200, publicAccount(raw));
  }
  if (req.method !== "POST" || !p.startsWith("/api/account/")) return false;
  const b = await readBody(req);
  const raw = loadRaw();
  try {
    if (p === "/api/account/register" || p === "/api/account/login") {
      const path = p.endsWith("register") ? "/v1/register" : "/v1/login";
      const r = await call(raw, "POST", path, {
        email: String(b.email || "").trim(), password: String(b.password || ""),
        name: b.name, org: b.org, purpose: b.purpose, platform,
      }, { token: "" });
      const saved = saveRaw({ account_token: r.token, account: r.account });
      ctx.onChange?.();
      return send(res, 200, publicAccount(saved));
    }
    if (p === "/api/account/logout") {
      if (raw.account_token) await call(raw, "POST", "/v1/logout", {}).catch(() => {});
      const saved = signOut(); ctx.onChange?.();
      return send(res, 200, publicAccount(saved));
    }
    if (p === "/api/account/profile") {
      const { account } = await call(raw, "POST", "/v1/me/profile", { name: b.name, org: b.org, purpose: b.purpose });
      return send(res, 200, publicAccount(saveRaw({ account })));
    }
    if (p === "/api/account/password") {
      await call(raw, "POST", "/v1/me/password", { old_password: b.old_password, new_password: b.new_password });
      return send(res, 200, { ok: true });
    }
    if (p === "/api/account/delete") {
      await call(raw, "POST", "/v1/me/delete", { password: b.password });
      const saved = saveRaw({ account_token: "", account: null, model_source: raw.model_source === "account" ? "auto" : raw.model_source });
      ctx.onChange?.();
      return send(res, 200, publicAccount(saved));
    }
    if (p === "/api/account/source") {
      const src = ["auto", "account", "custom", "local"].includes(b.model_source) ? b.model_source : "auto";
      const saved = saveRaw({ model_source: src }); ctx.onChange?.();
      return send(res, 200, publicAccount(saved));
    }
  } catch (err) {
    if (err.status === 401 && raw.account_token && !p.endsWith("login") && !p.endsWith("register") && !p.endsWith("delete") && !p.endsWith("password")) { signOut(); ctx.onChange?.(); }
    return fail(err);
  }
  return send(res, 404, { error: "未找到" });
}
