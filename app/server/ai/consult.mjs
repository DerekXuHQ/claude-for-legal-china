// 咨询类任务的「先研究、再写、再按原文核对」流程（候选方案，靠评测决定是否替换单个检索代理）。
// ① 两个研究员并行检索（一个找法律、司法解释、行政法规；一个找地方规定、案例、程序与期限、实务做法），
//    只交回条文编号和用途，原文由程序从资料库取，不经模型转述；
// ② 写作者拿着依据原文和任务手册写答复（不再检索，专心分析）；
// ③ 核对员逐句对照依据原文：引用的条文是否真的支持结论、金额期限算得对不对、研究员列出的争点有没有漏；
// ④ 有问题就按核对意见改一遍，没问题直接给出。
import { runAgent, SYSTEM_PROMPT } from "./agent.mjs";
import { completeJSON, stream, parseJSON } from "./models.mjs";
import * as search from "../search.mjs";

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "……" : s || "");

const RESEARCHERS = [
  {
    label: "法条研究",
    brief: "找出处理这件事要用的**法律、司法解释、行政法规**条文：请求权或责任的基础、构成要件、例外和抗辩、计算标准、程序与时效。换几种检索词，读原文确认现行有效、适用于本案时间点。",
  },
  {
    label: "实务研究",
    brief: "找出处理这件事要用的**地方性法规（用户所在地）、指导性案例、实务指引**，以及程序、期限、证据方面的规定（仲裁/诉讼时效、举证、前置程序、管辖）。注意案例状态（不再参照的不能作依据）。",
  },
];

async function research(settings, { model, r, content, signal, emit }) {
  const { text } = await runAgent(settings, {
    model, effort: "medium", steps: 12, stream: false, signal, label: r.label,
    emit: (ev) => ev.type === "step" && emit(ev),
    system: `${SYSTEM_PROMPT}\n\n## 你现在的角色：研究员（${r.label}）\n你不写答复，只做检索。${r.brief}\n\n最后只输出 JSON：\n{"issues": ["这件事必须分析的争点或要件（每条一句话）"], "facts_needed": ["会改变结论、但用户没说的事实"], "sources": [{"id": "检索工具返回的条文/案例/指引编号，原样照抄", "point": "这条用来说明什么（二十字以内）"}]}\nsources 只列你读过原文、确实相关的，8 到 20 条。`,
    messages: [{ role: "user", content }],
  });
  try { return parseJSON(text); } catch { return { issues: [], facts_needed: [], sources: [] }; }
}

/** 编号 → 原文。条文、案例、指引都从资料库取，不用模型的转述。 */
function resolveSources(list) {
  const out = [], seen = new Set();
  for (const s of list) {
    const id = typeof s?.id === "string" ? s.id.replace(/^(art|case|ref|law):/, "") : "";
    if (!id || seen.has(id)) continue;
    let item = null;
    const a = search.getArticle(id);
    if (a) item = { ref: `art:${a.id}`, head: `《${a.title}》${a.article}${a.status && a.status !== "现行有效" ? `（${a.status}）` : ""}${a.province ? `〔${a.province}〕` : ""}`, text: clip(a.text, 900) };
    if (!item) { const c = search.getCase(id); if (c) item = { ref: `case:${c.id}`, head: `指导性案例：${c.title}${c.note ? `（${c.note}）` : ""}`, text: clip(`裁判要点：${c.points || ""}`, 700) }; }
    if (!item) { const g = search.getRef(id); if (g) item = { ref: `ref:${g.id}`, head: `办案指引：${g.title}${g.heading ? " · " + g.heading : ""}`, text: clip(g.text, 900) }; }
    if (!item) continue;
    seen.add(id);
    out.push({ ...item, point: String(s.point || "") });
  }
  return out;
}

