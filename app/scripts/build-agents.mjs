// 把仓库里的插件（技能、定时 Agent、实务画像模板、参考资料）打进 app：server/ai/roster/。
// 生成的文件进 git（GitHub 打包时直接用）。改了插件内容后运行：npm run agents
//
// 命名 Agent 与上游 Claude for Legal 的「Named agents」一一对应（中文名取自仓库 README 的 Agent 列表），
// 外加中国法本地化新增的技能（刑事、采购、法律检索、律所实务等），每个技能一个 Agent。
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(APP, "..");
const OUT = path.join(APP, "server/ai/roster");

// 插件 → 业务领域（界面分组）
const AREAS = {
  "commercial-legal": "商事合同", "corporate-legal": "公司与并购", "employment-legal": "劳动用工", "privacy-legal": "数据与个人信息",
  "product-legal": "产品与营销", "regulatory-legal": "监管合规", "ai-governance-legal": "AI 治理", "ip-legal": "知识产权",
  "litigation-legal": "诉讼仲裁", "criminal-legal": "刑事辩护与合规", "procurement-legal": "招投标与政府采购",
  "legal-research-cn": "法律检索与研究", "law-practice-cn": "律所实务", "legal-clinic": "法律援助与诊所", "law-student": "法学学习",
};
// 不做成 Agent 的：配置类技能（在 app 里由「实务画像」和「事项」承担）、已弃用的、只给别的技能当参考的
const CONFIG = new Set(["cold-start-interview", "customize", "matter-workspace"]);
const DEPRECATED = new Set(["legal-clinic:form-generation", "legal-clinic:plain-language-letters"]);
// 共用参考框架：不单独列出，挂在使用它的 Agent 上
const COMPANION = {
  "commercial-legal:nda-review": ["commercial-legal:nda-triage"],
  "commercial-legal:vendor-agreement-review": ["commercial-legal:vendor-review"],
  "commercial-legal:saas-msa-review": ["commercial-legal:saas-review"],
  "employment-legal:internal-investigation": ["employment-legal:investigation-open", "employment-legal:investigation-add", "employment-legal:investigation-query", "employment-legal:investigation-memo", "employment-legal:investigation-summary"],
  "employment-legal:international-expansion": ["employment-legal:expansion-kickoff", "employment-legal:expansion-update"],
  "regulatory-legal:gap-surfacer": ["regulatory-legal:gaps", "regulatory-legal:comments"],
};

