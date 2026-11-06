// node:fs 的 iOS 替身。
// /app/... 是打包进来的只读文件（Agent 技能、任务手册、场景目录，构建时放进 VFS）；
// /data/... 是可写的用户数据目录（设置、事项附件），由原生层映射到 App 的 Documents/data。
import { Buffer } from "buffer";
import { callSync } from "../native.mjs";
import { VFS } from "virtual:vfs";

const norm = (p) => String(p).replace(/\/+/g, "/").replace(/\/$/, "") || "/";
const isData = (p) => norm(p) === "/data" || norm(p).startsWith("/data/");
const vfsDirs = new Map(); // 目录 -> Set(子项)
for (const f of Object.keys(VFS)) {
  const parts = f.split("/");
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join("/") || "/";
    if (!vfsDirs.has(dir)) vfsDirs.set(dir, new Set());
    vfsDirs.get(dir).add(parts[i]);
  }
}
const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: "ENOENT" });
const encOf = (o) => (typeof o === "string" ? o : o?.encoding || null);
const out = (buf, enc) => (enc ? buf.toString(enc === "utf-8" ? "utf8" : enc) : buf);

export function existsSync(p) {
  p = norm(p);
  if (isData(p)) return callSync("fs.exists", { path: p });
  return p in VFS || vfsDirs.has(p);
}
export function readFileSync(p, opts) {
  p = norm(p);
  const enc = encOf(opts);
  if (isData(p)) return out(Buffer.from(callSync("fs.read", { path: p }), "base64"), enc);
  if (!(p in VFS)) throw enoent(p);
  return out(Buffer.from(VFS[p], "utf8"), enc);
}
export function writeFileSync(p, data, opts) {
  p = norm(p);
  if (!isData(p)) throw new Error(`只读：${p}`);
  const buf = typeof data === "string" ? Buffer.from(data, encOf(opts) || "utf8") : Buffer.from(data);
  callSync("fs.write", { path: p, data: buf.toString("base64") });
}
export function readdirSync(p) {
  p = norm(p);
  if (isData(p)) return callSync("fs.readdir", { path: p });
  const s = vfsDirs.get(p);
  if (!s) throw enoent(p);
  return [...s].sort();
}
export function statSync(p) {
  p = norm(p);
  if (isData(p)) {
    const st = callSync("fs.stat", { path: p });
    if (!st) throw enoent(p);
    return { size: st.size, isFile: () => !st.dir, isDirectory: () => !!st.dir, mtimeMs: st.mtime * 1000 };
  }
  if (p in VFS) return { size: Buffer.byteLength(VFS[p]), isFile: () => true, isDirectory: () => false, mtimeMs: 0 };
  if (vfsDirs.has(p)) return { size: 0, isFile: () => false, isDirectory: () => true, mtimeMs: 0 };
  throw enoent(p);
}
export function mkdirSync(p) { p = norm(p); if (isData(p)) callSync("fs.mkdir", { path: p }); }
export function rmSync(p, opts) { p = norm(p); if (isData(p)) callSync("fs.rm", { path: p }); }
export const unlinkSync = rmSync;
export function chmodSync() {}
export function renameSync(a, b) { callSync("fs.rename", { from: norm(a), to: norm(b) }); }
export function mkdtempSync(prefix) { const p = `/data/tmp/${String(prefix).split("/").pop()}${Math.random().toString(36).slice(2, 8)}`; mkdirSync(p); return p; }
export const promises = {
  readFile: async (p, o) => readFileSync(p, o),
  writeFile: async (p, d, o) => writeFileSync(p, d, o),
};
export default { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, unlinkSync, chmodSync, renameSync, mkdtempSync, promises };
