// 台账、实务画像、定时 Agent 的运行记录。都存在 user.db，只在本机。
import { randomUUID } from "node:crypto";

// 台账：Agent 读写的登记册。fields 是建议字段（界面按它排列），记录可以有别的字段。
export const REGISTERS = {
  contracts: { name: "合同台账", plugin: "commercial-legal", fields: ["对方", "合同名称", "类型", "签署日", "生效日", "到期日", "自动续期", "取消通知天数", "取消截止日", "年金额", "我方负责人", "状态"] },
  deviations: { name: "偏离日志", plugin: "commercial-legal", fields: ["合同", "条款", "指引立场", "实际接受", "原因", "批准人", "日期"] },
  playbook_proposals: { name: "审查指引修订建议", plugin: "commercial-legal", fields: ["条款", "现行立场", "建议立场", "依据（偏离次数）", "状态"] },
  closing_items: { name: "交割清单", plugin: "corporate-legal", fields: ["事项", "类别", "负责人", "截止日", "状态", "备注"] },
  entities: { name: "主体合规台账", plugin: "corporate-legal", fields: ["主体", "类型", "登记机关", "年报截止", "下次事项", "状态"] },
  leaves: { name: "假期台账", plugin: "employment-legal", fields: ["员工", "假期类型", "开始日", "预计结束日", "法定期限", "下一个决定点", "状态"] },
  investigations: { name: "调查日志", plugin: "employment-legal", fields: ["调查", "日期", "类型", "来源", "内容摘要", "关联人员"] },
  ip_assets: { name: "知识产权组合", plugin: "ip-legal", fields: ["类型", "名称/标识", "注册号", "类别", "申请日", "注册日", "到期日", "下次续展/年费", "权利人", "状态"] },
  cases: { name: "案件台账", plugin: "litigation-legal", fields: ["案件", "案号", "法院/仲裁机构", "我方地位", "对方", "标的额", "阶段", "下一节点", "风险评估", "状态"] },
  deadlines: { name: "期限台账", plugin: "litigation-legal", fields: ["案件", "事项", "截止日", "依据", "负责人", "状态"] },
  dsar: { name: "个人信息权利请求", plugin: "privacy-legal", fields: ["请求人", "请求类型", "收到日", "答复截止日", "状态"] },
  ai_systems: { name: "AI 系统台账", plugin: "ai-governance-legal", fields: ["系统", "用途", "我方角色", "风险等级", "备案/评估义务", "状态"] },
  gaps: { name: "合规差距", plugin: "regulatory-legal", fields: ["来源法规", "差距", "涉及制度", "负责人", "截止日", "状态"] },
  comments: { name: "征求意见追踪", plugin: "regulatory-legal", fields: ["草案", "发布机关", "意见截止日", "是否提交", "状态"] },
  reg_watch: { name: "监管关注清单", plugin: "regulatory-legal", fields: ["领域/机关", "关注事项", "重要度阈值"] },
  watched_laws: { name: "关注的法规", plugin: "legal-research-cn", fields: ["法规名称", "关注原因", "关联事项"] },
  procurement_projects: { name: "采购项目", plugin: "procurement-legal", fields: ["项目", "采购人", "公告网址", "投标截止", "质疑截止", "状态"] },
  launches: { name: "上线计划", plugin: "product-legal", fields: ["功能/产品", "上线日", "负责人", "涉及数据/营销", "法务审查", "状态"] },
};

const now = () => Date.now() / 1000;

