// 定时 Agent：app 开着时按频率在后台跑（续约、期限、假期、知识产权续展、法规变化……），结果存进 agent_runs，并发系统通知。
// 台账是空的就不跑（不花钱）；用户可以在 Agent 页关掉某个定时 Agent，或点「立即运行」。
import { randomUUID } from "node:crypto";
import { loadRoster, getAgent, agentSystem, AGENT_TOOLS, AGENT_STEP_LABEL, runAgentTool } from "./roster.mjs";
import { runAgent, SYSTEM_PROMPT } from "./agent.mjs";
import { queryRegister, lastRun, lastDone, REGISTERS } from "../registers.mjs";

const PERIOD = { daily: 86400, weekly: 7 * 86400 };
const running = new Set();

export const watcherList = () => loadRoster().agents.filter((a) => a.kind === "watch");

/** 这个定时 Agent 现在有没有东西可看；没有时返回原因。 */
function inputs(udb, agent, since) {
  const parts = [], empty = [];
  for (const k of agent.registers || []) {
    const r = queryRegister(udb, k);
    if (r.count) parts.push(`## 台账：${REGISTERS[k].name}（${k}，${r.count} 条）\n${JSON.stringify(r.rows, null, 0).slice(0, 60000)}`);
    else empty.push(REGISTERS[k].name);
  }
  if (agent.lawUpdates) {
    let rows = [];
    try { rows = udb.prepare("SELECT at, source, action, title, doc_id, url, summary FROM update_log WHERE at > ? ORDER BY id DESC LIMIT 60").all(new Date((since || 0) * 1000).toISOString()); } catch { /* 还没同步过 */ }
    if (rows.length) parts.push(`## 资料库自上次运行以来同步到的法规变化（官方来源）\n${rows.map((r) => `- ${r.at?.slice(0, 10)}｜${r.action}｜${r.title}${r.doc_id ? `（${r.doc_id}）` : ""}${r.summary ? "：" + String(r.summary).slice(0, 300) : ""}`).join("\n")}`);
  }
  if (agent.files) {
    const rows = udb.prepare("SELECT f.name, f.chars, f.created, m.title matter FROM matter_files f JOIN matters m ON m.id = f.matter_id WHERE f.created > ? ORDER BY f.created DESC LIMIT 200").all(since || 0);
    if (rows.length) parts.push(`## 自上次运行以来各事项新增的文件（相当于数据室新上传）\n${rows.map((r) => `- ${r.matter}｜${r.name}｜${r.chars} 字｜${new Date(r.created * 1000).toISOString().slice(0, 10)}`).join("\n")}`);
  }
  return { parts, empty };
}

/** 运行一次。force 为 true 时（用户点「立即运行」）台账空也跑，让 Agent 告诉用户要先录什么。 */
export async function runWatcher(settings, { udb, model, id, force = false, emit = () => {}, notify = () => {}, signal }) {
  const agent = getAgent(id);
  if (!agent || agent.kind !== "watch") throw new Error("没有这个定时 Agent");
  if (running.has(id)) throw new Error("这个 Agent 正在运行");
  const prev = lastDone(udb, id);
  const { parts, empty } = inputs(udb, agent, prev?.started || 0);
  if (!parts.length && !force) return { skipped: `台账为空（${empty.join("、")}）` };
  running.add(id);
  const runId = randomUUID().slice(0, 12);
  const started = Date.now() / 1000;
  udb.prepare("INSERT INTO agent_runs(id, agent, started, status, summary, text) VALUES(?,?,?,?,?,?)").run(runId, id, started, "running", "", "");
  const steps = [];
  const em = (ev) => { if (ev.type === "step") steps.push({ t: ev.text, k: ev.kind || "", d: ev.detail || "" }); emit(ev); };
  try {
    const content = [
      `[今天是 ${new Date().toISOString().slice(0, 10)}。这是定时运行${prev ? `，上次运行在 ${new Date(prev.started * 1000).toISOString().slice(0, 10)}` : "，第一次运行"}。]`,
      ...parts,
      empty.length ? `## 空的台账\n${empty.join("、")}：还没有记录。报告里告诉用户需要录入什么（可以把合同、清单上传到事项里让对应的 Agent 自动登记，或在「台账」里手动添加）。` : "",
      "## 要求\n按 Agent 说明的输出格式写这一期报告。第一行写一句不超过 40 字的摘要（例如「3 份合同 14 天内须决定是否取消」或「本周无到期事项」），作为系统通知的内容。",
    ].filter(Boolean).join("\n\n");
    const r = await runAgent(settings, {
      model, effort: "medium", system: agentSystem(udb, agent, SYSTEM_PROMPT), steps: 14, emit: em, signal, stream: false, label: agent.title,
      messages: [{ role: "user", content }],
      extra: { tools: AGENT_TOOLS, labels: AGENT_STEP_LABEL, run: (name, args) => runAgentTool(udb, agent, name, args) },
    });
    const text = r.text || "";
    const summary = text.split("\n").map((l) => l.replace(/[#*>`]/g, "").trim()).find((l) => l.length > 2)?.slice(0, 80) || "已运行";
    udb.prepare("UPDATE agent_runs SET finished = ?, status = 'done', summary = ?, text = ?, steps = ? WHERE id = ?").run(Date.now() / 1000, summary, text, JSON.stringify(steps), runId);
    notify({ title: agent.title, body: summary, runId });
    return { runId, summary };
  } catch (err) {
    udb.prepare("UPDATE agent_runs SET finished = ?, status = 'error', summary = ? WHERE id = ?").run(Date.now() / 1000, String(err.message || err).slice(0, 200), runId);
    throw err;
  } finally {
    running.delete(id);
  }
}

/** 到期的定时 Agent 依次跑一遍（app 启动后和每 30 分钟检查一次）。 */
export async function tick(getSettings, { udb, notify }) {
  for (const a of watcherList()) {
    // 每个 Agent 跑之前重新读设置：用户中途关掉的，不再跑
    const settings = getSettings();
    if (!settings.api_key || !settings.model || settings.watchers_off) return;
    if ((settings.watchers_disabled || {})[a.id]) continue;
    const model = settings.model;
    const done = lastDone(udb, a.id), last = lastRun(udb, a.id);
    const now = Date.now() / 1000;
    if (done && now - done.started < (PERIOD[a.cadence] || PERIOD.weekly) - 600) continue;
    // 上次出错的，至少隔 2 小时再试
    if (last && last.status === "error" && now - last.started < 7200) continue;
    try { await runWatcher(settings, { udb, model, id: a.id, notify }); } catch (e) { console.error("watcher", a.id, e.message); }
  }
}

export const isRunning = (id) => running.has(id);
