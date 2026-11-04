// 在线更新（外壳的一部分，补丁换不了）。做法沿用 CopyDeck：
// - 安装包只装「外壳」（Electron、启动器、这里的签名校验）和一份内置版本；
// - 代码、依赖库、法规数据包是可替换的组件，发布在 GitHub 的 updates 版本里，清单用 Ed25519 签名；
// - 发现新版本 → 只下载变了的组件 → 逐个校验哈希 → 组装成新的版本目录 → 登记为候选 → 重启试运行；
//   试运行没确认健康就自动退回上一版（见 release-state.mjs）。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync, renameSync, rmSync, symlinkSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { verify as edVerify, createPublicKey } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sha256, unpack, writeFiles, collect } from "./archive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHELL_PROTOCOL = 1;
const CONFIG = JSON.parse(readFileSync(join(HERE, "update-config.json"), "utf8"));
const ALLOWED_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const MAX_COMPONENT = 400 * 1024 * 1024;

function publicKey() {
  const key = createPublicKey(readFileSync(join(HERE, "release-public-key.pem"), "utf8"));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("发布公钥必须为 Ed25519");
  return key;
}

/** 校验签名清单，返回清单内容。 */
export function verifyManifest(envelope) {
  if (typeof envelope?.payload !== "string" || typeof envelope?.signature !== "string") throw new Error("更新清单缺少签名");
  const bytes = Buffer.from(envelope.payload, "base64"), sig = Buffer.from(envelope.signature, "base64");
  if (sig.length !== 64 || !edVerify(null, bytes, publicKey(), sig)) throw new Error("更新清单签名无效");
  const m = JSON.parse(bytes.toString("utf8"));
  if (m.schema !== 1 || m.app !== "china-law-search" || !Number.isSafeInteger(m.sequence) || m.sequence <= 0) throw new Error("更新清单无效");
  for (const c of [m.code, m.deps, m.data].filter(Boolean)) {
    const u = new URL(c.url);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.host)) throw new Error("组件地址不在允许的范围内");
    if (!/^[a-f0-9]{64}$/.test(c.sha256) || !Number.isSafeInteger(c.size) || c.size <= 0 || c.size > MAX_COMPONENT) throw new Error("组件校验信息无效");
  }
  if (!m.code || !Array.isArray(m.code.files) || !m.deps?.id) throw new Error("更新清单缺少代码或依赖信息");
  return m;
}

async function fetchBytes(url, { signal, onChunk, limit }) {
  const res = await fetch(url, { redirect: "follow", signal });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const final = new URL(res.url || url);
  if (final.protocol !== "https:" || !ALLOWED_HOSTS.has(final.host)) throw new Error("下载被重定向到了不允许的地址");
  const chunks = [];
  let size = 0;
  for await (const b of res.body) {
    size += b.length;
    if (size > limit) throw new Error("下载内容超出清单登记的大小");
    chunks.push(Buffer.from(b));
    onChunk?.(b.length);
  }
  return Buffer.concat(chunks);
}

export class Updater {
  /**
   * @param {object} o
   * @param {string} o.dir      更新相关文件的目录（userData/updates）
   * @param {string} o.builtin  内置版本目录（app.asar）
   * @param {object} o.state    ReleaseState
   * @param {string} o.resources 安装包的 resources 目录（内置数据包）
   */
  constructor({ dir, builtin, state, resources, onStatus = () => {} }) {
    Object.assign(this, { dir, builtin, state, resources, onStatus });
    mkdirSync(dir, { recursive: true });
    this.componentsFile = join(dir, "components.json");
    this.status = { status: "idle" };
    this.busy = false;
  }

