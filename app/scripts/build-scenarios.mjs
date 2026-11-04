// 从 docs/scenarios-research.md 生成场景目录 server/ai/scenarios.json。
// 用法：node scripts/build-scenarios.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(path.join(APP, "docs", "scenarios-research.md"), "utf8");

// 流水线归属：§4.1 表格
const pipeOf = {};
const table = md.slice(md.indexOf("### 4.1"), md.indexOf("### 4.2"));
for (const line of table.split("\n")) {
  const m = line.match(/^\|\s*(P\d+)\s*\|[^|]*\|[^|]*\|([^|]*)\|/);
  if (!m) continue;
  for (const code of m[2].match(/[A-O]\d{2}/g) || []) if (!pipeOf[code]) pipeOf[code] = m[1];
}

const sec = md.slice(md.indexOf("## 3. 场景目录"), md.indexOf("## 4."));
const groups = [];
let group = null;
const scenarios = [];
for (const block of sec.split(/\n(?=### |#### )/)) {
  const g = block.match(/^### ([A-O]) (.+)/);
  if (g) { group = { key: g[1], name: g[2].replace(/（.*）$/, "").trim(), full: g[2].trim() }; groups.push(group); continue; }
  const h = block.match(/^#### ([A-O]\d{2}) `([a-z0-9_]+)` (.+?)\s*｜\s*(.+?)\s*｜\s*(高|中|低)/);
  if (!h) continue;
  const field = (name) => {
    const m = block.match(new RegExp(`- \\*\\*${name}\\*\\*：([\\s\\S]*?)(?=\\n- \\*\\*|$)`));
    return m ? m[1].trim() : "";
  };
  const examples = [...field("常见说法").matchAll(/“([^”]+)”/g)].map((m) => m[1]);
  const facts = field("必问事实").replace(/。$/, "").split(/；/).map((s) => s.trim()).filter(Boolean);
  scenarios.push({
    code: h[1], id: h[2], name: h[3].trim(), workflow: h[4].trim(), freq: h[5], group: group.key, group_name: group.name,
    pipeline: pipeOf[h[1]] || "P8", examples, facts,
    laws: field("主要依据"), goals: field("目标与立场"), strategy: field("合法的策略与筹码"), deliverables: field("交付物"),
  });
}
writeFileSync(path.join(APP, "server", "ai", "scenarios.json"), JSON.stringify({ groups, scenarios }, null, 1) + "\n");
const byPipe = {};
for (const s of scenarios) byPipe[s.pipeline] = (byPipe[s.pipeline] || 0) + 1;
console.log(`${scenarios.length} 个场景，${groups.length} 组`, byPipe);
const noPipe = scenarios.filter((s) => !Object.values(pipeOf).length || !pipeOf[s.code]).map((s) => s.code);
if (noPipe.length) console.log("未在流水线表里的场景（默认 P8）：", noPipe.join(" "));
