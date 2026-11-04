// 构建数据包时，在 data/base.db 上做官方核对。
//   node scripts/official-sync.mjs                 全面核对（访问官方网站）
//   node scripts/official-sync.mjs --incremental   只看各网站最近几页
//   node scripts/official-sync.mjs --replay        不访问网站，把上次抓到的官方文本重新并入（base.db 重建之后用）
//   --only npc,moj,court,cases                     只处理这些来源
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runSync, ensureUserTables } from "../server/official/sync.mjs";
import { applyOfficialDoc, promotePending, ensureOfficialColumns } from "../server/official/apply.mjs";
import { upsertCase } from "../server/official/cases.mjs";
import { moj } from "../server/official/sources.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, "..", "data");
const args = process.argv.slice(2);
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(",") : undefined;

const legalDb = new DatabaseSync(path.join(data, "base.db"));
// 构建时的抓取记录单独存放，不进安装包
const userDb = new DatabaseSync(path.join(data, "build-sync.db"));
ensureUserTables(userDb);
ensureOfficialColumns(legalDb);

if (args.includes("--replay")) {
  const rows = userDb.prepare("SELECT url, source, record FROM official_docs ORDER BY fetched_at").all()
    .filter((r) => !only || only.includes(r.source));
  userDb.exec("DELETE FROM update_log");
  const logIns = userDb.prepare("INSERT INTO update_log(at, source, action, title, doc_id, compare_to, url, summary, diff) VALUES(?,?,?,?,?,?,?,?,?)");
  const save = userDb.prepare("UPDATE official_docs SET record = ?, title = ? WHERE url = ?");
  for (const r of rows) {
    let rec = JSON.parse(r.record);
    if (r.source === "cases") { upsertCase(legalDb, rec); continue; }
    // 早先解析时混进了页面上的「历史沿革」字样：重新读取这一页
    if (r.source === "moj" && !rec.articles.length && /历史沿革/.test(rec.fulltext)) {
      rec = await moj.fetch({ url: r.url, title: rec.title });
      save.run(JSON.stringify(rec), rec.title, r.url);
    }
    const res = applyOfficialDoc(legalDb, rec);
    logIns.run(new Date().toISOString(), r.source, res.action, res.title || rec.title, res.doc_id || "", res.compare_to || "", r.url,
      res.summary || "", res.diff ? JSON.stringify(res.diff) : "");
  }
  promotePending(legalDb);
  console.log(`重放 ${rows.length} 份官方文本`);
} else {
  let last = 0;
  const stats = await runSync({
    legalDb, userDb, mode: args.includes("--incremental") ? "incremental" : "full", only,
    onProgress: (p) => {
      if (Date.now() - last > 15000 || p.done) {
        last = Date.now();
        console.log(`[${new Date().toLocaleTimeString("zh-CN")}] ${p.phase} 已看 ${p.checked} 已抓 ${p.fetched} 变化 ${p.changes} 出错 ${p.errors}${p.current ? " · " + p.current : ""}`);
      }
    },
  });
  console.log(stats);
}
for (const c of userDb.prepare("SELECT source, action, count(*) n FROM update_log GROUP BY source, action ORDER BY source, n DESC").all()) {
  console.log(`  ${c.source}\t${c.action}\t${c.n}`);
}
// 记下已核对过的官方页面，app 里的增量检查会跳过它们
legalDb.exec("DROP TABLE IF EXISTS official_seen; CREATE TABLE official_seen(url TEXT PRIMARY KEY, source TEXT, fetched_at TEXT)");
const seenIns = legalDb.prepare("INSERT OR REPLACE INTO official_seen VALUES(?,?,?)");
for (const r of userDb.prepare("SELECT url, source, fetched_at FROM official_docs").all()) seenIns.run(r.url, r.source, r.fetched_at);
legalDb.prepare("INSERT INTO meta(key, value) VALUES('official_checked', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  .run(new Date().toISOString().slice(0, 10));
legalDb.exec("VACUUM");
legalDb.close();
userDb.close();
