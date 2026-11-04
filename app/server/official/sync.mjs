// 检查官方更新：逐个来源翻列表页，遇到没见过的条目就抓取全文并入本地资料库。
//
// 增量模式：每个来源只看最近几页，连续遇到 15 个已处理过的条目就停。
// 全面核对：翻完所有列表页，重新抓取 30 天内没核对过的条目。
//
// 抓到的官方文本同时存进 user.db 的 official_docs，资料库重建（例如 app 升级换了新数据包）后可以重放。
import { SOURCES } from "./sources.mjs";
import { listCases, fetchCase, upsertCase } from "./cases.mjs";
import { applyOfficialDoc, promotePending, ensureOfficialColumns } from "./apply.mjs";

export function ensureUserTables(userDb) {
  userDb.exec(`
    CREATE TABLE IF NOT EXISTS official_docs(url TEXT PRIMARY KEY, source TEXT, title TEXT, fetched_at TEXT, record TEXT);
    CREATE TABLE IF NOT EXISTS update_log(id INTEGER PRIMARY KEY, at TEXT, source TEXT, action TEXT, title TEXT,
      doc_id TEXT, compare_to TEXT, url TEXT, summary TEXT, diff TEXT);
    CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY, value TEXT);
  `);
}

const NOTEWORTHY = new Set(["new", "new_version", "text_corrected", "promoted", "case_new"]);

function log(userDb, entry) {
  userDb.prepare("INSERT INTO update_log(at, source, action, title, doc_id, compare_to, url, summary, diff) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(new Date().toISOString(), entry.source, entry.action, entry.title || "", entry.doc_id || "", entry.compare_to || "",
      entry.url || "", entry.summary || "", entry.diff ? JSON.stringify(entry.diff) : "");
}

/**
 * @param {object} o
 * @param {import('node:sqlite').DatabaseSync} o.legalDb
 * @param {import('node:sqlite').DatabaseSync} o.userDb
 * @param {"incremental"|"full"} [o.mode]
 * @param {string[]} [o.only] 只检查这些来源（npc / moj / court / cases）
 * @param {(p:object)=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 */
export async function runSync({ legalDb, userDb, mode = "incremental", only, onProgress = () => {}, signal }) {
  ensureUserTables(userDb);
  ensureOfficialColumns(legalDb);
  const full = mode === "full";
  const today = new Date().toISOString().slice(0, 10);
  const stats = { checked: 0, fetched: 0, changes: 0, errors: 0 };
  const known = new Map(userDb.prepare("SELECT url, fetched_at FROM official_docs").all().map((r) => [r.url, r.fetched_at]));
  // 数据包构建时已经核对过的官方页面（随安装包附带），不必在用户电脑上再读一遍
  if (legalDb.prepare("SELECT 1 FROM sqlite_master WHERE name = 'official_seen'").get()) {
    for (const r of legalDb.prepare("SELECT url, fetched_at FROM official_seen").all()) if (!known.has(r.url)) known.set(r.url, r.fetched_at);
  }
  const saveRecord = userDb.prepare("INSERT INTO official_docs(url, source, title, fetched_at, record) VALUES(?,?,?,?,?) " +
    "ON CONFLICT(url) DO UPDATE SET title = excluded.title, fetched_at = excluded.fetched_at, record = excluded.record");
  const stale = (url) => !known.has(url) || (full && Date.now() - Date.parse(known.get(url)) > 30 * 86400000);

  const sources = Object.values(SOURCES).filter((s) => !only || only.includes(s.key));
  for (const src of sources) {
    onProgress({ phase: src.name, ...stats });
    let knownRun = 0;
    try {
      for await (const item of src.list({ maxPages: full ? 400 : 3, signal })) {
        stats.checked++;
        if (!stale(item.url)) {
          if (!full && ++knownRun >= 15) break;
          continue;
        }
        knownRun = 0;
        onProgress({ phase: src.name, current: item.title, ...stats });
        try {
          const rec = await src.fetch(item, { signal });
          stats.fetched++;
          const res = applyOfficialDoc(legalDb, rec, today);
          saveRecord.run(item.url, src.key, rec.title, new Date().toISOString(), JSON.stringify(rec));
          known.set(item.url, new Date().toISOString());
          if (NOTEWORTHY.has(res.action)) stats.changes++;
          log(userDb, { source: src.key, url: item.url, ...res });
        } catch (err) {
          if (signal?.aborted || err.blocked) throw err;
          stats.errors++;
          log(userDb, { source: src.key, url: item.url, action: "error", title: item.title, summary: String(err.message || err).slice(0, 300) });
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      stats.errors++;
      log(userDb, { source: src.key, action: err.blocked ? "blocked" : "error", title: src.name,
        summary: err.blocked ? "网站暂时拒绝自动访问，本次停止检查这个网站，下次再试。已处理的部分保留。" : "列表页读取失败：" + String(err.message || err).slice(0, 300) });
    }
  }

  if (!only || only.includes("cases")) {
    onProgress({ phase: "指导性案例", ...stats });
    const have = new Set(legalDb.prepare("SELECT url FROM cases").all().map((r) => r.url));
    try {
      for await (const item of listCases({ maxPages: full ? 40 : 2, signal })) {
        stats.checked++;
        if (have.has(item.url) && !stale(item.url)) continue;
        if (have.has(item.url) && !full) continue;
        try {
          const c = await fetchCase(item, { signal });
          stats.fetched++;
          const r = upsertCase(legalDb, c);
          saveRecord.run(item.url, "cases", c.title, new Date().toISOString(), JSON.stringify(c));
          if (r.isNew) {
            stats.changes++;
            log(userDb, { source: "cases", action: "case_new", title: c.title, doc_id: r.id, url: item.url, summary: "新增指导性案例" });
          }
        } catch (err) {
          if (signal?.aborted || err.blocked) throw err;
          stats.errors++;
          log(userDb, { source: "cases", action: "error", title: item.title, url: item.url, summary: String(err.message || err).slice(0, 300) });
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      stats.errors++;
      log(userDb, { source: "cases", action: "error", title: "指导性案例", summary: "列表页读取失败：" + String(err.message || err).slice(0, 300) });
    }
  }

  for (const p of promotePending(legalDb, today)) {
    stats.changes++;
    log(userDb, { source: "local", action: "promoted", title: p.title, doc_id: p.doc_id, summary: `${p.effective_date} 起施行，已转为现行版本` });
  }
  userDb.prepare("INSERT INTO sync_state(key, value) VALUES('last_check', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(new Date().toISOString());
  onProgress({ phase: "完成", done: true, ...stats });
  return stats;
}

/** 资料库重建后，把以前抓到的官方文本按时间顺序重新并入。 */
export function replayOfficial({ legalDb, userDb, onProgress = () => {} }) {
  ensureUserTables(userDb);
  ensureOfficialColumns(legalDb);
  const rows = userDb.prepare("SELECT source, record FROM official_docs ORDER BY fetched_at").all();
  let i = 0;
  for (const r of rows) {
    const rec = JSON.parse(r.record);
    if (r.source === "cases") upsertCase(legalDb, rec);
    else applyOfficialDoc(legalDb, rec);
    if (++i % 20 === 0) onProgress({ replayed: i, total: rows.length });
  }
  promotePending(legalDb);
  return rows.length;
}
