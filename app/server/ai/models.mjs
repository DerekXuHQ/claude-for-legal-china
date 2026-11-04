// 模型调用：OpenAI 兼容接口（默认 Portkey）。负责客户端、推理强度、复核模型的选择和 JSON 输出的解析。
import OpenAI from "openai";

export const DEFAULT_BASE_URL = "https://api.portkey.bond/v1";

export function client(settings) {
  return new OpenAI({ apiKey: settings.api_key || "none", baseURL: settings.base_url || DEFAULT_BASE_URL, maxRetries: 2, timeout: 600000 });
}

export async function listModels(settings, signal) {
  const ids = [];
  for await (const m of client(settings).models.list({ signal })) ids.push(m.id);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

// 不支持 reasoning_effort 的模型，本次运行内记住，不再发送
const noEffort = new Set();

/**
 * 一次对话补全。内部也用流式：网关（Cloudflare）会掐断 3 分钟没有数据返回的连接，
 * 长回答用非流式会超时（504）。返回值与非流式接口的格式一致。
 */
export async function complete(settings, { model, messages, effort, tools, signal }) {
  const r = await stream(settings, { model, messages, effort, tools, signal });
  return { choices: [{ message: { role: "assistant", content: r.content, ...(r.calls.length ? { tool_calls: r.calls } : {}) } }] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryable = (err) => !err?.status || err.status === 429 || err.status >= 500;

/**
 * 流式补全：文字增量通过 onText 推出；返回完整文字和工具调用。
 * 网关断开、超时、5xx、429 时自动重试（最多 3 次）；重试前通过 onReset 让调用方清掉已经推出的半截文字。
 */
export async function stream(settings, opts) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await streamOnce(settings, opts);
    } catch (err) {
      if (opts.signal?.aborted || attempt >= 3 || !retryable(err)) throw err;
      opts.onReset?.();
      await sleep([2000, 6000, 15000][attempt]);
    }
  }
}

async function streamOnce(settings, { model, messages, effort, tools, signal, onText }) {
  const api = client(settings);
  const params = { model, messages, stream: true, ...(tools ? { tools } : {}) };
  if (effort && !noEffort.has(model)) params.reasoning_effort = effort;
  let s;
  try {
    s = await api.chat.completions.create(params, { signal });
  } catch (err) {
    if (params.reasoning_effort && err?.status === 400 && !signal?.aborted) {
      noEffort.add(model);
      delete params.reasoning_effort;
      s = await api.chat.completions.create(params, { signal });
    } else throw err;
  }
  let content = "";
  const calls = [];
  for await (const chunk of s) {
    const d = chunk.choices?.[0]?.delta;
    if (!d) continue;
    if (d.content) { content += d.content; onText?.(d.content); }
    for (const tc of d.tool_calls || []) {
      const c = (calls[tc.index ?? 0] ||= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.function.name += tc.function.name;
      if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
    }
  }
  return { content, calls: calls.filter(Boolean) };
}

/** 从模型输出里取出 JSON（允许包在 ```json 代码块里，或前后有说明文字）。 */
export function parseJSON(text) {
  if (!text) throw new Error("模型没有返回内容");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("模型输出里没有 JSON");
  const open = body[start], close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  return JSON.parse(body.slice(start, end + 1));
}

/** 要求模型返回 JSON；解析失败时把错误交回模型重试一次。 */
export async function completeJSON(settings, { model, system, user, effort = "low", signal }) {
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await complete(settings, { model, messages, effort, signal });
    const text = r.choices?.[0]?.message?.content || "";
    try {
      return parseJSON(text);
    } catch (err) {
      messages.push({ role: "assistant", content: text }, { role: "user", content: `上面的输出不是合法 JSON（${err.message}）。只输出 JSON，不要其他文字。` });
    }
  }
  throw new Error("模型没有按要求返回 JSON");
}

const family = (m) => (/^claude/i.test(m) ? "claude" : /^gpt|^o\d/i.test(m) ? "gpt" : /deepseek/i.test(m) ? "deepseek" : m.split(/[/-]/)[0]);

/** 复核模型：设置里指定的优先；否则从可用模型里选另一家族的强模型。 */
export function pickReviewModel(settings, mainModel, available = []) {
  if (settings.review_model && settings.review_model !== "auto") return settings.review_model;
  const prefs = family(mainModel) === "claude"
    ? ["gpt-6-astra", "gpt-6-luna", "gpt-5.5", "deepseek-v4-pro"]
    : ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5", "gpt-6-astra", "deepseek-v4-pro"];
  return prefs.find((m) => available.includes(m) && family(m) !== family(mainModel)) || prefs.find((m) => available.includes(m)) || mainModel;
}