// README 表格里没有的技能：中文职位名和一句话说明
const EXTRA = {
  "ai-governance-legal:ai-inventory": ["AI 系统台账", "逐个系统登记 AI 角色、风险等级和监管义务（备案、标识、安全评估）"],
  "ai-governance-legal:policy-starter": ["AI 使用政策起草", "按监管要求和公司实际做法起草内部 AI 使用政策"],
  "commercial-legal:construction-contract-review": ["建设工程合同审查", "施工、总包、分包合同的付款、结算、工期、质量与优先受偿权审查"],
  "commercial-legal:contract-drafting": ["合同起草", "从零起草买卖、服务、技术、许可、合作等合同，先访谈后成稿"],
  "commercial-legal:renewal-tracker": ["续约台账", "列出临近取消截止日的合同，在通知窗口关闭前提醒"],
  "commercial-legal:review-proposals": ["审查指引修订审批", "审阅「审查指引更新」提出的修订建议，逐条批准或驳回并写回指引"],
  "commercial-legal:stakeholder-summary": ["业务方摘要", "把合同审查意见改写成业务负责人愿意读的一页纸"],
  "commercial-legal:nda-triage": ["保密协议分流", "对收到的保密协议做绿/黄/红三色分流，只有难的才交律师"],
  "commercial-legal:vendor-review": ["供应商合同审查", "依据审查指引审查供应商协议，标偏离、评风险、给修改文字和升级路径"],
  "commercial-legal:saas-review": ["SaaS 订阅协议审查", "自动续费、涨价、数据、服务等级、责任上限等订阅合同要点审查"],
  "corporate-legal:ai-tool-handoff": ["批量审查工具交接", "大批量文件转交专门的 AI 审查工具，并把结果收回来复核"],
  "corporate-legal:board-minutes": ["董事会会议纪要", "按内部格式起草董事会或专门委员会会议纪要"],
  "corporate-legal:corporate-docs": ["公司治理文件起草", "股东会决议、董事会决议、公司章程及修正案等起草"],
  "corporate-legal:deal-team-summary": ["交易团队简报", "把尽调发现汇总成管理层版、交易团队版、谈判版简报"],
  "corporate-legal:diligence-evidence-matrix": ["尽调证据矩阵", "股权投资或收购尽调底稿全量入账，事实—证据—问题逐条对应"],
  "corporate-legal:due-diligence-checklist": ["尽调清单定制", "按行业、阶段、交易类型生成尽调资料清单"],
  "corporate-legal:legal-opinion": ["法律意见书", "就尽调、合规、交易安排等特定事项出具法律意见书"],
  "criminal-legal:bail-application": ["取保候审申请", "从脱敏案情提取法定事由，起草取保候审或羁押必要性审查申请"],
  "criminal-legal:case-analysis": ["刑事证据链梳理", "从供述、证言、书证中梳理事实和证据链，标出矛盾与缺口"],
  "criminal-legal:case-file-notes": ["刑事阅卷笔录", "制作阅卷笔录并做合规校核"],
  "criminal-legal:client-communication": ["刑事案件客户沟通", "服务计划书、工作进展报告、家属沟通要点"],
  "criminal-legal:client-meeting-prep": ["刑事会见准备", "会见发问清单和会见笔录"],
  "criminal-legal:compliance-non-prosecution": ["企业合规不起诉", "涉案企业合规整改大纲与第三方监督评估准备"],
  "criminal-legal:defense-plan": ["辩护方案", "辩点梳理、策略路径选择与各阶段工作计划"],
  "criminal-legal:defense-statement": ["辩护词起草", "辩护词、庭审辩论提纲、最后陈述辅导"],
  "criminal-legal:defense-strategy": ["辩护思路与类案分析", "按构成要件拆解，分析罪与非罪、此罪彼罪和类案裁判"],
  "criminal-legal:investigation-stage-docs": ["侦查阶段文书", "取保申请、不批捕意见、变更强制措施等侦查阶段文书"],
  "criminal-legal:non-prosecution-opinion": ["不起诉意见书", "起草不起诉法律意见书，争取法定、酌定或存疑不起诉"],
  "criminal-legal:plea-negotiation": ["认罪认罚协商", "认罪认罚协商策略与量刑建议沟通意见"],
  "criminal-legal:sentencing": ["量刑测算", "按五步法测算量刑并拟定量刑建议"],
  "criminal-legal:trial-examination-outline": ["庭审发问与质证提纲", "庭前会议、排非申请、发问与举证质证提纲"],
  "employment-legal:investigation-open": ["内部调查", "启动、追踪、补充和汇总内部调查事项"],
  "employment-legal:expansion-update": ["跨省用工进展更新", "更新进行中的异地用工项目，重算已解锁的事项"],
  "employment-legal:handbook-updates": ["员工手册修订比对", "拟修订的规章制度与现行版逐条比对，标出连锁影响和民主程序要求"],
  "employment-legal:investigation-add": ["调查材料补充", "向进行中的调查添加文件、访谈记录或观察意见"],
  "employment-legal:investigation-memo": ["调查备忘录", "从调查日志起草或更新调查备忘录"],
  "employment-legal:investigation-query": ["调查日志查询", "查询调查日志：谁说了什么、哪些陈述互相矛盾"],
  "employment-legal:investigation-summary": ["调查结论摘要", "按 HR、管理层、外部律师等受众起草调查摘要"],
  "employment-legal:labor-arbitration": ["劳动仲裁应对", "案情分析、证据收集、胜负评估、答辩与庭审准备"],
  "employment-legal:labor-contract": ["劳动合同起草", "按岗位类型一次生成劳动合同及配套协议"],
  "employment-legal:leave-tracker": ["假期查询", "查看进行中的假期，得到截止日预警和需要做的决定"],
  "employment-legal:log-leave": ["假期登记", "向假期台账登记新假期，开始追踪期限"],
  "employment-legal:severance-calc": ["经济补偿测算", "经济补偿、赔偿金、代通知金逐项公式与分步测算"],
  "ip-legal:invention-intake": ["发明披露筛查", "新颖性、创造性、可授权主题、公开日和申请策略初筛"],
  "ip-legal:trademark-filing": ["商标申请", "尼斯分类类别规划、申请文件准备和审查意见应对"],
  "law-practice-cn:legal-terminology": ["法律用语校对", "起草或修改法律文书时校正法律术语和表述"],
  "law-student:session": ["专项练习", "在一个科目上做 N 题集中练习（客观题、主观题或记忆卡片）"],
  "legal-clinic:build-guide": ["诊所实务指南", "帮指导老师撰写实务领域指南，配置面向学生的行为"],
  "legal-clinic:client-comms-log": ["当事人沟通记录", "记录电话、邮件、短信、面谈等沟通"],
  "legal-clinic:draft": ["诊所文书初稿", "劳动仲裁申请书、离婚起诉状等常见文书初稿"],
  "legal-research-cn:issue-memo": ["研究备忘录", "就中国法争点形成可追溯的研究备忘录、相反观点和行动建议"],
  "litigation-legal:agent-brief": ["代理词起草", "庭审代理词与辩论意见"],
  "litigation-legal:answer-drafting": ["民事答辩状", "针对原告诉讼请求逐项答辩"],
  "litigation-legal:appeal-petition": ["上诉状与再审申请", "撰写民事上诉状或再审申请书"],
  "litigation-legal:civil-complaint-drafting": ["民事起诉状", "按法定结构撰写民事起诉状"],
  "litigation-legal:deadline-tracker": ["诉讼期限台账", "录入、查看、完结开庭、举证、答辩、上诉等期限"],
  "litigation-legal:judgment-analysis": ["判决书分析", "拆解判决、识别法律错误，评估上诉或再审"],
  "litigation-legal:matter-close": ["结案归档", "记录结果、最终敞口和经验教训，归档案件"],
  "litigation-legal:matter-update": ["案件进展记录", "向案件历史追加带日期的事件并刷新案件日志"],
  "litigation-legal:retrial-analysis": ["再审可行性分析", "读取生效裁判和原审材料，识别再审事由"],
  "litigation-legal:settlement": ["和解与调解协议", "梳理争议、设计方案并起草和解协议或调解协议"],
  "privacy-legal:privacy-policy": ["隐私政策起草", "按产品实际生成隐私政策和个人信息收集清单"],
  "procurement-legal:contract-performance": ["采购合同履约审查", "中标后签约、变更、验收、付款环节的合规审查"],
  "procurement-legal:regime-triage": ["采购制度判断", "判断项目适用政府采购法、招标投标法还是其他采购制度"],
  "product-legal:feature-risk-assessment": ["功能风险评估", "对单个功能或产品领域做深入风险评估"],
  // README 里两个 Agent 共用 /commercial-legal:review，这里按实际技能拆开
  "commercial-legal:review": ["合同审查（自动分流）", "收到一份合同，先判断类型再交给对应的审查流程"],
};
// 只给其他技能当参考框架的：不单独列 Agent，正文随主 Agent 一起加载
const REFERENCE_ONLY = new Set(Object.keys(COMPANION));
// README 里写成 /commercial-legal:review 的两个 Agent：改为指向实际技能
const VIRTUAL = {
  "commercial-legal:nda-triage": { skills: ["commercial-legal:review", "commercial-legal:nda-review"] },
  "commercial-legal:vendor-review": { skills: ["commercial-legal:review", "commercial-legal:vendor-agreement-review"] },
  "commercial-legal:saas-review": { skills: ["commercial-legal:review", "commercial-legal:saas-msa-review"] },
};
// 定时 Agent：运行频率、读哪些台账、对应的中文名（registry-sync 管的是 Claude 插件市场，app 里不适用）
const WATCHERS = {
  "commercial-legal:renewal-watcher": { blurb: "每周读合同台账，把 90 天内要决定是否取消、续约的合同按紧急程度列出来，取消窗口关闭前提醒你", title: "合同续约监控", cadence: "weekly", registers: ["contracts"], skills: ["commercial-legal:renewal-tracker"] },
  "commercial-legal:deal-debrief": { blurb: "每周找出最近签署、且偏离审查指引的合同，请你趁还记得谈判经过补记偏离原因，写进偏离日志", title: "签署合同复盘", cadence: "weekly", registers: ["contracts", "deviations"], skills: [] },
  "commercial-legal:playbook-monitor": { blurb: "盯着偏离日志：同一条款 12 个月内被突破 5 次以上，说明指引跟不上实际做法，提出具体的修订建议", title: "审查指引更新", cadence: "weekly", registers: ["deviations", "playbook_proposals"], skills: ["commercial-legal:review-proposals"] },
  "corporate-legal:dataroom-watcher": { blurb: "每天看各事项新上传的文件（相当于数据室新增），标出高优先级类别，并汇报交割清单进展", title: "数据室监控", cadence: "daily", registers: ["closing_items"], skills: ["corporate-legal:closing-checklist"], files: true },
  "employment-legal:leave-tracker": { blurb: "每周检查在休的产假、医疗期、工伤假等，在法定期限届满前提醒你需要做什么决定", title: "假期期限监控", cadence: "weekly", registers: ["leaves"], skills: ["employment-legal:leave-tracker"] },
  "ip-legal:ip-renewal-watcher": { blurb: "每周读知识产权组合，算出商标续展、专利年费等到期事项，按紧急程度排出清单", title: "知识产权续展监控", cadence: "weekly", registers: ["ip_assets"], skills: ["ip-legal:portfolio"] },
  "litigation-legal:docket-watcher": { blurb: "每天对照案件台账和期限台账，列出临近的答辩、举证、开庭、上诉期限和停滞的案件", title: "案件进度监控", cadence: "daily", registers: ["cases", "deadlines"], skills: ["litigation-legal:deadline-tracker"] },
  "legal-research-cn:law-change-watch": { blurb: "每周把资料库同步到的法规变化和你关注的法规、手上的事项对照，列出需要律师核验的变化线索", title: "法源变化监控", cadence: "weekly", registers: ["watched_laws"], skills: [], lawUpdates: true },
  "procurement-legal:notice-watch": { blurb: "每天检查你关注的采购项目的公开公告和澄清有没有变化，列出投标、质疑等候选期限", title: "采购公告监测", cadence: "daily", registers: ["procurement_projects"], skills: [], web: true },
  "product-legal:launch-watcher": { blurb: "每天看上线计划，把近期可能需要法务审查的功能提前挑出来，免得临上线才知道", title: "产品上线雷达", cadence: "daily", registers: ["launches"], skills: ["product-legal:launch-review"] },
  "regulatory-legal:reg-change-monitor": { blurb: "每周汇总资料库同步到的法规变化和联网查到的监管动态，按重要度过滤后写成简报", title: "法规动态监控", cadence: "weekly", registers: ["reg_watch"], skills: ["regulatory-legal:reg-feed-watcher"], lawUpdates: true, web: true },
};

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (!m) return { meta, body: text };
  let key = null, block = false;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; const v = kv[2].trim(); block = /^[>|][-+]?$/.test(v); meta[key] = block ? "" : v.replace(/^["']|["']$/g, ""); }
    else if (key && block) meta[key] += (meta[key] ? " " : "") + line.trim();
  }
  for (const k of Object.keys(meta)) meta[k] = meta[k].replace(/\s+/g, " ").trim();
  return { meta, body: text.slice(m[0].length) };
}

