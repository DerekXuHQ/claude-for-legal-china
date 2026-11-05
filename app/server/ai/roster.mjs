// 命名 Agent 与定时 Agent：每个 Agent 按它的技能全文（SKILL.md）办事，读用户的实务画像，读写台账。
// 内容由 scripts/build-agents.mjs 从仓库各插件生成到 roster/。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTERS, queryRegister, writeRegister, deleteRegister, getProfile, saveProfile } from "../registers.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "roster");
let roster = null;

export function loadRoster() {
  if (roster) return roster;
  const p = path.join(DIR, "roster.json");
  roster = existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : { areas: {}, agents: [], skills: {} };
  roster.byId = new Map(roster.agents.map((a) => [a.id, a]));
  return roster;
}
export function getAgent(id) {
  const r = loadRoster();
  if (r.byId.has(id)) return r.byId.get(id);
  // 实务画像访谈 / 修改画像：每个领域的 cold-start-interview、customize 技能
  const [plugin, skill] = String(id).split(":");
  if (r.areas[plugin] && (skill === "cold-start-interview" || skill === "customize") && r.skills[id]) {
    const area = r.areas[plugin];
    return { id, kind: "interview", plugin, area, title: skill === "customize" ? `修改${area}实务画像` : `${area}实务画像访谈`,
      blurb: skill === "customize" ? "按用户的要求修改已保存的实务画像" : "通过访谈了解团队的立场、红线、审批人和行文习惯，生成本领域的实务画像，之后本领域所有 Agent 都按它办事。访谈结束时调用 save_profile 保存画像全文", skills: [id] };
  }
  return null;
}

export function skillText(key) {
  const [p, s] = String(key).split(":");
  if (!p || !s || /[./\\]/.test(p + s)) return "";
  const f = path.join(DIR, "skills", p, s + ".md");
  if (!existsSync(f)) return "";
  // 技能目录里的模板、示例一并附上
  const extras = readdirSync(path.join(DIR, "skills", p)).filter((x) => x.startsWith(s + "--"))
    .map((x) => `\n\n### 附：${x.slice(s.length + 2)}\n${readFileSync(path.join(DIR, "skills", p, x), "utf-8")}`).join("");
  return readFileSync(f, "utf-8") + extras;
}
const watcherText = (id) => { const [p, a] = id.replace(/^watch:/, "").split(":"); const f = path.join(DIR, "watchers", p, a + ".md"); return existsSync(f) ? readFileSync(f, "utf-8") : ""; };
export const profileTemplate = (plugin) => { const f = path.join(DIR, "profiles", plugin + ".md"); return existsSync(f) ? readFileSync(f, "utf-8") : ""; };
function referenceText(plugin, name) {
  const f = path.join(DIR, "references", plugin, path.basename(String(name)).replace(/\.md$/, "") + ".md");
  return existsSync(f) ? readFileSync(f, "utf-8") : "";
}
const referenceList = (plugin) => { const d = path.join(DIR, "references", plugin); return existsSync(d) ? readdirSync(d) : []; };

