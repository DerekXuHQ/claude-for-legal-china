// 资料库检索工具和带工具的多轮回答循环。任务分流、追问、合同审查流程在 ask.mjs。
import * as search from "../search.mjs";
import { stream, complete } from "./models.mjs";

export const SYSTEM_PROMPT = `你是一名经验丰富的中国大陆执业律师助理，服务对象是企业老板、HR、企业法务和个人。用户把你当作随时可以请教的专业顾问：他们要的是能直接拿去用的判断、依据和下一步，而不是泛泛的摘要。只处理中国大陆法律；涉及港澳台或境外法律时指出这一点，只就大陆法部分作答。

## 怎么工作
1. **先想清楚这是什么事。** 用户真正要解决的问题是什么（判断合法性、应对索赔、决定要不要起诉、改合同……）？涉及哪些法律关系、哪一方、哪个地区、哪个时间点（行为发生时适用的法律版本）？下面的「本次任务」给了这类事的专业做法，照着走。
2. **用资料库检索，按效力层级找依据：** 法律 → 司法解释 → 行政法规、部门规章 → 用户所在地的地方性法规 → 最高法指导性案例 → 办案指引。检索词换几种说法（例如「解除劳动合同」「辞退」「经济补偿」）。关键条文一定读原文（read_articles），不要只看检索摘要。
3. **只依据查到的原文下结论。** 资料库里没有、或你没读到原文的规定，不能当作已确认的依据；确有必要提到，写明「资料库中未检索到，需另行核实」。不要编造条号、金额、比例、期限。每个结论都要有条文真正支撑，不要把不相干的条文挂在结论后面。
4. **注意效力和版本：** 区分现行有效、旧版本、尚未生效（例如商标法 2026 年修订版 2027-01-01 才施行）。上位法优先，特别规定优先，新法优先；地方性法规只在对应地区适用。行为发生在新法施行前的，按当时的法律判断并说明。
5. **案例的效力：** 指导性案例带有 status「不再参照」的，不能作为裁判参照依据，最多作为背景说明并写明已不再参照。
6. **像律师一样把事情想全：** 用户没问但会直接影响结果的风险、期限、证据要求、程序要件、对方可能的抗辩，都要指出来。对方的主张合理的地方，直说。
7. **事实不清时：** 能根据常理合理假设的，写明假设并据此分析；结论取决于某个关键事实的，分情况给结论（「如果……则……；如果……则……」），并在最后列出需要补充的材料。

## 引用格式（必须遵守）
引用资料时，在句末用双方括号写上检索结果里给出的编号，界面会把它变成可点击的原文链接：
- 条文：[[art:编号]]，例如 [[art:593cdcfe417d6650:第一条]]
- 法规整体：[[law:编号]]
- 指导性案例：[[case:编号]]，例如 [[case:GC279]]
- 办案指引：[[ref:编号]]
编号必须原样复制工具返回的 id，不能编造。正文提到法条时写全称和条号，例如「《劳动合同法》第四十七条」。

## 输出
- 结论先行：第一段直接回答（能 / 不能、合法 / 违法、合理 / 不合理、大概多少钱、风险高低），一两句话说清理由。
- 然后按「本次任务」给的输出结构展开；没有给结构时用：结论 → 适用的规定 → 分析（含不适用或需要排除的规定）→ 相关案例 → 下一步怎么做（含期限）→ 需要补充的材料 → 什么情况下应当请律师。
- 金额、期限要给出计算过程和起算点。表格能说清楚的用表格。
- 用简洁的中文书面语，不寒暄，不表演个性，不反复声明「不构成法律意见」（界面已有统一提示）。`;

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
      return J(c ? { ...pick(c, ["id", "title", "keywords", "points", "laws", "facts", "result", "reasoning", "url"]), ...(c.note ? { status: c.note } : {}) } : { error: "未找到该案例" });
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

export { stepText };

const TOOL_DEFS = () => TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

// 分析深度：检索轮数和推理强度
export const DEPTH = {
  low: { steps: 8, effort: "low", note: "\n\n## 本次要求\n快速作答：检索两到四次即可，回答精简，只写最关键的规定、结论和下一步。" },
  medium: { steps: 16, effort: "medium", note: "" },
  high: { steps: 26, effort: "high", note: "\n\n## 本次要求\n深入分析：多换几种检索词，逐条读原文、核对版本和施行日期，覆盖例外情形、地方差异和相关案例，回答写完整。" },
};

/**
 * 带工具的多轮检索与回答。stream 为 true 时把文字增量推给 emit。
 * @returns {Promise<{messages: object[], text: string}>}
 */
export async function runAgent(settings, { model, effort, system, messages, steps = 16, emit = () => {}, signal, stream: doStream = true, label = "" }) {
  const msgs = [{ role: "system", content: system }, ...messages];
  const tools = TOOL_DEFS();
  for (let step = 0; step < steps; step++) {
    let turn;
    if (doStream) {
      turn = await stream(settings, { model, messages: msgs, effort, tools, signal, onText: (delta) => emit({ type: "text", delta }) });
    } else {
      const r = await complete(settings, { model, messages: msgs, effort, tools, signal });
      const m = r.choices?.[0]?.message || {};
      turn = { content: m.content || "", calls: m.tool_calls || [] };
    }
    msgs.push({ role: "assistant", content: turn.content || "", ...(turn.calls.length ? { tool_calls: turn.calls } : {}) });
    if (!turn.calls.length) return { messages: msgs.slice(1), text: turn.content || "" };
    for (const c of turn.calls) {
      let args = null;
      try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* 交给 runTool 报错 */ }
      emit({ type: "step", text: (label ? label + " · " : "") + stepText(c.function.name, args) });
      let content;
      try { content = runTool(c.function.name, args); } catch (e) { content = JSON.stringify({ error: String(e.message || e) }); }
      msgs.push({ role: "tool", tool_call_id: c.id, content });
    }
    if (doStream) emit({ type: "text_reset" });
  }
  // 步数用完：要求直接根据已有资料作答
  msgs.push({ role: "user", content: "检索次数已到上限。请不要再调用工具，直接根据已经查到的资料给出完整回答；没查到的部分明确说明。" });
  const r = doStream
    ? await stream(settings, { model, messages: msgs, effort, signal, onText: (delta) => emit({ type: "text", delta }) })
    : { content: (await complete(settings, { model, messages: msgs, effort, signal })).choices?.[0]?.message?.content || "" };
  msgs.push({ role: "assistant", content: r.content || "" });
  return { messages: msgs.slice(1), text: r.content || "" };
}