  builtinInfo() {
    const pkg = JSON.parse(readFileSync(join(this.builtin, "package.json"), "utf8"));
    return { sequence: pkg.updateSequence || 0, depsId: pkg.depsId || "", version: pkg.version };
  }
  components() {
    try { return JSON.parse(readFileSync(this.componentsFile, "utf8")); } catch { return {}; }
  }
  saveComponents(c) {
    const tmp = this.componentsFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(c, null, 1));
    renameSync(tmp, this.componentsFile);
  }

  /** 当前生效的序号：已确认的当前版、候选版或内置版本里最大的。 */
  installedSequence() {
    const s = this.state.snapshot();
    return Math.max(this.builtinInfo().sequence, s.current?.sequence || 0, s.candidate?.sequence || 0);
  }

  /** 当前使用的法规数据包：内置的和下载的里面最新的一个。 */
  dataPack() {
    const builtinVer = (() => { try { return JSON.parse(readFileSync(join(this.resources, "data-version.json"), "utf8")); } catch { return null; } })();
    let best = builtinVer ? { gz: join(this.resources, "base.db.gz"), info: builtinVer } : null;
    const root = join(this.dir, "data");
    if (existsSync(root)) {
      for (const name of readdirSync(root)) {
        const vf = join(root, name, "data-version.json"), gz = join(root, name, "base.db.gz");
        if (!existsSync(vf) || !existsSync(gz)) continue;
        try {
          const info = JSON.parse(readFileSync(vf, "utf8"));
          if (!best || `${info.built_at}|${info.version}` > `${best.info.built_at}|${best.info.version}`) best = { gz, info };
        } catch { /* 跳过损坏的 */ }
      }
    }
    return best;
  }

  snapshot() {
    const b = this.builtinInfo();
    return { ...this.status, installed: { version: b.version, sequence: this.installedSequence(), data: this.dataPack()?.info?.version || "" } };
  }
  set(s) { this.status = s; this.onStatus(this.snapshot()); }

  async check() {
    if (this.busy) return this.snapshot();
    this.busy = true;
    try {
      const buf = await fetchBytes(`${CONFIG.manifestUrl}?t=${Date.now()}`, { signal: AbortSignal.timeout(30000), limit: 5 * 1024 * 1024 });
      const envelope = JSON.parse(buf.toString("utf8"));
      const m = verifyManifest(envelope);
      this.envelope = envelope;
      this.manifest = m;
      const installed = this.installedSequence();
      if (m.shellProtocol > SHELL_PROTOCOL) {
        this.set({ status: "shell", version: m.version, notes: m.notes || "", message: "这个版本需要下载新的安装包", installerUrl: CONFIG.installerUrl });
      } else if (m.sequence <= installed) {
        this.set({ status: "current", checked_at: new Date().toISOString(), message: "已是最新版本" });
      } else {
        const plan = this.plan(m);
        this.set({ status: "available", sequence: m.sequence, version: m.version, notes: m.notes || "", bytes: plan.reduce((n, c) => n + c.size, 0), parts: plan.map((c) => c.label), checked_at: new Date().toISOString() });
      }
    } catch (err) {
      this.set({ status: "error", message: `检查更新失败：${err.message}`, checked_at: new Date().toISOString() });
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }

  /** 需要下载哪些组件。 */
  plan(m) {
    const comp = this.components();
    const haveDeps = m.deps.id === this.builtinInfo().depsId || m.deps.id === comp.depsId || existsSync(join(this.dir, "deps", m.deps.id, "node_modules"));
    const haveData = !m.data || (this.dataPack()?.info?.version === m.data.version);
    return [
      { name: "code", label: "程序", ...m.code },
      ...(haveDeps ? [] : [{ name: "deps", label: "依赖库", ...m.deps }]),
      ...(haveData ? [] : [{ name: "data", label: "法规数据包", ...m.data }]),
    ];
  }

  async download() {
    if (this.busy) return this.snapshot();
    if (!this.manifest) throw new Error("先检查更新");
    const m = this.manifest;
    if (m.sequence <= this.installedSequence() || m.shellProtocol > SHELL_PROTOCOL) return this.snapshot();
    this.busy = true;
    const plan = this.plan(m);
    const total = plan.reduce((n, c) => n + c.size, 0);
    let received = 0;
    const progress = (n) => {
      received += n;
      this.status = { ...this.status, status: "downloading", percent: total ? Math.floor((received * 100) / total) : 0, received, total };
      this.onStatus(this.snapshot());
    };
    try {
      const got = {};
      for (const c of plan) {
        this.set({ ...this.status, status: "downloading", current: c.label, percent: total ? Math.floor((received * 100) / total) : 0 });
        const bytes = await fetchBytes(c.url, { onChunk: progress, limit: c.size });
        if (bytes.length !== c.size || sha256(bytes) !== c.sha256) throw new Error(`${c.label}校验不通过（大小或哈希不符）`);
        got[c.name] = bytes;
      }
      this.set({ ...this.status, status: "installing", message: "正在安装" });
      // 依赖库：每个版本单独一个目录，多个代码版本共用
      if (got.deps) {
        const target = join(this.dir, "deps", m.deps.id);
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        writeFiles(join(target, "node_modules"), unpack(got.deps));
      }
      // 数据包
      if (got.data) {
        const target = join(this.dir, "data", m.data.version);
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, "base.db.gz.tmp"), got.data);
        renameSync(join(target, "base.db.gz.tmp"), join(target, "base.db.gz"));
        writeFileSync(join(target, "data-version.json"), JSON.stringify({ version: m.data.version, built_at: m.data.built_at, official_checked: m.data.official_checked || "", sha256: m.data.sha256 }, null, 1));
      }
      // 代码 + 依赖库链接 → 新的版本目录
      const releases = join(this.dir, "releases");
      mkdirSync(releases, { recursive: true });
      const tmp = mkdtempSync(join(releases, `${m.sequence}-`));
      const codeFiles = unpack(got.code);
      for (const f of m.code.files) {
        const b = codeFiles.get(f.path);
        if (!b || b.length !== f.size || sha256(b) !== f.sha256) throw new Error("程序文件与签名清单不一致");
      }
      if (codeFiles.size !== m.code.files.length) throw new Error("程序包里有清单之外的文件");
      writeFiles(tmp, codeFiles);
      this.linkDeps(tmp, m.deps.id);
      writeFileSync(join(tmp, "signed-manifest.json"), JSON.stringify(this.envelope));
      const ready = tmp + "-ready";
      renameSync(tmp, ready);
      this.state.setCandidate({ sequence: m.sequence, dir: ready });
      const comp = this.components();
      this.saveComponents({ ...comp, depsId: m.deps.id });
      this.prune();
      this.set({ status: "staged", sequence: m.sequence, version: m.version, notes: m.notes || "", message: "更新已下载并校验，重启后生效" });
    } catch (err) {
      this.set({ status: "error", message: `更新失败：${err.message}` });
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }

  /** 新版本目录里的 node_modules 指向共用的依赖库目录；依赖没变时，第一次从内置版本复制一份出来。 */
  linkDeps(releaseDir, depsId) {
    const shared = join(this.dir, "deps", depsId, "node_modules");
    if (!existsSync(shared)) {
      if (depsId !== this.builtinInfo().depsId) throw new Error("缺少需要的依赖库");
      const files = collect(join(this.builtin, "node_modules"));
      const tmp = shared + ".tmp";
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      writeFiles(tmp, files);
      renameSync(tmp, shared);
    }
    symlinkSync(shared, join(releaseDir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  }

  /** 只保留当前、上一版、候选三个版本目录。 */
  prune() {
    const root = join(this.dir, "releases");
    if (!existsSync(root)) return;
    const all = readdirSync(root).map((n) => join(root, n));
    for (const d of this.state.prunable(all)) rmSync(d, { recursive: true, force: true });
  }
}

/** 启动时校验一个已组装的版本目录：签名有效，程序文件和清单一致。 */
export function verifyAssembled(dir, sequence) {
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("版本目录无效");
  const m = verifyManifest(JSON.parse(readFileSync(join(dir, "signed-manifest.json"), "utf8")));
  if (m.sequence !== sequence) throw new Error("版本序号与签名清单不符");
  for (const f of m.code.files) {
    const b = readFileSync(join(dir, ...f.path.split("/")));
    if (b.length !== f.size || sha256(b) !== f.sha256) throw new Error(`程序文件被改动：${f.path}`);
  }
  if (!existsSync(join(dir, "node_modules"))) throw new Error("缺少依赖库");
  return m;
}
