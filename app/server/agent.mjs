// AI 检索代理：在本地资料库里多轮检索，然后按固定结构给出参考意见。
//
// 两种接口：
// - anthropic：Anthropic 官方 SDK。可改接口地址和附加请求头，因此也能经 Portkey 等网关调用 Claude。
// - openai：OpenAI 兼容接口（DeepSeek、Portkey 的 OpenAI 路由等）。
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import * as search from "./search.mjs";

const MAX_STEPS = 14;

export const SYSTEM_PROMPT = `你是一个中国大陆法律检索与分析工具，用户把你当作参考用的法律智囊。你的任务：理解问题，在本地资料库里多轮检索，给出清楚、具体、可追溯的参考意见。只处理中国大陆法律；问题涉及港澳台或境外法律时，指出这一点，只就大陆法部分作答。

## 工作方法
1. 先拆解问题：涉及哪些法律关系、哪个地区、哪个时间点、用户想解决什么。
2. 多轮检索：先找全国性法律和司法解释，再看行政法规和用户所在地区的地方性法规；需要时看法规目录、读原文条文；查找相关的最高法指导性案例；查找实务要点和处理流程。检索词换几种说法（例如「解除劳动合同」「辞退」「经济补偿」）。
3. 只依据检索到的资料下结论。资料库里没有、或你没有读到原文的规定，不要当作已确认的依据；确有必要提到时，明确写「资料库中未检索到，需另行核实」。
4. 注意效力和版本：区分现行有效、旧版本、尚未生效（例如商标法 2026 年修订版 2027-01-01 才施行，在此之前仍适用 2019 年修正版）。上位法优先，特别规定优先，地方性法规只在对应地区适用。检索结果里标了「官方全文」的，是从中国人大网、国家行政法规库、最高人民法院网站核对过的文本。

## 引用格式（必须遵守）
每次引用资料，都在句末用双方括号写上检索结果里给出的编号，界面会把它变成可点击的链接：
- 条文：[[art:编号]]，例如 [[art:593cdcfe417d6650:第一条]]
- 法规整体：[[law:编号]]
- 指导性案例：[[case:编号]]，例如 [[case:GC279]]
- 实务要点或处理流程：[[ref:编号]]
编号必须原样复制工具返回的 id，不能编造。

## 回答结构（Markdown，按需省略空的部分）
## 结论摘要
用三五句话直接回答问题，给出你的判断。

## 适用的规定
逐条列出适用的条文：写明法规名称和条号、它说了什么、为什么适用于本案情形，附引用。

## 不适用或需要排除的规定
用户可能以为适用、但实际不适用或需要区分的规定，说明理由。

## 相关案例
相关的指导性案例及其裁判要点对本问题的意义。没有就写「未检索到直接相关的指导性案例」。

## 建议的处理流程
按步骤写出实际怎么做：先做什么、准备哪些材料、注意哪些期限和程序。

## 建议
你的具体建议和风险提示，包括对用户最有利的做法和需要避免的做法。

## 可以向律师确认的问题
三到五个值得拿去问执业律师的具体问题。

## 写作要求
- 用简洁的中文直接给出意见，不要寒暄，不要表演个性。
- 不需要反复声明「这不构成法律意见」「我不是律师」，界面已有统一提示。
- 用户没说地区时，先按全国性规定回答，并指出哪些地方会因地区不同而变化。
- 金额、期限、比例等数字以检索到的条文为准；条文没写的，不要自己编。`;

