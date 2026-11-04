// 打安装包前：把依赖库标识和线上最新的更新序号写进 package.json。
// 装上新安装包的人不会再去下载安装包里已经包含的更新。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP, depsId } from "./components.mjs";

const p = path.join(APP, "package.json");
const pkg = JSON.parse(readFileSync(p, "utf8"));
let seq = pkg.updateSequence || 0;
try {
  const r = await fetch("https://github.com/DerekXuHQ/claude-for-legal-china/releases/download/updates/update-manifest.json", { redirect: "follow" });
  if (r.ok) seq = Math.max(seq, JSON.parse(Buffer.from((await r.json()).payload, "base64").toString("utf8")).sequence);
} catch { /* 没发布过更新 */ }
pkg.updateSequence = seq;
pkg.depsId = depsId();
writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
console.log(`安装包更新序号 ${seq}，依赖库 ${pkg.depsId}`);
