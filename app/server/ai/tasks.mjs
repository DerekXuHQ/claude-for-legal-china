// 任务手册：server/ai/tasks/<id>.md。分流时用 frontmatter（适用情形、示例），回答时把正文放进系统提示。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PIPELINES, GROUP_DOMAIN } from "./pipelines.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "tasks");
let cache = null;

function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (m) {
    let key = null;
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/);
      if (kv) {
        key = kv[1];
        meta[key] = kv[2].trim() || [];
      } else if (key && /^\s*-\s+/.test(line)) {
        if (!Array.isArray(meta[key])) meta[key] = meta[key] ? [meta[key]] : [];
        meta[key].push(line.replace(/^\s*-\s+/, "").trim());
      }
    }
  }
  return { meta, body: m ? text.slice(m[0].length).trim() : text.trim() };
}

/** 从「先弄清的事实」表格里取出追问清单。 */
function intakeRows(body) {
  const sec = body.match(/##\s*先弄清的事实\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!sec) return [];
  return sec[1].split("\n")
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
    .map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
    .filter((c) => c.length >= 3 && c[0] && c[0] !== "事实")
    .map(([fact, ask, why, required]) => ({ fact, ask, why, required: /是|必需|必须/.test(required || "") }));
}

const STRATEGY = () => { const p = path.join(DIR, "_strategy.md"); return existsSync(p) ? readFileSync(p, "utf-8").trim() : ""; };
const GOAL_ROW = { fact: "处理目标", ask: "这件事您想怎么收场：尽快花钱了结 / 据理力争、一分不多给（不想开先例）/ 先谈，谈不拢再打？能接受的大致金额或底线是多少？", why: "决定打法：和解方案还是全程应诉，谈判开价和底线", required: true };

export function loadTasks() {
  if (cache) return cache;
  cache = new Map();
  if (!existsSync(DIR)) return cache;
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith(".md") || f === "README.md" || f === "contract-checklists.md" || f.startsWith("_")) continue;
    const { meta, body: own } = parse(readFileSync(path.join(DIR, f), "utf-8"));
    const id = meta.id || f.replace(/\.md$/, "");
    // 争议类（frontmatter 写 strategy: yes）：附上共用的「策略与打法」，追问里加上「处理目标」
    const strategy = /^(yes|true|是)$/i.test(String(meta.strategy || ""));
    const body = strategy ? `${own}\n\n${STRATEGY()}` : own;
    const intake = intakeRows(own);
    if (strategy) intake.unshift(GOAL_ROW);
    cache.set(id, { id, name: meta.name || id, when: meta.when || "", examples: Array.isArray(meta.examples) ? meta.examples : [], body, intake, strategy });
  }
  return cache;
}

export function getTask(id) {
  const sc = getScenario(id);
  if (sc) return sc;
  const tasks = loadTasks();
  return tasks.get(id) || tasks.get("general") || { id: "general", name: "法律咨询", when: "", examples: [], body: "", intake: [] };
}

// 和命名 Agent 做同一件事、而 Agent 做得更完整的场景：选中这个场景时交给 Agent 办
export const SCENARIO_HANDOFF = {
  nda_review: "commercial-legal:nda-triage",
  employee_handbook_rules: "employment-legal:policy-drafting",
  worker_classification: "employment-legal:worker-classification",
  received_ip_infringement_notice: "ip-legal:cease-desist",
  privacy_policy_app_compliance: "privacy-legal:privacy-policy",
  ad_copy_review: "product-legal:marketing-claims-review",
  labor_arbitration_respondent: "employment-legal:labor-arbitration",
  draft_cooperation_from_scratch: "commercial-legal:contract-drafting",
};

// ---- 场景目录：99 个具体场景（scenarios.json，由 scripts/build-scenarios.mjs 从调研文档生成）----
let scenarioCache = null;
export function scenarioCatalog() {
  if (scenarioCache) return scenarioCache;
  const p = path.join(path.dirname(DIR), "scenarios.json");
  scenarioCache = existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : { groups: [], scenarios: [] };
  for (const x of scenarioCache.scenarios) if (SCENARIO_HANDOFF[x.id]) x.agent = SCENARIO_HANDOFF[x.id];
  scenarioCache.byId = new Map(scenarioCache.scenarios.map((x) => [x.id, x]));
  return scenarioCache;
}

const DOMAIN_BY_PIPE = { P1: "dispute_defense", P2: "claim_feasibility", P3: "claim_feasibility", P5: "contract_review", P6: "drafting", P7: "drafting", P8: "legality", P9: "admin_enforcement", P10: "criminal_risk", P11: "regulation_lookup", P12: "deadline", P13: "drafting" };
const clipBody = (s, n) => (s.length > n ? s.slice(0, n) + "\n……" : s);

/** 场景 = 工作流程步骤 + 场景卡片 + 策略（争议类）+ 领域手册。 */
export function getScenario(id) {
  const sc = scenarioCatalog().byId.get(id);
  if (!sc) return null;
  const P = PIPELINES[sc.pipeline] || PIPELINES.P8;
  const domainId = ["B", "C", "N", "O"].includes(sc.group) ? DOMAIN_BY_PIPE[sc.pipeline] : GROUP_DOMAIN[sc.group];
  const domain = loadTasks().get(domainId);
  const STRUCT = { P1: "B", P9: "B", P2: "C", P3: "C", P4: "D", P12: "E", P6: "F", P7: "F", P13: "F", P8: "A", P11: "A", P10: "A" };
  const struct = sc.pipeline === "P5" ? "输出按「合同与方案审查」的结构。" : `输出按「结构 ${STRUCT[sc.pipeline] || "A"}」（见输出约定）。`;
  const card = [
    `## 工作流程：${P.name}`, P.steps, struct,
    `## 这件事属于：${sc.name}（${sc.group_name}）`,
    sc.examples.length ? `用户常见的说法：${sc.examples.map((x) => `「${x}」`).join("；")}` : "",
    `**要弄清的事实**：${sc.facts.join("；")}`,
    `**主要依据**（名称，条文要检索原文确认）：${sc.laws}`,
    sc.goals ? `**客户的目标与可选立场**：${sc.goals}` : "",
    sc.strategy ? `**合法的策略与筹码**：\n${sc.strategy}` : "",
    sc.deliverables ? `**交付物**：${sc.deliverables}` : "",
    P.strategy ? STRATEGY() : "",
    domain ? `## 领域手册：${domain.name}\n${clipBody(domain.body.replace(/\n## 策略与打法[\s\S]*$/, ""), 9000)}` : "",
  ].filter(Boolean).join("\n\n");
  const intake = sc.facts.map((f) => ({ fact: f, ask: f, why: "", required: true }));
  if (P.strategy && !sc.facts.some((f) => /目标|底线/.test(f))) intake.push(GOAL_ROW);
  return {
    id: sc.id, name: sc.name, code: sc.code, group: sc.group, pipeline: sc.pipeline, pipelineName: P.name,
    runner: P.runner || "agent", needsDoc: !!P.needsDoc, strategy: !!P.strategy, scenario: true,
    when: sc.workflow, examples: sc.examples, body: card, intake,
  };
}

export function contractChecklists() {
  const p = path.join(DIR, "contract-checklists.md");
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}