export const TOOLS = [
  {
    name: "search_law",
    description: "全文检索法律法规条文（法律、司法解释、行政法规、监察法规、地方性法规）。返回条文编号、法规名称、条号、效力状态和摘要。检索词用两个以上关键词效果更好，例如「劳动合同 解除 经济补偿」。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索词，空格分隔多个关键词" },
        level: { type: "string", enum: ["", "法律", "司法解释", "行政法规", "监察法规", "地方性法规"], description: "效力层级，留空不限" },
        province: { type: "string", description: "地区，例如「广东省」「上海市」；填「全国」只看全国性规定；留空不限" },
        include_old: { type: "boolean", description: "是否包含旧版本和失效规定，默认 false" },
        limit: { type: "integer", description: "返回条数，默认 10，最多 25" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_law_by_title",
    description: "按名称查找法规，例如「劳动合同法」「商标法」。返回法规编号、效力状态、版本日期、施行日期，以及是否已与官方全文核对。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "法规名称或名称中的关键词" },
        include_old: { type: "boolean", description: "是否包含旧版本，默认 false" },
      },
      required: ["title"],
    },
  },
  {
    name: "law_outline",
    description: "查看一部法规的目录：不填 chapter 返回各章及条号范围；填 chapter（章名中的关键词）返回该章每条的开头和条文编号。",
    input_schema: {
      type: "object",
      properties: {
        law_id: { type: "string", description: "法规编号（find_law_by_title 或 search_law 返回的 doc_id）" },
        chapter: { type: "string", description: "章名关键词，可选" },
      },
      required: ["law_id"],
    },
  },
  {
    name: "read_articles",
    description: "读取条文全文。一次最多 20 条。",
    input_schema: {
      type: "object",
      properties: { article_ids: { type: "array", items: { type: "string" }, description: "条文编号列表" } },
      required: ["article_ids"],
    },
  },
  {
    name: "compare_versions",
    description: "对比同一法规的两个版本，返回修改、新增、删除的条文。用于回答「新法改了什么」「哪个版本适用」。",
    input_schema: {
      type: "object",
      properties: {
        law_id: { type: "string", description: "一个版本的法规编号" },
        other_law_id: { type: "string", description: "另一个版本的法规编号（find_law_by_title 加 include_old 可查到）" },
      },
      required: ["law_id", "other_law_id"],
    },
  },
  {
    name: "search_cases",
    description: "检索最高人民法院指导性案例，返回案例编号、标题、关键词和裁判要点摘要。",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", description: "默认 8" } },
      required: ["query"],
    },
  },
  {
    name: "read_case",
    description: "读取指导性案例的关键词、裁判要点、相关法条、基本案情、裁判结果和裁判理由。",
    input_schema: { type: "object", properties: { case_id: { type: "string" } }, required: ["case_id"] },
  },
  {
    name: "search_guides",
    description: "检索实务要点和处理流程（律师工作方法、审查清单、期限计算、文书结构等），用于写「建议的处理流程」。返回编号和摘要，需要细节时用 read_guide。",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", description: "默认 6" } },
      required: ["query"],
    },
  },
  {
    name: "read_guide",
    description: "读取一段实务要点或处理流程的全文。",
    input_schema: { type: "object", properties: { guide_id: { type: "string" } }, required: ["guide_id"] },
  },
];

const STEP_LABEL = {
  search_law: "检索条文", find_law_by_title: "查找法规", law_outline: "查看目录", read_articles: "阅读条文", compare_versions: "对比版本",
  search_cases: "检索案例", read_case: "阅读案例", search_guides: "检索实务资料", read_guide: "阅读实务资料",
};

