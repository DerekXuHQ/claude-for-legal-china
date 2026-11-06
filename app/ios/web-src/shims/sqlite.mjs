// node:sqlite 的 iOS 替身：接口和 DatabaseSync / StatementSync 一样，实际在原生 SQLite（带 FTS5 trigram）里执行。
// 原生侧按 SQL 缓存预编译语句，所以 prepare 本身不跨桥。
import { callSync, b64ToBytes, bytesToB64 } from "../native.mjs";

const enc = (v) => {
  if (v instanceof Uint8Array || ArrayBuffer.isView(v)) return { $b64: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v === undefined ? null : v;
};
const decRow = (r) => {
  if (!r) return r;
  for (const k in r) if (r[k] && typeof r[k] === "object" && "$b64" in r[k]) r[k] = b64ToBytes(r[k].$b64);
  return r;
};
// 位置参数（.all(a, b)）或命名参数（.all({ $x: 1 })）
function params(args) {
  if (args.length === 1 && args[0] && typeof args[0] === "object" && !ArrayBuffer.isView(args[0]) && !Array.isArray(args[0])) {
    const named = {};
    for (const [k, v] of Object.entries(args[0])) named[/^[:@$]/.test(k) ? k : ":" + k] = enc(v);
    return { named };
  }
  return { positional: args.map(enc) };
}

class StatementSync {
  constructor(db, sql) { this.db = db; this.sql = sql; }
  all(...a) { return callSync("sqlite.all", { db: this.db.h, sql: this.sql, ...params(a) }).map(decRow); }
  get(...a) { return decRow(callSync("sqlite.get", { db: this.db.h, sql: this.sql, ...params(a) })) ?? undefined; }
  run(...a) { return callSync("sqlite.run", { db: this.db.h, sql: this.sql, ...params(a) }); }
  *iterate(...a) { yield* this.all(...a); }
}

export class DatabaseSync {
  constructor(path, opts = {}) {
    this.h = callSync("sqlite.open", { path: String(path), readOnly: !!opts.readOnly });
  }
  prepare(sql) { return new StatementSync(this, sql); }
  exec(sql) { callSync("sqlite.exec", { db: this.h, sql }); }
  close() { callSync("sqlite.close", { db: this.h }); }
}
export default { DatabaseSync };
