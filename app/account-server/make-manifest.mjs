// 给本机小模型目录生成 manifest.json（每个文件的大小和 sha256）。
// 用法：node make-manifest.mjs <模型目录> [名称] [版本]
// 例：node make-manifest.mjs data/local-model qwen3-0.6b-4bit 2026-11-14
import { readdirSync, statSync, createReadStream, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const dir = path.resolve(process.argv[2] || "data/local-model");
const name = process.argv[3] || path.basename(dir);
const version = process.argv[4] || new Date().toISOString().slice(0, 10);
const sha = (f) => new Promise((ok, bad) => { const h = createHash("sha256"); createReadStream(f).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", bad); });

const files = [];
for (const n of readdirSync(dir).sort()) {
  const f = path.join(dir, n);
  if (n.startsWith(".") || ["manifest.json", "ready", "README.md"].includes(n) || !statSync(f).isFile()) continue;
  files.push({ name: n, size: statSync(f).size, sha256: await sha(f) });
}
const size = files.reduce((s, f) => s + f.size, 0);
const all = createHash("sha256").update(files.map((f) => f.sha256).join("")).digest("hex");
writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ name, version, size, sha256: all, files }, null, 2) + "\n");
console.log(`${files.length} 个文件，共 ${(size / 1e6).toFixed(0)} MB → ${path.join(dir, "manifest.json")}`);