export async function runConsult(settings, { model, system, content, history = [], emit, signal }) {
  // ① 并行研究
  emit({ type: "stage", text: "两位研究员分头检索：法条 / 地方规定、案例与程序" });
  const found = await Promise.all(RESEARCHERS.map((r) => research(settings, { model, r, content, signal, emit }).catch((err) => {
    if (signal?.aborted) throw err;
    emit({ type: "stage", text: `${r.label}出错，继续：${String(err.message || err).slice(0, 80)}` });
    return { issues: [], facts_needed: [], sources: [] };
  })));
  const issues = [...new Set(found.flatMap((f) => (Array.isArray(f.issues) ? f.issues : [])).filter((x) => typeof x === "string"))];
  const factsNeeded = [...new Set(found.flatMap((f) => (Array.isArray(f.facts_needed) ? f.facts_needed : [])).filter((x) => typeof x === "string"))];
  const sources = resolveSources(found.flatMap((f) => (Array.isArray(f.sources) ? f.sources : [])));
  emit({ type: "stage", text: `找到 ${sources.length} 条依据、${issues.length} 个争点，开始写答复` });
  const pack = sources.length
    ? sources.map((s) => `[[${s.ref}]] ${s.head}（${s.point}）\n${s.text}`).join("\n\n")
    : "（研究员没有查到依据原文。只写你确定的法规名称和条号，并标明「资料库中未检索到，需另行核实」。）";
  const dossier = `## 研究员整理的依据（原文，引用时把 [[...]] 原样照抄到句末）\n${pack}\n\n## 研究员列出的争点\n${issues.map((x) => "- " + x).join("\n") || "（无）"}\n\n## 会改变结论的未知事实\n${factsNeeded.map((x) => "- " + x).join("\n") || "（无）"}`;

  // ② 写初稿
  const writerSystem = `${system}\n\n## 你现在的角色：主办律师助理\n研究员已经把依据原文查好放在下面。你不再检索，专心把事情分析透、写成能直接用的答复。只用下面依据里的编号引用；依据里没有的规定，写法规名称和条号并标「需另行核实」。每个争点都要有结论；未知事实分情况给结论。`;
  const draft = await completeText(settings, { model, signal, system: writerSystem, messages: [...history, { role: "user", content: `${content}\n\n${dossier}` }] });

  // ③ 核对，两路并行，都拿原文去核，不做无依据的「通读挑错」（弱模型无外部依据的自我纠错常把对的改错）：
  //   a. 引用支撑：把挂了编号的句子逐句拆出来，每句只配它引用的原文，单独判断原文是否支撑这句话（不给看全文，避免被原稿带偏）；
  //   b. 计算与遗漏：对照依据原文核金额、期限、起算点，对照研究员的争点看有没有漏答。
  emit({ type: "stage", text: "核对：逐句对照引用的原文；核算金额期限、查漏" });
  const claims = citedClaims(draft);
  const [support, coverage] = await Promise.all([
    claims.length ? completeJSON(settings, {
      model, effort: "medium", signal,
      system: `你是核对引用的律师。下面每一项是答复里的一句话和它引用的原文。只看原文，逐项判断原文是否支撑这句话：
- yes：原文直接支撑；
- partly：原文支撑一部分，但这句话多说了原文没有的内容、漏了原文的前提条件，或把例外当原则；
- no：原文说的是别的事，或与这句话矛盾。
只输出 JSON：{"results": [{"n": 序号, "verdict": "yes/partly/no", "problem": "partly 或 no 时写清问题", "fix": "按原文应当怎么说（或应改挂哪条）"}]}`,
      user: claims.map((c, i) => `### ${i}
句子：${c.sentence}
原文：
${c.sources.join("\n") || "（编号在资料库中不存在）"}`).join("\n\n"),
    }).catch((err) => { if (signal?.aborted) throw err; return { results: [] }; }) : { results: [] },
    completeJSON(settings, {
      model, effort: "medium", signal,
      system: `你是审稿律师，只查两件事，不挑文风：
1. 计算：答复里的金额、倍数、期限、起算点，按依据原文和用户给的事实算一遍，算错或口径错的指出来；
2. 遗漏：研究员列出的争点、对结论有重大影响的期限和风险，答复有没有回答。
只输出 JSON：{"fixes": [{"where": "答复中的句子（照抄开头十几个字），遗漏的写「补充」", "problem": "问题", "fix": "具体怎么改或补什么"}]}；没问题输出 {"fixes": []}。`,
      user: `## 用户的问题与情况\n${clip(content, 20000)}\n\n${dossier}\n\n## 待核对的答复\n${draft}`,
    }).catch((err) => { if (signal?.aborted) throw err; return { fixes: [] }; }),
  ]);
  const check = { fixes: [
    ...(Array.isArray(support.results) ? support.results : []).filter((r) => r && (r.verdict === "no" || r.verdict === "partly") && claims[Number(r.n)])
      .map((r) => ({ where: claims[Number(r.n)].sentence.slice(0, 40), problem: `引用${r.verdict === "no" ? "不支撑" : "只部分支撑"}：${r.problem || ""}`, fix: r.fix || "" })),
    ...(Array.isArray(coverage.fixes) ? coverage.fixes : []),
  ] };
  const fixes = (Array.isArray(check.fixes) ? check.fixes : []).filter((f) => f && f.problem);

  // ④ 定稿
  emit({ type: "text_reset" });
  if (!fixes.length) {
    emit({ type: "stage", text: "核对通过" });
    emit({ type: "text", delta: draft });
    return { text: draft, sources, fixes };
  }
  emit({ type: "stage", text: `按核对意见修改 ${fixes.length} 处` });
  const { content: final } = await stream(settings, {
    model, effort: "medium", signal, onText: (delta) => emit({ type: "text", delta }), onReset: () => emit({ type: "text_reset" }),
    messages: [
      { role: "system", content: writerSystem },
      ...history,
      { role: "user", content: `${content}\n\n${dossier}` },
      { role: "assistant", content: draft },
      { role: "user", content: `审稿律师对照原文提出了以下问题。逐条改正后输出**完整的**修改后答复（不要只写改动，不要提到审稿过程）：\n${fixes.map((f, i) => `${i + 1}. 「${f.where || ""}」：${f.problem} → ${f.fix || ""}`).join("\n")}` },
    ],
  });
  return { text: final || draft, sources, fixes };
}

/** 答复里挂了 [[art:..]]、[[case:..]]、[[ref:..]] 的句子，配上所引原文 */
function citedClaims(text) {
  const out = [];
  for (const sentence of text.split(/(?<=[。；！？\n])/)) {
    const refs = [...sentence.matchAll(/\[\[(art|case|ref):([^\]]+)\]\]/g)];
    if (!refs.length) continue;
    const sources = refs.map(([, kind, id]) => {
      if (kind === "art") { const a = search.getArticle(id); return a ? `《${a.title}》${a.article}：${clip(a.text, 700)}` : ""; }
      if (kind === "case") { const c = search.getCase(id); return c ? `案例「${c.title}」${c.note ? `（${c.note}）` : ""}裁判要点：${clip(c.points, 600)}` : ""; }
      const g = search.getRef(id); return g ? `指引「${g.title}」：${clip(g.text, 600)}` : "";
    });
    out.push({ sentence: sentence.trim().slice(0, 400), sources: sources.filter(Boolean) });
    if (out.length >= 30) break;
  }
  return out;
}

async function completeText(settings, { model, system, messages, signal }) {
  const { content } = await stream(settings, { model, effort: "medium", signal, onText: () => {}, onReset: () => {}, messages: [{ role: "system", content: system }, ...messages] });
  return content || "";
}
