// 分流和追问：判断这是哪类事，缺哪些会改变结论的关键事实。
import { completeJSON } from "./models.mjs";
import { loadTasks, getTask } from "./tasks.mjs";

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "……" : s || "");

function contextBlock({ question, region, attachments = [], history = [] }) {
  const prev = history.filter((m) => m.role === "user" || (m.role === "assistant" && typeof m.content === "string"))
    .slice(-6).map((m) => `${m.role === "user" ? "用户" : "助理"}：${clip(typeof m.content === "string" ? m.content : "", 600)}`).join("\n");
  const files = attachments.map((a) => `【附件：${a.name}，约 ${a.text.length} 字】\n${clip(a.text, 2500)}`).join("\n\n");
  return [
    prev ? `## 之前的对话\n${prev}` : "",
    region ? `## 用户选择的地区\n${region}` : "",
    files ? `## 用户上传的文件（节选）\n${files}` : "",
    `## 用户这次的话\n${question}`,
  ].filter(Boolean).join("\n\n");
}

/** 判断任务类型。 */
export async function routeTask(settings, model, ctx, signal) {
  const tasks = [...loadTasks().values()];
  const list = tasks.map((t) => `- ${t.id}｜${t.name}｜${t.when}${t.examples.length ? "｜例：" + t.examples.slice(0, 3).join("；") : ""}`).join("\n");
  const system = `你是律所的接待助理，负责把客户的问题分给合适的工作流程。只输出 JSON，不要其他文字。

可选的任务类型：
${list}

输出格式：
{"task": "任务编号", "also": ["同时涉及的其他任务编号，可空"], "region": "问题涉及的省级地区，看不出就空字符串", "summary": "用一句话复述用户真正要解决的问题", "urgent": true/false（有迫在眉睫的期限，如已收到起诉状、仲裁、处罚告知时为 true）}

判断要点：上传了合同并要求审查的，归合同审查；上传了方案、活动规则的，归方案合规审查；收到起诉状、仲裁申请、律师函、处罚告知的，归被诉、被索赔应对；员工、用工相关的优先归劳动用工。`;
  const r = await completeJSON(settings, { model, system, user: contextBlock(ctx), effort: "low", signal });
  const task = loadTasks().has(r.task) ? r.task : "general";
  return { task, name: getTask(task).name, also: (r.also || []).filter((x) => loadTasks().has(x) && x !== task), region: r.region || ctx.region || "", summary: r.summary || "", urgent: !!r.urgent };
}

/** 追问：返回需要先问的问题（最多 6 个）；信息足够时返回空数组。 */
export async function intakeQuestions(settings, model, route, ctx, signal) {
  const task = getTask(route.task);
  const facts = task.intake.length
    ? task.intake.map((r) => `- ${r.fact}${r.required ? "（必需）" : ""}：${r.ask}　——${r.why}`).join("\n")
    : "- 事情经过、涉及的主体、地区、时间、用户的目标";
  const system = `你是有经验的律师助理，正在接待客户。下面是「${task.name}」这类事需要弄清的事实。对照用户已经给出的信息（包括上传的文件），找出**还缺、而且会实质改变结论**的事实，向用户提问。只输出 JSON。

这类事需要弄清的事实：
${facts}

规则：
- 用户已经说了的、文件里能看出来的、按常理可以合理假设且不影响结论的，都不要问。
- 最多问 6 个，按重要性排序；能给选项的给选项（options），方便用户直接选。
- 问题要具体、口语化，一句话一个问题；不要问「请提供更多信息」这种空泛的话。
- 用户的问题本身很简单（例如只是问某个规定是什么），或者信息已经够给出可靠结论，就返回空数组。

输出格式：
{"questions": [{"key": "简短英文键名", "question": "问题", "why": "为什么要知道（十五字以内）", "required": true/false, "options": ["选项1", "选项2"]}], "assumptions": ["如果用户跳过追问，你会采用的合理假设"]}`;
  const r = await completeJSON(settings, { model, system, user: contextBlock(ctx), effort: "low", signal });
  const qs = Array.isArray(r.questions) ? r.questions.filter((q) => q && q.question).slice(0, 6) : [];
  return { questions: qs.map((q, i) => ({ key: String(q.key || "q" + i), question: String(q.question), why: String(q.why || ""), required: !!q.required, options: Array.isArray(q.options) ? q.options.map(String).slice(0, 8) : [] })), assumptions: Array.isArray(r.assumptions) ? r.assumptions.map(String) : [] };
}
