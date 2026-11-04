// 一次问答的完整流程：分流 → 追问 → 按任务手册检索分析（合同、方案走多轮审查）→ 核对引用。
import { runAgent, SYSTEM_PROMPT, DEPTH } from "./agent.mjs";
import { routeTask, intakeQuestions } from "./router.mjs";
import { getTask } from "./tasks.mjs";
import { runReview } from "./review.mjs";
import { verifyCitations } from "./verify.mjs";
import { pickReviewModel } from "./models.mjs";

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
export async function ask(settings, { conv, question, region, attachments = [], intakeAnswers, skipIntake, model, depth = "medium", available = [], db, emit, signal }) {
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
    emit({ type: "stage", text: "理解问题" });
    route = await routeTask(settings, model, { question, region, attachments: conv.attachments, history: conv.history }, signal);
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
  const doc = conv.attachments.map((a) => `【${a.name}】\n${a.text}`).join("\n\n");
  let text;

  // 新上传了文件、或这份文件还没审过时，走多轮审查；之后的追问在已有审查意见的基础上回答
  if ((route.task === "contract_review" || route.task === "plan_review") && doc && (attachments.length || !conv.reviewed)) {
    conv.reviewed = true;
    const reviewModel = pickReviewModel(settings, model, available);
    const r = await runReview(settings, {
      kind: route.task, doc, question: userQuestion, region, facts, mainModel: model, reviewModel, emit, signal, db,
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
    emit({ type: "stage", text: `按「${task.name}」的方法检索分析` });
    const r = await runAgent(settings, {
      model, effort: cfg.effort, system, steps: cfg.steps, emit, signal,
      messages: [...conv.history, { role: "user", content }],
    });
    text = r.text;
  }

  // 核对引用：正文里的「《某法》第某条」能对上资料库的加链接，对不上的标出来
  const v = verifyCitations(db, text);
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
