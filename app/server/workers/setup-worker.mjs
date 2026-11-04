// 第一次启动（或 app 升级换了数据包）时在后台准备资料库：
// 解压随安装包附带的 base.db.gz → 建全文索引 → 重放以前抓到的官方更新。
// 写到 legal.db.new，完成后由主进程换上。
import { parentPort, workerData } from "node:worker_threads";
import { createReadStream, createWriteStream, statSync, rmSync, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { ensureOfficialColumns, promotePending } from "../official/apply.mjs";
import { replayOfficial, ensureUserTables } from "../official/sync.mjs";

const { gzPath, outPath, userDbPath, dataVersion } = workerData;
const post = (m) => parentPort.postMessage(m);

async function main() {
  for (const p of [outPath, outPath + "-wal", outPath + "-shm", outPath + "-journal"]) rmSync(p, { force: true });
  const total = statSync(gzPath).size;
  let read = 0, lastPost = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      read += chunk.length;
      if (Date.now() - lastPost > 200) {
        lastPost = Date.now();
        post({ phase: "解压法规数据", progress: (read / total) * 0.35 });
      }
      cb(null, chunk);
    },
  });
  await pipeline(createReadStream(gzPath), meter, createGunzip(), createWriteStream(outPath));

  const db = new DatabaseSync(outPath);
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-200000;");
  ensureOfficialColumns(db);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(title, text, content='articles', content_rowid='rowid', tokenize='trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS cases_fts USING fts5(title, keywords, points, laws, text, content='cases', content_rowid='rowid', tokenize='trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS refs_fts USING fts5(title, heading, text, content='refs', content_rowid='rowid', tokenize='trigram');
  `);
  const maxRow = db.prepare("SELECT max(rowid) m FROM articles").get().m || 0;
  const batch = 40000;
  const ins = db.prepare("INSERT INTO articles_fts(rowid, title, text) SELECT rowid, title, text FROM articles WHERE rowid > ? AND rowid <= ?");
  for (let lo = 0; lo < maxRow; lo += batch) {
    db.exec("BEGIN");
    ins.run(lo, lo + batch);
    db.exec("COMMIT");
    post({ phase: "建立全文索引", progress: 0.35 + 0.6 * Math.min(1, (lo + batch) / maxRow) });
  }
  db.exec("INSERT INTO cases_fts(cases_fts) VALUES('rebuild'); INSERT INTO refs_fts(refs_fts) VALUES('rebuild');");

  post({ phase: "合并官方更新", progress: 0.96 });
  if (existsSync(userDbPath)) {
    const userDb = new DatabaseSync(userDbPath);
    ensureUserTables(userDb);
    replayOfficial({ legalDb: db, userDb });
    userDb.close();
  }
  promotePending(db);
  db.prepare("INSERT INTO meta(key, value) VALUES('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(dataVersion);
  db.exec("PRAGMA optimize;");
  db.close();
  // 换成 WAL，检索和后台更新可以同时进行
  const db2 = new DatabaseSync(outPath);
  db2.exec("PRAGMA journal_mode=WAL;");
  db2.close();
  post({ phase: "完成", progress: 1, done: true });
}

main().catch((err) => post({ error: String(err?.stack || err) }));
