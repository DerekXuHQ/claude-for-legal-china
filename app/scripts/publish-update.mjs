// 发布在线更新：打包变了的组件 → 签名清单 → 上传到 GitHub 的 updates 版本。
// 用法：node scripts/publish-update.mjs --notes "这次更新了什么" [--dry-run]
// 需要：私钥 ~/.china-law-search/release-key.pem（scripts/release-keygen.mjs 生成），gh 已登录。
//
// 组件：
//   code  程序代码（main.mjs、server/、renderer/），每次都发
//   deps  依赖库（生产依赖），依赖版本变了才发新的
//   data  法规数据包（resources/base.db.gz），数据版本变了才发新的
// 外壳（Electron、boot.mjs、shell/）不在补丁里；外壳变了要出新安装包。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { APP, codeFiles, depsId, depsFiles, dataVersion } from "./components.mjs";
import { pack, fileList, sha256 } from "../shell/archive.mjs";

const REPO = "DerekXuHQ/claude-for-legal-china";
const TAG = "updates";
const BASE = `https://github.com/${REPO}/releases/download/${TAG}/`;
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const dry = process.argv.includes("--dry-run");
const notes = arg("notes", "");

const pkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));
const key = createPrivateKey(readFileSync(path.join(os.homedir(), ".china-law-search", "release-key.pem"), "utf8"));
const out = path.join(APP, "dist", "update");
mkdirSync(out, { recursive: true });

// 现在线上的清单（没有就是第一次发布）
let prev = null;
try {
  const r = await fetch(BASE + "update-manifest.json?t=" + Date.now(), { redirect: "follow" });
  if (r.ok) prev = JSON.parse(Buffer.from((await r.json()).payload, "base64").toString("utf8"));
} catch { /* 第一次 */ }
const sequence = Math.max(prev?.sequence || 0, pkg.updateSequence || 0) + 1;
const uploads = [];

// code
const code = codeFiles();
const codeBuf = pack(code);
const codeName = `code-${sequence}.gz`;
writeFileSync(path.join(out, codeName), codeBuf);
uploads.push(codeName);
const codeEntry = { url: BASE + codeName, sha256: sha256(codeBuf), size: codeBuf.length, files: fileList(code) };

// deps
const did = depsId();
let depsEntry;
if (prev?.deps?.id === did) {
  depsEntry = prev.deps;
} else {
  const buf = pack(depsFiles());
  const name = `deps-${did}.gz`;
  writeFileSync(path.join(out, name), buf);
  uploads.push(name);
  depsEntry = { id: did, url: BASE + name, sha256: sha256(buf), size: buf.length };
}

// data
const dv = dataVersion();
let dataEntry;
if (prev?.data?.version === dv.version) {
  dataEntry = prev.data;
} else {
  const buf = readFileSync(path.join(APP, "resources", "base.db.gz"));
  const name = `data-${dv.version}.db.gz`;
  writeFileSync(path.join(out, name), buf);
  uploads.push(name);
  dataEntry = { version: dv.version, built_at: dv.built_at, official_checked: dv.official_checked || "", url: BASE + name, sha256: sha256(buf), size: buf.length };
}

const manifest = {
  schema: 1, app: "china-law-search", sequence, version: pkg.version, shellProtocol: 1,
  published: new Date().toISOString(), notes, code: codeEntry, deps: depsEntry, data: dataEntry,
};
const payload = Buffer.from(JSON.stringify(manifest));
const envelope = { payload: payload.toString("base64"), signature: sign(null, payload, key).toString("base64") };
writeFileSync(path.join(out, "update-manifest.json"), JSON.stringify(envelope));

console.log(`更新序号 ${sequence}（版本 ${pkg.version}）`);
console.log(`  程序 ${(codeBuf.length / 1e6).toFixed(2)} MB，${code.size} 个文件`);
console.log(`  依赖库 ${depsEntry.id}${uploads.some((u) => u.startsWith("deps-")) ? `（新，${(depsEntry.size / 1e6).toFixed(1)} MB）` : "（沿用）"}`);
console.log(`  数据包 ${dataEntry.version}${uploads.some((u) => u.startsWith("data-")) ? `（新，${(dataEntry.size / 1e6).toFixed(0)} MB）` : "（沿用）"}`);

if (dry) {
  console.log(`试运行，没有上传。文件在 ${out}`);
} else {
  const gh = (...a) => execFileSync("gh", a, { cwd: APP, stdio: ["ignore", "pipe", "inherit"] }).toString();
  try { gh("release", "view", TAG, "-R", REPO); } catch {
    gh("release", "create", TAG, "-R", REPO, "--prerelease", "--title", "在线更新（app 自动下载，无需手动安装）",
      "--notes", "这里放的是中国法律检索的在线更新组件，已安装的 app 会自动检查并下载。要安装 app 请到最新的正式版本下载安装包。");
  }
  // 组件先传，清单最后传：清单一出现，组件已经都在了
  for (const f of uploads) gh("release", "upload", TAG, "-R", REPO, "--clobber", path.join(out, f));
  gh("release", "upload", TAG, "-R", REPO, "--clobber", path.join(out, "update-manifest.json"));
  console.log("已发布。");
}
// 新出的安装包要带上这个序号，装上之后就不会再下载同一个更新
console.log(`下次打安装包前把 package.json 的 updateSequence 设为 ${sequence}，depsId 设为 ${did}（build 脚本会自动做）。`);
