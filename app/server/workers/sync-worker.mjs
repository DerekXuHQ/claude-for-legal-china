// 后台检查官方更新，进度发回主进程。主进程发 "abort" 时停止。
import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { runSync } from "../official/sync.mjs";

const { legalDbPath, userDbPath, mode, only } = workerData;
const ctrl = new AbortController();
parentPort.on("message", (m) => { if (m === "abort") ctrl.abort(); });

const legalDb = new DatabaseSync(legalDbPath);
const userDb = new DatabaseSync(userDbPath);
legalDb.exec("PRAGMA busy_timeout=10000;");
userDb.exec("PRAGMA busy_timeout=10000;");

runSync({ legalDb, userDb, mode, only, signal: ctrl.signal, onProgress: (p) => parentPort.postMessage({ progress: p }) })
  .then((stats) => parentPort.postMessage({ done: true, stats }))
  .catch((err) => parentPort.postMessage({ error: ctrl.signal.aborted ? "已停止" : String(err?.message || err) }))
  .finally(() => { legalDb.close(); userDb.close(); });
