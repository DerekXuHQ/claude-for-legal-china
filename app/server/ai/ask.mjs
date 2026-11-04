// 一次问答的完整流程：分流 → 追问 → 按任务手册检索分析（合同、方案走多轮审查）→ 核对引用。
import { runAgent, SYSTEM_PROMPT, DEPTH } from "./agent.mjs";
import { routeTask, intakeQuestions } from "./router.mjs";
import { getTask } from "./tasks.mjs";
import { runReview } from "./review.mjs";
import { runConsult } from "./consult.mjs";
import { verifyCitations, flagRepealed, citedSentences } from "./verify.mjs";
import { completeJSON } from "./models.mjs";
import { pickReviewModel } from "./models.mjs";

const clipLine = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 60);
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "\n〔后面的内容过长，已省略〕" : s || "");

export function newConversation() {
  return { history: [], attachments: [], route: null, pending: null };
}

function answersText(questions, answers) {
  return questions.map((q) => {
    const a = answers?.[q.key];
    return a && String(a).trim() ? `- ${q.question}：${String(a).trim()}` : null;
  }).filter(Boolean).join("\n");
}

/**
 * @param {object} p
 * @param {object} p.conv           会话状态（newConversation）
 * @param {string} p.question
 * @param {string} p.region
 * @param {{name:string,text:string}[]} p.attachments 这次新上传的文件
 * @param {object} [p.intakeAnswers] 对上一轮追问的回答
 * @param {boolean} [p.skipIntake]  跳过追问，按现有信息作答
 */