const str = (v, d = "") => (typeof v === "string" ? v : d);
const int = (v, d, hi) => (Number.isInteger(v) ? Math.max(1, Math.min(v, hi)) : d);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/** 执行工具。参数来自模型输出，逐项校验类型；出错时抛异常，由调用方作为错误结果交回模型。 */
export function runTool(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("参数必须是对象");
  const J = (v) => JSON.stringify(v);
  switch (name) {
    case "search_law": {
      const q = str(args.query);
      if (!q) throw new Error("query 不能为空");
      return J(search.searchArticles(q, { level: str(args.level), province: str(args.province), current_only: args.include_old !== true, limit: int(args.limit, 10, 25) }).items);
    }
    case "find_law_by_title": {
      const t = str(args.title);
      if (!t) throw new Error("title 不能为空");
      const items = search.searchLaws(t, { current_only: args.include_old !== true, limit: 12 }).items;
      return J(items.map((i) => ({ ...pick(i, ["doc_id", "title", "level", "status", "province", "version_date", "n_articles"]), official_text: i.official })));
    }
    case "law_outline":
      return J(search.outline(str(args.law_id), str(args.chapter)) || { error: "未找到该法规" });
    case "read_articles": {
      const ids = args.article_ids;
      if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string")) throw new Error("article_ids 必须是字符串列表");
      return J(ids.slice(0, 20).map((i) => {
        const a = search.getArticle(i);
        return a ? { ...pick(a, ["id", "title", "article", "chapter", "text", "level", "status", "province", "effective_date", "note"]), official_text: a.official } : { id: i, error: "未找到" };
      }));
    }
    case "compare_versions": {
      const r = search.compareVersions(str(args.law_id), str(args.other_law_id));
      if (!r) return J({ error: "未找到其中一个版本" });
      const cut = (s) => (s || "").slice(0, 400);
      const d = r.diff;
      return J({
        new: r.new, old: r.old, unchanged: d.unchanged, renumbered: d.renumbered,
        modified: d.modified.slice(0, 40).map((m) => ({ old_cn: m.old_cn, new_cn: m.new_cn, new_id: m.new_id, old: cut(m.old), new: cut(m.new) })),
        added: d.added.slice(0, 30).map((m) => ({ new_cn: m.new_cn, new_id: m.new_id, new: cut(m.new) })),
        removed: d.removed.slice(0, 30).map((m) => ({ old_cn: m.old_cn, old_id: m.old_id, old: cut(m.old) })),
      });
    }
    case "search_cases":
      return J(search.searchCases(str(args.query), { limit: int(args.limit, 8, 15) }).items);
    case "read_case": {
      const c = search.getCase(str(args.case_id));
      return J(c ? pick(c, ["id", "title", "keywords", "points", "laws", "facts", "result", "reasoning", "url"]) : { error: "未找到该案例" });
    }
    case "search_guides":
      return J(search.searchRefs(str(args.query), { limit: int(args.limit, 6, 12) }).items);
    case "read_guide": {
      const r = search.getRef(str(args.guide_id));
      return J(r ? { id: r.id, title: r.title, heading: r.heading, text: r.text.slice(0, 12000) } : { error: "未找到" });
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

function stepText(name, args) {
  const label = STEP_LABEL[name] || name;
  args = args && typeof args === "object" ? args : {};
  let detail = str(args.query) || str(args.title) || str(args.law_id) || str(args.case_id) || str(args.guide_id);
  if (name === "read_articles" && Array.isArray(args.article_ids)) detail = `${args.article_ids.length} 条`;
  if (typeof args.province === "string" && args.province) detail += `（${args.province}）`;
  return detail ? `${label}：${detail}` : label;
}

const userText = (q, region) => (region ? `[用户所在或关注的地区：${region}]\n\n${q}` : q);
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

/* ---------------- Anthropic ---------------- */

async function runAnthropic(settings, history, question, region, emit, signal) {
  const client = new Anthropic({
    apiKey: settings.api_key || null,
    // 留空时显式用官方地址，避免被环境变量 ANTHROPIC_BASE_URL 意外改写
    baseURL: settings.base_url || "https://api.anthropic.com",
    defaultHeaders: settings.extra_headers && Object.keys(settings.extra_headers).length ? settings.extra_headers : undefined,
  });
  const model = settings.model || "claude-opus-5-5";
  // 服务端拒答回退只在直连 Anthropic 且模型支持时开启
  const useFallback = settings.fallback !== false && !settings.base_url && FALLBACK_MODELS.has(model);
  const tools = TOOLS.map((t) => ({ ...t, eager_input_streaming: true }));
  const messages = [...history, { role: "user", content: userText(question, region) }];
  const base = {
    model, max_tokens: 64000, system: SYSTEM_PROMPT, tools, messages,
    cache_control: { type: "ephemeral" }, output_config: { effort: settings.effort || "medium" },
  };
  let jsonRetries = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = useFallback
      ? client.beta.messages.stream({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
      : client.messages.stream(base, { signal });
    stream.on("text", (delta) => emit({ type: "text", delta }));
    let msg;
    try {
      msg = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // 只有工具参数 JSON 完全无法解析时才重发本轮；接口错误直接抛出
      if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw err;
      emit({ type: "text_reset" });
      continue;
    }
    if (msg.stop_reason === "refusal") {
      emit({ type: "error", message: "模型拒绝回答这个问题。可以换一种问法再试。" });
      return messages;
    }
    messages.push({ role: "assistant", content: msg.content });
    if (msg.stop_reason === "pause_turn") continue;
    const uses = msg.content.filter((b) => b.type === "tool_use");
    if (!uses.length) return messages;
    if (msg.stop_reason === "max_tokens") {
      emit({ type: "error", message: "输出被截断，请缩小问题范围后重试。" });
      messages.pop();
      return messages;
    }
    const results = uses.map((b) => {
      emit({ type: "step", text: stepText(b.name, b.input) });
      try {
        return { type: "tool_result", tool_use_id: b.id, content: runTool(b.name, b.input) };
      } catch (e) {
        // 参数有误时把错误交回模型，让它修正后重试
        return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify({ error: String(e.message || e) }), is_error: true };
      }
    });
    messages.push({ role: "user", content: results });
    emit({ type: "text_reset" });
  }
  emit({ type: "error", message: "检索步骤过多，已停止。可以把问题拆小一点再问。" });
  return messages;
}

/* ---------------- OpenAI 兼容 ---------------- */

async function runOpenAI(settings, history, question, region, emit, signal) {
  const client = new OpenAI({
    apiKey: settings.api_key || "none",
    baseURL: settings.base_url || undefined,
    defaultHeaders: settings.extra_headers && Object.keys(settings.extra_headers).length ? settings.extra_headers : undefined,
  });
  const tools = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history, { role: "user", content: userText(question, region) }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await client.chat.completions.create({ model: settings.model, messages, tools }, { signal });
    const msg = resp.choices[0].message;
    const calls = msg.tool_calls || [];
    messages.push({ role: "assistant", content: msg.content || "", ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      emit({ type: "text", delta: msg.content || "" });
      return messages.slice(1);
    }
    for (const c of calls) {
      let args = null;
      try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* 交给 runTool 报错 */ }
      emit({ type: "step", text: stepText(c.function.name, args) });
      let content;
      try { content = runTool(c.function.name, args); } catch (e) { content = JSON.stringify({ error: String(e.message || e) }); }
      messages.push({ role: "tool", tool_call_id: c.id, content });
    }
  }
  emit({ type: "error", message: "检索步骤过多，已停止。可以把问题拆小一点再问。" });
  return messages.slice(1);
}

export function ask(settings, history, question, region, emit, signal) {
  return settings.provider === "openai"
    ? runOpenAI(settings, history, question, region, emit, signal)
    : runAnthropic(settings, history, question, region, emit, signal);
}