export function ensureRegisterTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registers(id TEXT PRIMARY KEY, kind TEXT, data TEXT, source TEXT DEFAULT '', matter_id TEXT DEFAULT '', created REAL, updated REAL);
    CREATE INDEX IF NOT EXISTS idx_reg_kind ON registers(kind);
    CREATE TABLE IF NOT EXISTS profiles(plugin TEXT PRIMARY KEY, text TEXT, updated REAL);
    CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, agent TEXT, started REAL, finished REAL, status TEXT, summary TEXT, text TEXT, steps TEXT DEFAULT '[]', seen INT DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent, started);
  `);
  // 第 17 版的定时 Agent id 没有 watch: 前缀（agent_runs 里只有定时 Agent 的运行记录）
  db.prepare("UPDATE agent_runs SET agent = 'watch:' || agent WHERE agent NOT LIKE 'watch:%'").run();
  // 上次退出或崩溃时还没跑完的，标成中断（不然界面一直显示「运行中」）
  db.prepare("UPDATE agent_runs SET status = 'error', summary = '运行被中断（app 退出）', finished = started WHERE status = 'running'").run();
}

const row = (r) => ({ id: r.id, ...JSON.parse(r.data || "{}"), _source: r.source, _updated: r.updated });

const isReg = (kind) => typeof kind === "string" && Object.hasOwn(REGISTERS, kind);

export function queryRegister(db, kind, keyword = "") {
  if (!isReg(kind)) return { error: `没有这个台账：${kind}` };
  let rows = db.prepare("SELECT * FROM registers WHERE kind = ? ORDER BY updated DESC").all(kind).map(row);
  if (keyword) rows = rows.filter((r) => JSON.stringify(r).includes(keyword));
  return { register: REGISTERS[kind].name, count: rows.length, today: new Date().toISOString().slice(0, 10), rows: rows.slice(0, 300) };
}

export function writeRegister(db, kind, data, { id = "", source = "", matterId = "" } = {}) {
  if (!isReg(kind)) return { error: `没有这个台账：${kind}` };
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "data 必须是对象" };
  const clean = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("_") && k !== "id").map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v]));
  let old = id ? db.prepare("SELECT * FROM registers WHERE id = ? AND kind = ?").get(id, kind) : null;
  // 没带 id、但前两个字段（例如合同台账的「对方」「合同名称」）和已有记录相同：视为同一条，更新它
  const key = REGISTERS[kind].fields.slice(0, 2);
  const norm = (v) => String(v ?? "").replace(/\s+/g, "");
  if (!old && key.every((k) => norm(clean[k]))) {
    old = db.prepare("SELECT * FROM registers WHERE kind = ?").all(kind).find((r) => { const d = JSON.parse(r.data || "{}"); return key.every((k) => norm(d[k]) === norm(clean[k])); }) || null;
    if (old) id = old.id;
  }
  if (old) {
    db.prepare("UPDATE registers SET data = ?, source = ?, updated = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(old.data || "{}"), ...clean }), source || old.source, now(), id);
    return { ok: true, id, updated: true };
  }
  const nid = randomUUID().slice(0, 8);
  db.prepare("INSERT INTO registers(id, kind, data, source, matter_id, created, updated) VALUES(?,?,?,?,?,?,?)").run(nid, kind, JSON.stringify(clean), source, matterId, now(), now());
  return { ok: true, id: nid, created: true };
}

export function deleteRegister(db, kind, id) {
  if (!isReg(kind)) return { error: `没有这个台账：${kind}` };
  const r = db.prepare("DELETE FROM registers WHERE id = ? AND kind = ?").run(id, kind);
  return { ok: r.changes > 0 };
}

export const registerCounts = (db) => Object.fromEntries(db.prepare("SELECT kind, count(*) n FROM registers GROUP BY kind").all().map((r) => [r.kind, r.n]));

export const getProfile = (db, plugin) => db.prepare("SELECT * FROM profiles WHERE plugin = ?").get(plugin) || null;
export function saveProfile(db, plugin, text) {
  db.prepare("INSERT INTO profiles(plugin, text, updated) VALUES(?,?,?) ON CONFLICT(plugin) DO UPDATE SET text = excluded.text, updated = excluded.updated").run(plugin, text, now());
}
export const deleteProfile = (db, plugin) => db.prepare("DELETE FROM profiles WHERE plugin = ?").run(plugin);

/** 最近一次成功的运行（排期和「自上次以来」都以它为准）。 */
export function lastDone(db, agent) {
  return db.prepare("SELECT id, agent, started, finished, status, summary FROM agent_runs WHERE agent = ? AND status = 'done' ORDER BY started DESC LIMIT 1").get(agent) || null;
}
export function lastRun(db, agent) {
  return db.prepare("SELECT id, agent, started, finished, status, summary, seen FROM agent_runs WHERE agent = ? ORDER BY started DESC LIMIT 1").get(agent) || null;
}
export const listRuns = (db, agent = "", limit = 50) => (agent
  ? db.prepare("SELECT id, agent, started, finished, status, summary, seen FROM agent_runs WHERE agent = ? ORDER BY started DESC LIMIT ?").all(agent, limit)
  : db.prepare("SELECT id, agent, started, finished, status, summary, seen FROM agent_runs ORDER BY started DESC LIMIT ?").all(limit));
export const getRun = (db, id) => db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) || null;
