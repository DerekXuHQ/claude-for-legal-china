// 组件包格式：gzip 压缩的 JSON {files: [[相对路径, base64 内容], ...]}。打包和解包都在这里，确定性（路径排序、不含时间戳）。
import { gzipSync, gunzipSync, constants } from "node:zlib";
import { readdirSync, readFileSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { createHash } from "node:crypto";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** 收集目录下的文件；filter(relPath) 返回 false 的跳过。 */
export function collect(root, prefix = "", filter = () => true, out = new Map()) {
  for (const name of readdirSync(root).sort()) {
    const abs = join(root, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (!filter(rel)) continue;
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) collect(abs, rel, filter, out);
    else if (st.isFile()) out.set(rel, readFileSync(abs));
  }
  return out;
}

export function pack(files) {
  const entries = [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, b]) => [p, b.toString("base64")]);
  return gzipSync(Buffer.from(JSON.stringify({ files: entries })), { level: constants.Z_BEST_COMPRESSION });
}

const safe = (p) => typeof p === "string" && p.length > 0 && !p.includes("\\") && !p.startsWith("/") && p.split("/").every((x) => x && x !== "." && x !== "..");

export function unpack(buf) {
  const j = JSON.parse(gunzipSync(buf, { maxOutputLength: 1024 * 1024 * 1024 }).toString("utf8"));
  if (!Array.isArray(j.files)) throw new Error("组件包格式无效");
  const files = new Map();
  for (const [p, b64] of j.files) {
    if (!safe(p) || files.has(p)) throw new Error("组件包里的文件路径无效");
    files.set(p, Buffer.from(b64, "base64"));
  }
  return files;
}

export function writeFiles(root, files) {
  for (const [p, b] of files) {
    const out = join(root, ...p.split("/"));
    if (!out.startsWith(root + sep)) throw new Error("文件路径越界");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, b, { flag: "wx" });
  }
}

/** 代码文件清单：[{path, sha256, size}]，写进签名清单，启动时据此校验。 */
export function fileList(files) {
  return [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, b]) => ({ path, sha256: sha256(b), size: b.length }));
}