// 技能原本写给 Claude Code 插件：配置文件路径、斜杠命令、MCP 连接器、写本地文件。在 app 里的对应关系：
const ADAPTER = `## 在本 app 里怎么执行技能（技能原文是为 Claude Code 插件写的，按下面的对应关系执行）
- **实务画像**：技能里的 \`~/.claude/plugins/config/claude-for-legal-zh/<插件>/CLAUDE.md\`（或「实务画像」「practice profile」「合同手册」「审查指引」「playbook」）就是下面附的「实务画像」。需要写入或更新画像时调用 save_profile，写完整的画像全文。
- **没有画像也要把活干完**：技能里「未配置实务画像就停下」「先运行 cold-start-interview 再继续」「不能给出绿色结论」一类的前置要求，在本 app 里**不适用**。照常完成全部步骤和交付物：团队立场用通用的稳健立场（对我方保护充分、行业常见）代替，写明「按通用立场」并标〔假设〕；需要按团队标准才能定的结论（例如能否不经律师直接签）给出按通用立场的结论，并说明配置画像后可能不同。回答末尾用一句话提示：在「Agent」页→「实务画像」做一次访谈，之后按你们的标准来。
- **用户说了「不用再问 / 按现有信息直接出 / 用通用模板」**：技能里「没有先例或模板就不起草」「停下等用户明确回复某句话」之类的门槛视为用户已同意：用通用、规范的格式直接写出完整成品，开头一句说明用的是通用格式、哪些地方要按内部格式调整。用户没这么说时，按技能先问。
- **法条、案例要自己去取**：用户只给了法规名称、条号、案例名称或案号（例如「指导案例 1 号」）时，先用 search_cases / read_case / find_law_by_title / read_articles 在资料库取原文，取不到再联网；不要说「你没有提供原文」。
- **诊所、学习类技能**：法律援助与诊所技能的「教学模式」在没有配置画像时按「直接起草（draft）」处理，直接写出成稿，并附审查要点；法学学习类技能保留「先让学习者作答」的训练设计，但案例、法条原文要先替学习者取来。
- **不要让用户输入斜杠命令**：本 app 没有 /命令。要用户做某件事时，说「在 Agent 页启动『某某』」或直接在这里继续。
- **其他技能**：技能里说「运行 /插件:技能」「加载某技能」「交给某技能」时，调用 read_skill 读那个技能的全文再照做；也可以告诉用户在「Agent」页启动对应的 Agent。
- **连接器**：本 app 没有 MCP 连接器（元典 yuandian、北大法宝、Ironclad、飞书、Slack、Jira、Linear、数据室、法院系统等都没有）。法条、司法解释、案例用 search_law / find_law_by_title / read_articles / search_cases / read_case；公开信息用 web_search；合同管理系统、数据室、案件系统、HR 系统里的数据，来自用户上传的文件和本 app 的台账（register_query）。技能说「如果没有连接器……」的，按那条路径走。
- **登记册、日志、追踪表**（续约登记册、偏离日志 deviation-log、假期登记册、知识产权组合、案件日志、调查日志、差距追踪器、征求意见追踪等 .yaml / .md 文件）：一律用 register_query 读、register_write 写到对应台账。台账名称：${Object.entries(REGISTERS).map(([k, v]) => `${k}=${v.name}`).join("，")}。
- **审完一份合同**（任何合同审查、分流、修订追踪），把合同的关键信息写进 contracts（合同台账）：对方、合同名称、类型、签署日、起止日、是否自动续期、取消通知天数、取消截止日、金额、我方负责人、状态；有偏离审查指引而接受的条款，同时写进 deviations。这样续约监控和签署复盘才有数据。
- **运行日志不是台账**：Agent 说明里「记录本次运行」「写运行日志」的，就是这份报告本身，app 会自动保存；不要把运行记录写进任何台账。台账只写技能要求登记的业务记录（合同、偏离、期限、假期等），而且写进对应的那一个台账。
- **事项工作区**（matter-workspace）就是当前事项：用户上传到这个事项的文件已经附在消息里。
- **推送、发邮件、发飞书或 Slack**：本 app 不替用户发送任何消息。需要「推送」的内容写在回答里，app 会作为提醒显示；不要说已经发出。
- **先访谈 / 先问**：技能要求先问清事实或先访谈的，照做：在回答里列出问题（一次最多 6 个，能给选项的给选项），等用户回答再继续；用户说「按现有信息先做」时，写明采用的假设。
- **境外内容**：只按中国大陆法办。技能里涉及境外法域的部分，事实涉及时指出需要当地律师，不套用大陆法。
- **来源标注**：技能里的 [法条原文]、[yuandian检索]、[模型知识 — 需验证] 等标签，按本 app 的规则写：读过原文的条文用条文链接，联网资料标〔网上资料〕，没核实的标〔待核实〕，推断标〔判断〕，假设标〔假设〕。
- **交付物**：技能规定了输出格式（表格、三色分流、时间线、备忘录、文书）的，严格按那个格式输出完整成品，用户可以直接导出 Word。`;

function profileBlock(db, plugin) {
  const own = getProfile(db, plugin);
  const company = getProfile(db, "_company");
  const parts = [];
  if (company?.text) parts.push(`### 公司基本情况（用户填写）\n${company.text}`);
  if (own?.text) parts.push(`### 本领域实务画像（用户已配置，${new Date(own.updated * 1000).toISOString().slice(0, 10)} 更新）\n${own.text.slice(0, 60000)}`);
  else {
    const tpl = profileTemplate(plugin);
    parts.push(`### 本领域实务画像：**用户尚未配置**
回答开头用一句话说明「还没有配置本领域的实务画像（团队立场、红线、审批人），以下按通用的稳健立场」，然后**照常完成全部工作**，不要因此停下或只让用户去配置。依赖团队立场的判断标〔假设〕。
下面是画像模板（括号里的是待填项，「默认」写明的按默认做）：
${tpl.slice(0, 30000)}`);
  }
  return `## 实务画像\n${parts.join("\n\n")}`;
}

/** 这个 Agent 的系统提示：技能全文 + 实务画像 + 执行约定。 */
export function agentSystem(db, agent, basePrompt) {
  const skills = agent.skills.map((k, i) => `## ${i === 0 ? "技能" : "配套技能"}：${k}\n${skillText(k)}`).join("\n\n");
  const refs = referenceList(agent.plugin);
  const watch = agent.kind === "watch" ? `## Agent 说明：${agent.title}
**本 app 会按「${agent.cadence === "daily" ? "每天" : "每周"}」自动运行你**（app 开着时；台账为空时跳过），报告存进「定时报告」并发系统通知。所以不要让用户设日历提醒、不要说「本 Agent 不会自行定时运行」；Agent 说明里关于运行频率、推送渠道、连接器的配置要求都不适用。
${watcherText(agent.id)}\n\n` : "";
  return `${basePrompt}

# 你现在是「${agent.title}」Agent（${agent.area}）
${agent.blurb}。严格按下面的技能办事：步骤、要问的问题、输出格式都以技能为准；技能没写到的，按上面的通用规则。

${ADAPTER}
${refs.length ? `- **本领域参考资料**（需要时用 read_reference 读）：${refs.join("、")}` : ""}

${profileBlock(db, agent.plugin)}

${watch}${skills}`;
}

