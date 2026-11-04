// 任务手册：server/ai/tasks/<id>.md。分流时用 frontmatter（适用情形、示例），回答时把正文放进系统提示。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function loadTasks() {
  if (cache) return cache;
  cache = new Map();
  if (!existsSync(DIR)) return cache;
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith(".md") || f === "README.md" || f === "contract-checklists.md") continue;
    const { meta, body } = parse(readFileSync(path.join(DIR, f), "utf-8"));
    const id = meta.id || f.replace(/\.md$/, "");
    cache.set(id, { id, name: meta.name || id, when: meta.when || "", examples: Array.isArray(meta.examples) ? meta.examples : [], body, intake: intakeRows(body) });
  }
  return cache;
}

export function getTask(id) {
  const tasks = loadTasks();
  return tasks.get(id) || tasks.get("general") || { id: "general", name: "法律咨询", when: "", examples: [], body: "", intake: [] };
}

export function contractChecklists() {
  const p = path.join(DIR, "contract-checklists.md");
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}
