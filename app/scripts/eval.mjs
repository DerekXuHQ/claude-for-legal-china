// 评测：用 eval/cases.jsonl 跑法律助理的完整流程，再由评分模型按评分要点打分。
// 用法：node scripts/eval.mjs --model gpt-6-luna --depth medium [--judge claude-opus-5-5] [--only emp-01,con-01] [--concurrency 3]
// 需要：已安装的 app 建好的资料库（含全文索引）和 settings.json（API key、接口地址）。
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as search from "../server/search.mjs";
import { ask, newConversation } from "../server/ai/ask.mjs";
import { intakeQuestions, routeTask } from "../server/ai/router.mjs";
import { completeJSON, listModels } from "../server/ai/models.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const model = arg("model", "gpt-6-luna"), depth = arg("depth", "medium"), judge = arg("judge", "claude-opus-5-5");
const only = arg("only", "") ? arg("only").split(",") : null;
const concurrency = Number(arg("concurrency", 3));

const dataDir = arg("data", path.join(os.homedir(), "Library/Application Support/中国法律检索/data"));
const settings = JSON.parse(readFileSync(path.join(dataDir, "settings.json"), "utf-8"));
const db = new DatabaseSync(path.join(dataDir, "legal.db"), { readOnly: true });
search.setDb(db);
const available = await listModels(settings);

const cases = readFileSync(path.join(here, "..", "eval", "cases.jsonl"), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  .filter((c) => !only || only.includes(c.id));

async function runCase(c) {
  const t0 = Date.now();
  const ctx = { question: c.question, region: c.region, attachments: c.attachment ? [{ name: "附件.txt", text: c.attachment }] : [], history: [] };
  // 分流和追问单独记录：看它会不会问对问题
  const route = await routeTask(settings, model, ctx, undefined);
  const intake = await intakeQuestions(settings, model, route, ctx, undefined);
  // 然后跳过追问，按现有信息作答（评分时看它有没有写明假设、点到缺的事实）
  const conv = newConversation();
  const steps = [];
  const r = await ask(settings, {
    conv, question: c.question, region: c.region, attachments: ctx.attachments, model, depth, available, db,
    skipIntake: true, emit: (ev) => {
      if (ev.type === "step" || ev.type === "stage") {
        steps.push(ev.text);
        if (process.argv.includes("--verbose")) console.log(`  [${c.id} ${Math.round((Date.now() - t0) / 1000)}s] ${ev.text}`);
      }
    },
  });
  const seconds = Math.round((Date.now() - t0) / 1000);
  const score = await completeJSON(settings, {
    model: judge, effort: "medium",
    system: `你是资深中国执业律师，负责给法律助理的工作打分。按评分要点逐项判断，严格但公正。只输出 JSON：
{"identify": 0-10 (must_identify 命中程度和正确性), "cite": 0-10 (must_cite 是否引用、引用是否准确支持结论), "ask": 0-10 (追问问题加上答案中写明的假设，是否覆盖 must_ask), "errors": ["答案中出现的 must_not 错误或其他实质性法律错误"], "usefulness": 0-10 (能否直接拿去用：结论明确、可执行、有金额/期限/文书), "overall": 0-10, "comment": "两三句评语"}`,
    user: `## 题目\n地区：${c.region || "未说明"}\n${c.question}\n${c.attachment ? "\n## 附件\n" + c.attachment : ""}\n\n## 评分要点\nmust_identify：${c.must_identify.join("；")}\nmust_cite：${c.must_cite.join("；")}\nmust_ask：${c.must_ask.join("；")}\nmust_not：${c.must_not.join("；")}\n优秀答案：${c.notes}\n\n## 助理的分流\n任务：${route.task}（期望 ${c.task}）\n追问的问题：${intake.questions.map((q) => q.question).join("；") || "（未追问）"}\n\n## 助理的答案\n${r.text}`,
  });
  return { id: c.id, task: c.task, routed: route.task, intake: intake.questions.map((q) => q.question), seconds, steps: steps.length, answer: r.text, score };
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
  while (next < cases.length) {
    const c = cases[next++];
    try {
      const r = await runCase(c);
      results.push(r);
      console.log(`${c.id}\t${r.routed === c.task ? "分流✓" : "分流✗ " + r.routed}\t总分 ${r.score.overall}\t要点 ${r.score.identify} 引用 ${r.score.cite} 追问 ${r.score.ask} 可用 ${r.score.usefulness}\t${r.seconds}s\t错误 ${r.score.errors?.length || 0}`);
    } catch (err) {
      console.log(`${c.id}\t出错：${String(err.message || err).slice(0, 200)}`);
      results.push({ id: c.id, error: String(err.message || err) });
    }
  }
}));

const ok = results.filter((r) => r.score);
const avg = (k) => (ok.reduce((s, r) => s + (Number(r.score[k]) || 0), 0) / (ok.length || 1)).toFixed(2);
const summary = { model, depth, judge, cases: results.length, routed_ok: ok.filter((r) => r.routed === r.task).length,
  overall: avg("overall"), identify: avg("identify"), cite: avg("cite"), ask: avg("ask"), usefulness: avg("usefulness"),
  avg_seconds: Math.round(ok.reduce((s, r) => s + r.seconds, 0) / (ok.length || 1)), errors: ok.reduce((s, r) => s + (r.score.errors?.length || 0), 0) };
console.log("\n汇总", JSON.stringify(summary));
const outDir = path.join(here, "..", "eval", "results");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
writeFileSync(path.join(outDir, `${stamp}-${model}-${depth}.json`), JSON.stringify({ summary, results }, null, 1));