export async function ask(settings, { conv, question, region, attachments = [], intakeAnswers, skipIntake, model, depth = "medium", available = [], db, emit, signal, scenario = "", pipeline = process.env.CLS_PIPELINE || "agent" }) {
  const cfg = DEPTH[depth] || DEPTH.medium;
  conv.attachments.push(...attachments);
  let route, facts = "", userQuestion = question;

  if (conv.pending && (intakeAnswers || skipIntake)) {
    // 用户回答了追问（或选择跳过）
    route = conv.pending.route;
    userQuestion = conv.pending.question + (question ? `\n${question}` : "");
    facts = answersText(conv.pending.questions, intakeAnswers);
    if (skipIntake && conv.pending.assumptions?.length) facts += (facts ? "\n" : "") + `用户选择先按现有信息分析。可采用的假设：${conv.pending.assumptions.join("；")}`;
    region = region || conv.pending.region;
    conv.pending = null;
  } else {
    // 用户在目录里选了场景：这个事项就按该场景办，不再自动分流
    if (scenario && getTask(scenario).scenario) conv.scenario = scenario;
    if (conv.scenario) {
      const t = getTask(conv.scenario);
      route = { task: t.id, name: t.name, also: [], region: region || conv.route?.region || "", summary: conv.route?.summary || clipLine(question), urgent: false };
    } else {
      emit({ type: "stage", text: "理解问题" });
      route = await routeTask(settings, model, { question, region, attachments: conv.attachments, history: conv.history }, signal);
    }
    region = region || route.region;
    emit({ type: "route", task: route.task, name: route.name, summary: route.summary, also: route.also });
    // 第一次问、或换了一类事时，先看要不要追问
    const firstOfTask = !conv.route || conv.route.task !== route.task;
    if (!skipIntake && firstOfTask) {
      const q = await intakeQuestions(settings, model, route, { question, region, attachments: conv.attachments, history: conv.history }, signal);
      if (q.questions.length) {
        conv.pending = { route, question, region, questions: q.questions, assumptions: q.assumptions };
        conv.route = route;
        emit({ type: "intake", questions: q.questions, assumptions: q.assumptions, summary: route.summary });
        return { text: "", route, intake: true };
      }
    }
  }
  conv.route = route;
  emit({ type: "route", task: route.task, name: route.name, summary: route.summary, also: route.also });

  const task = getTask(route.task);
  emit({ type: "step", kind: "route", text: `按「${task.name}」处理${task.pipelineName ? `（${task.pipelineName}流程）` : ""}`,
    detail: [route.summary && `要解决的问题：${route.summary}`, region && `地区：${region}`, facts && `你补充的情况：\n${facts}`].filter(Boolean).join("\n") });
  const doc = conv.attachments.map((a) => `【${a.name}】\n${a.text}`).join("\n\n");
  let text;
  let ledgerOf = null; // 本次实际读过原文的条文编号

  // 新上传了文件、或这份文件还没审过时，走多轮审查；之后的追问在已有审查意见的基础上回答
  // 合同审查场景（P5）走合同审查；合规判断场景（P8）上传了方案文件的走方案审查
  const reviewKind = route.task === "contract_review" || task.runner === "review" ? "contract_review" : route.task === "plan_review" || task.pipeline === "P8" ? "plan_review" : "";
  if (reviewKind && doc && (attachments.length || !conv.reviewed)) {
    conv.reviewed = true;
    const reviewModel = pickReviewModel(settings, model, available);
    const r = await runReview(settings, {
      kind: reviewKind, task: task.scenario ? task : null, doc, question: userQuestion, region, facts, mainModel: model, reviewModel, emit, signal, db,
      verify: verifyCitations,
    });
    text = r.text;
  } else {
    const extra = route.also.map((id) => getTask(id)).filter((t) => t.body).map((t) => `\n\n## 同时涉及：${t.name}\n${t.body.slice(0, 6000)}`).join("");
    const system = `${SYSTEM_PROMPT}\n\n## 本次任务：${task.name}\n${task.body}${extra}${cfg.note}`;
    const content = [
      region ? `[用户所在或关注的地区：${region}]` : "",
      route.summary ? `[要解决的问题：${route.summary}]` : "",
      facts ? `## 用户补充的情况\n${facts}` : "",
      doc ? `## 用户上传的文件\n${clip(doc, 80000)}` : "",
      `## 问题\n${userQuestion}`,
    ].filter(Boolean).join("\n\n");
    emit({ type: "live", text: `按「${task.name}」的方法检索分析` });
    const r = pipeline === "consult" ? await runConsult(settings, { model, system, content, history: conv.history, emit, signal }) : await runAgent(settings, {
      model, effort: cfg.effort, system, steps: cfg.steps, emit, signal,
      messages: [...conv.history, { role: "user", content }],
    });
    text = r.text;
    ledgerOf = r.ledger || null;
  }

  // 核对引用：正文里的「《某法》第某条」能对上资料库的加链接，对不上的标出来；已废止的法律标出现行依据
  const v = verifyCitations(db, text);
  const rep = flagRepealed(v.text);
  v.text = rep.text;
  // 依据对照：每个挂了条文的句子，只给它引用的条文原文，单独判断是否真的支持；不支持的按原文改写
  const claims = citedSentences(db, v.text);
  if (claims.length) {
    emit({ type: "stage", text: `核对：逐句对照 ${claims.length} 处引用的条文原文` });
    try {
      const j = await completeJSON(settings, {
        model, effort: "low", signal,
        system: `你是核对引用的律师。下面每一项是一句话和它引用的条文原文。只看原文，逐项判断原文是否支撑这句话：
yes = 原文直接支撑；partly = 原文只支撑一部分，或这句话多说了原文没有的内容、漏了原文的前提条件；no = 原文说的是别的事，或与这句话矛盾。
partly 或 no 时，给出按原文改写后的这句话（保持原句的语气和格式，保留句中的 [[art:…]] 标记，只改不准确的部分）。
只输出 JSON：{"results": [{"n": 序号, "verdict": "yes/partly/no", "problem": "问题（十五字以内）", "fix": "改写后的整句"}]}`,
        user: claims.map((c, i) => `### ${i}\n句子：${c.sentence}\n原文：\n${c.sources.map((x) => x.line).join("\n")}`).join("\n\n"),
      });
      const fixed = [];
      for (const r of Array.isArray(j.results) ? j.results : []) {
        const c = claims[Number(r.n)];
        if (!c || !(r.verdict === "no" || r.verdict === "partly")) continue;
        let fix = typeof r.fix === "string" && r.fix.trim() ? r.fix.trim() : `${c.sentence}〔依据存疑：${r.problem || "所引条文不直接支持这句话"}〕`;
        // 改写后的句子要保留原来的引用标记；改写得比原句长一倍以上的不用（多半是把条文原文抄了进来）
        const marks = (c.sentence.match(/\[\[[^\]]+\]\]/g) || []).join("");
        if (!fix.includes("[[")) fix += marks;
        if (fix.length > c.sentence.length * 2 + 40) fix = `${c.sentence}〔依据存疑：${r.problem || "所引条文不直接支持这句话"}〕`;
        if (v.text.includes(c.sentence)) { v.text = v.text.replace(c.sentence, fix); fixed.push(`${r.problem || r.verdict}：${c.sentence.slice(0, 40)}…`); }
      }
      const cited = [...new Set(claims.flatMap((c) => c.sources.map((x) => x.id)))];
      const read = ledgerOf ? `引用了 ${cited.length} 条，其中 ${cited.filter((id) => ledgerOf.has(id)).length} 条在作答前读过原文` : "";
      emit({ type: "step", kind: "check", text: `依据对照：${claims.length} 处引用，改正 ${fixed.length} 处`,
        detail: [fixed.length ? "改正：\n" + fixed.join("\n") : "所引条文都支持对应的说法", read].filter(Boolean).join("\n") });
    } catch (err) {
      if (signal?.aborted) throw err;
      emit({ type: "step", kind: "check", text: "依据对照没有完成（不影响回答）", detail: String(err.message || err).slice(0, 200) });
    }
  }
  if (rep.flagged) emit({ type: "step", kind: "check", text: `标出 ${rep.flagged} 处已废止的法律`, detail: "合同法、物权法、担保法等已于 2021-01-01 被民法典取代" });
  if (v.text !== text) {
    emit({ type: "text_reset" });
    emit({ type: "text", delta: v.text });
  }
  emit({ type: "citations", checked: v.checked, linked: v.linked, unverified: v.unverified });

  conv.history.push({ role: "user", content: `${region ? `[地区：${region}]\n` : ""}${userQuestion}${facts ? `\n补充：\n${facts}` : ""}${attachments.length ? `\n[上传了文件：${attachments.map((a) => a.name).join("、")}]` : ""}` });
  conv.history.push({ role: "assistant", content: v.text });
  if (conv.history.length > 16) conv.history.splice(0, conv.history.length - 16);
  return { text: v.text, route };
}
