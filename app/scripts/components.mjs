// 发布在线更新时用到的组件信息：代码文件、依赖库（生产依赖）、数据包。
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { collect } from "../shell/archive.mjs";

export const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 程序代码：main.mjs、server/、renderer/。外壳文件（boot.mjs、shell/）不在其中，补丁换不了。 */
export function codeFiles() {
  const files = new Map();
  files.set("main.mjs", readFileSync(path.join(APP, "main.mjs")));
  const skip = (rel) => !/(^|\/)(__pycache__|\.DS_Store)$/.test(rel);
  for (const dir of ["server", "renderer"]) collect(path.join(APP, dir), dir, skip, files);
  return files;
}

function prodPackages() {
  // Windows 上 npm 是 npm.cmd，新版 Node 要通过 shell 才能启动它
  const win = process.platform === "win32";
  const out = execFileSync(win ? "npm.cmd" : "npm", ["ls", "--omit=dev", "--all", "--parseable", "--long"], { cwd: APP, encoding: "utf8", shell: win, maxBuffer: 50e6 });
  // npm 会把路径里像密钥的片段打码，所以只取 node_modules 之后的部分，再拼回本项目目录。
  // 每行是「路径:包名@版本」；Windows 路径本身带「D:」，所以从 node_modules 之后找冒号
  return out.split(/\r?\n/).slice(1).filter(Boolean).map((l) => {
    const m = l.match(/^(.*[\\/]node_modules[\\/][^:]*):([^:]+)/);
    if (!m) return null;
    const [, raw, spec] = m;
    const i = raw.indexOf(`${path.sep}node_modules${path.sep}`);
    return i < 0 ? null : { dir: path.join(APP, raw.slice(i + 1)), spec };
  }).filter(Boolean);
}

/** 依赖库的版本标识：生产依赖的「包名@版本」排序后取哈希。依赖没变，标识就不变。 */
export function depsId() {
  const specs = [...new Set(prodPackages().map((p) => p.spec))].sort();
  return createHash("sha256").update(specs.join("\n")).digest("hex").slice(0, 16);
}

/** 依赖库文件（去掉说明文档、类型声明、源码映射、测试等运行用不到的文件）。 */
export function depsFiles() {
  const files = new Map();
  const nm = path.join(APP, "node_modules");
  const skip = (rel) => !/(\.md|\.markdown|\.map|\.d\.ts|\.d\.mts|\.d\.cts)$/i.test(rel) && !/(^|\/)(test|tests|__tests__|example|examples|\.github)(\/|$)/i.test(rel);
  for (const p of prodPackages()) {
    const rel = path.relative(nm, p.dir).split(path.sep).join("/");
    if (!existsSync(p.dir)) continue;
    const sub = collect(p.dir, rel, (r) => skip(r) && !r.slice(rel.length + 1).includes("node_modules/"));
    for (const [k, v] of sub) files.set(k, v);
  }
  return files;
}

export function dataVersion() {
  return JSON.parse(readFileSync(path.join(APP, "resources", "data-version.json"), "utf8"));
}