// ---- Agent 专用工具 ----
export const AGENT_TOOLS = [
  { name: "read_skill", description: "读取另一个技能的全文（技能里说「运行 /插件:技能」或「加载某技能」时用）。参数 skill 形如 commercial-legal:renewal-tracker。", input_schema: { type: "object", properties: { skill: { type: "string" } }, required: ["skill"] } },
  { name: "read_reference", description: "读取本领域插件自带的参考资料全文。", input_schema: { type: "object", properties: { name: { type: "string", description: "文件名" } }, required: ["name"] } },
  { name: "register_query", description: "读取台账（合同台账、偏离日志、假期台账、知识产权组合、案件、期限等）。返回全部或按关键词筛选的记录。", input_schema: { type: "object", properties: { register: { type: "string", enum: Object.keys(REGISTERS) }, keyword: { type: "string", description: "可选，按关键词筛选" } }, required: ["register"] } },
  { name: "register_write", description: "新增或更新台账里的一条记录。更新时带上 id；新增不带 id。data 是这条记录的字段（中文键名也可以）。", input_schema: { type: "object", properties: { register: { type: "string", enum: Object.keys(REGISTERS) }, id: { type: "string" }, data: { type: "object" } }, required: ["register", "data"] } },
  { name: "register_delete", description: "删除台账里的一条记录（只在用户明确要求时用）。", input_schema: { type: "object", properties: { register: { type: "string", enum: Object.keys(REGISTERS) }, id: { type: "string" } }, required: ["register", "id"] } },
  { name: "save_profile", description: "保存本领域的实务画像（访谈完成、或用户要求修改立场时）。text 是画像全文（Markdown），会整体替换旧版。scope 填 company 时保存公司基本情况。", input_schema: { type: "object", properties: { text: { type: "string" }, scope: { type: "string", enum: ["plugin", "company"] } }, required: ["text"] } },
];
export const AGENT_STEP_LABEL = { read_skill: "读取技能", read_reference: "读取参考资料", register_query: "查台账", register_write: "写入台账", register_delete: "删除台账记录", save_profile: "保存实务画像" };

/** 执行 Agent 工具；不是 Agent 工具时返回 null。 */
export function runAgentTool(db, agent, name, args, matterId = "") {
  const J = (v) => JSON.stringify(v);
  const s = (v) => (typeof v === "string" ? v : "");
  switch (name) {
    case "read_skill": { const t = skillText(s(args.skill)); return J(t ? { skill: args.skill, text: t } : { error: "没有这个技能" }); }
    case "read_reference": { const t = referenceText(agent.plugin, s(args.name)); return J(t ? { name: args.name, text: t.slice(0, 40000) } : { error: "没有这份资料", available: referenceList(agent.plugin) }); }
    case "register_query": return J(queryRegister(db, s(args.register), s(args.keyword)));
    case "register_write": return J(writeRegister(db, s(args.register), args.data, { id: s(args.id), source: agent.title, matterId }));
    case "register_delete": return J(deleteRegister(db, s(args.register), s(args.id)));
    case "save_profile": {
      const text = s(args.text).trim();
      if (text.length < 20) return J({ error: "画像内容太短" });
      saveProfile(db, args.scope === "company" ? "_company" : agent.plugin, text);
      return J({ ok: true, saved: args.scope === "company" ? "公司基本情况" : `${agent.area}实务画像`, chars: text.length });
    }
    default: return null;
  }
}

/** 给分流用的 Agent 目录（只列按需运行的）。 */
export function rosterForRouting() {
  const r = loadRoster();
  return Object.values(r.areas).map((area) => {
    const xs = r.agents.filter((a) => a.area === area && a.kind === "task");
    return xs.length ? `【${area}】\n` + xs.map((a) => `- agent:${a.id}｜${a.title}｜${a.blurb.slice(0, 40)}`).join("\n") : "";
  }).filter(Boolean).join("\n");
}

/** 界面用：Agent 列表（不含技能全文）。 */
export function rosterForUi(db) {
  const r = loadRoster();
  const configured = new Set(db ? db.prepare("SELECT plugin FROM profiles").all().map((x) => x.plugin) : []);
  return {
    areas: Object.entries(r.areas).map(([plugin, area]) => ({ plugin, area, configured: configured.has(plugin), hasInterview: !!r.skills[`${plugin}:cold-start-interview`] })),
    agents: r.agents.map(({ description, ...a }) => a),
    registers: REGISTERS,
    companyConfigured: configured.has("_company"),
  };
}
