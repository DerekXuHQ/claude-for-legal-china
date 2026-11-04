// 把 data/base.db 压缩成 resources/base.db.gz，并写 resources/data-version.json。
import { createReadStream, createWriteStream, statSync, writeFileSync } from "node:fs";
import { createGzip, constants } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "data", "base.db");
const out = path.join(here, "..", "resources", "base.db.gz");
const db = new DatabaseSync(src, { readOnly: true });
const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
db.close();
await pipeline(createReadStream(src), createGzip({ level: constants.Z_BEST_COMPRESSION }), createWriteStream(out));
const hash = createHash("sha256");
await pipeline(createReadStream(out), hash);
const digest = hash.digest("hex");
const version = `${meta.built_at || "unknown"}-${digest.slice(0, 8)}`;
writeFileSync(path.join(here, "..", "resources", "data-version.json"),
  JSON.stringify({ version, built_at: meta.built_at, official_checked: meta.official_checked || "", sha256: digest }, null, 2) + "\n");
console.log(`resources/base.db.gz ${(statSync(out).size / 1e6).toFixed(0)} MB，数据版本 ${version}`);