function readmeTable() {
  const md = readFileSync(path.join(REPO, "README.md"), "utf-8");
  const sec = md.slice(md.indexOf("## Agent 列表"), md.indexOf("## 仓库布局"));
  const rows = new Map();
  for (const line of sec.split("\n")) {
    const c = line.split("|").map((s) => s.trim());
    if (c.length < 5 || !/^\*\*/.test(c[1])) continue;
    const title = c[1].replace(/\*\*/g, "").replace(/^"|"$/g, "").trim();
    const cmd = c[4].match(/`\/([a-z-]+):([a-z-]+)`/);
    if (cmd) { const k = `${cmd[1]}:${cmd[2]}`; if (!rows.has(k)) rows.set(k, { title, blurb: c[2] }); }
  }
  return rows;
}

const tidy = (s) => s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim() + "\n";

rmSync(OUT, { recursive: true, force: true });
for (const d of ["skills", "profiles", "watchers", "references"]) mkdirSync(path.join(OUT, d), { recursive: true });

const table = readmeTable();
const agents = [], skillsIndex = {};
const plugins = readdirSync(REPO).filter((p) => existsSync(path.join(REPO, p, ".claude-plugin/plugin.json")) && AREAS[p]);

for (const p of plugins) {
  const dir = path.join(REPO, p);
  // 实务画像模板
  if (existsSync(path.join(dir, "CLAUDE.md"))) writeFileSync(path.join(OUT, "profiles", p + ".md"), tidy(readFileSync(path.join(dir, "CLAUDE.md"), "utf-8")));
  // 参考资料
  const refDir = path.join(dir, "references");
  if (existsSync(refDir)) for (const f of readdirSync(refDir)) {
    const fp = path.join(refDir, f);
    if (!f.endsWith(".md") || !statSync(fp).size) continue;
    mkdirSync(path.join(OUT, "references", p), { recursive: true });
    writeFileSync(path.join(OUT, "references", p, f), tidy(readFileSync(fp, "utf-8")));
  }
  // 技能
  const sdir = path.join(dir, "skills");
  for (const s of existsSync(sdir) ? readdirSync(sdir).sort() : []) {
    const f = path.join(sdir, s, "SKILL.md");
    if (!existsSync(f)) continue;
    const { meta, body } = frontmatter(readFileSync(f, "utf-8"));
    const key = `${p}:${s}`;
    mkdirSync(path.join(OUT, "skills", p), { recursive: true });
    writeFileSync(path.join(OUT, "skills", p, s + ".md"), tidy(body));
    // 技能目录里的其他 md（模板、示例）
    for (const extra of readdirSync(path.join(sdir, s))) {
      if (extra === "SKILL.md" || !extra.endsWith(".md")) continue;
      writeFileSync(path.join(OUT, "skills", p, `${s}--${extra}`), tidy(readFileSync(path.join(sdir, s, extra), "utf-8")));
    }
    skillsIndex[key] = { plugin: p, skill: s, description: (meta.description || "").slice(0, 400), config: CONFIG.has(s) };
    if (CONFIG.has(s) || DEPRECATED.has(key) || REFERENCE_ONLY.has(key)) continue;
    const t = EXTRA[key] || table.get(key);
    if (!t) throw new Error(`没有中文名：${key}（在 scripts/build-agents.mjs 的 EXTRA 里补上）`);
    const [title, blurb] = Array.isArray(t) ? t : [t.title, t.blurb];
    agents.push({ id: key, kind: "task", plugin: p, area: AREAS[p], title, blurb, skills: [key], description: skillsIndex[key].description });
  }
  // 定时 Agent
  const adir = path.join(dir, "agents");
  for (const a of existsSync(adir) ? readdirSync(adir).filter((x) => x.endsWith(".md")).sort() : []) {
    const key = `${p}:${a.replace(/\.md$/, "")}`;
    const w = WATCHERS[key];
    if (!w) continue;
    const { meta, body } = frontmatter(readFileSync(path.join(adir, a), "utf-8"));
    mkdirSync(path.join(OUT, "watchers", p), { recursive: true });
    writeFileSync(path.join(OUT, "watchers", p, a), tidy(body));
    agents.push({ id: key, kind: "watch", plugin: p, area: AREAS[p], title: w.title, blurb: w.blurb,
      skills: w.skills, cadence: w.cadence, registers: w.registers, files: !!w.files, lawUpdates: !!w.lawUpdates, web: !!w.web, description: meta.description || "" });
  }
}
// 拆开的虚拟 Agent（保密协议分流等）
for (const a of agents) if (VIRTUAL[a.id]) a.skills = VIRTUAL[a.id].skills;
for (const [k, v] of Object.entries(VIRTUAL)) if (!agents.some((a) => a.id === k)) {
  const [title, blurb] = EXTRA[k];
  agents.push({ id: k, kind: "task", plugin: k.split(":")[0], area: AREAS[k.split(":")[0]], title, blurb, skills: v.skills, description: skillsIndex[v.skills[1]]?.description || "" });
}
// 共用参考框架挂到使用它的 Agent 上
for (const [ref, users] of Object.entries(COMPANION)) for (const u of users) {
  const a = agents.find((x) => x.id === u);
  if (a && !a.skills.includes(ref)) a.skills.push(ref);
}
for (const a of agents) for (const s of a.skills) if (!skillsIndex[s]) throw new Error(`${a.id} 引用了不存在的技能 ${s}`);

const order = Object.keys(AREAS);
agents.sort((x, y) => order.indexOf(x.plugin) - order.indexOf(y.plugin) || (x.kind === y.kind ? 0 : x.kind === "task" ? -1 : 1));
writeFileSync(path.join(OUT, "roster.json"), JSON.stringify({ areas: AREAS, agents, skills: skillsIndex }, null, 1) + "\n");
const n = (k) => agents.filter((a) => a.kind === k).length;
console.log(`命名 Agent ${n("task")} 个，定时 Agent ${n("watch")} 个，技能 ${Object.keys(skillsIndex).length} 个，实务画像模板 ${readdirSync(path.join(OUT, "profiles")).length} 个`);
