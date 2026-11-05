// 分流和追问：判断这是哪类事，缺哪些会改变结论的关键事实。
import { completeJSON } from "./models.mjs";
import { getTask, scenarioCatalog } from "./tasks.mjs";
import { rosterForRouting, getAgent } from "./roster.mjs";

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

/** 判断这是哪个场景（99 个场景之一；都不像就是 general）。 */
export async function routeTask(settings, model, ctx, signal) {
  const cat = scenarioCatalog();
  const list = cat.groups.map((g) => `【${g.key} ${g.full}】\n` + cat.scenarios.filter((x) => x.group === g.key)
    .map((x) => `- ${x.id}｜${x.name}${x.examples[0] ? "｜例：" + x.examples[0] : ""}`).join("\n")).join("\n");
  const system = `你是律所的接待助理，负责把客户的事分到最贴切的具体场景，每个场景有自己的工作流程。只输出 JSON，不要其他文字。

场景目录：
${list}
- general｜以上都不贴切的其他法律问题

专项 Agent 目录（每个 Agent 按自己的技能产出特定的成品）：
${rosterForRouting()}

输出格式：
{"task": "场景 id，或 agent:插件:技能", "also": ["同时涉及的其他场景 id，最多 2 个，可空"], "region": "问题涉及的省级地区，看不出就空字符串", "summary": "用一句话复述用户真正要解决的问题", "urgent": true/false（有迫在眉睫的期限，如已收到起诉状、仲裁、处罚告知时为 true）}

判断要点：看用户是哪一方、处在哪个阶段（事前想做 / 已被对方主张 / 要去追讨 / 已有判决要执行）、手里有没有底稿。上传了合同并要求审查的，选对应合同类型的审查场景；拿对方模板或旧合同改的，选改写场景；收到起诉状、仲裁申请、律师函、处罚告知的，选应对场景。
场景和 Agent 怎么选：用户要的正是某个 Agent 的特定成品（例如保密协议三色分流、合同修订历史、尽调表格、起诉状、答辩状、辩护词、量刑测算、经济补偿测算、商标申请、隐私政策、董事会决议、期限台账、个人信息权利请求答复……），或者点名要做这件事，选那个 Agent（task 写 agent: 开头的完整 id）；想弄清情况、判断怎么办、要综合方案的，选场景。`;
  const r = await completeJSON(settings, { model, system, user: contextBlock(ctx), effort: "low", signal });
  const known = (id) => cat.byId.has(id) || (String(id).startsWith("agent:") && !!getAgent(String(id).slice(6)));
  const task = known(r.task) ? r.task : "general";
  return { task, name: task.startsWith("agent:") ? getAgent(task.slice(6)).title : getTask(task).name, also: (Array.isArray(r.also) ? r.also : []).filter((x) => known(x) && x !== task && !String(x).startsWith("agent:")).slice(0, 2), region: r.region || ctx.region || "", summary: r.summary || "", urgent: !!r.urgent };
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
