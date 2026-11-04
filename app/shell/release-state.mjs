// 沿用 CopyDeck（栀言文案工坊）的发布状态机。
// 发布状态机：当前版、候选版、上一版，以及失败过的版本。只记录“该加载哪个目录”，不碰用户工作文件
// （项目、稿件、档案都在用户数据目录里，不随代码版本回退）。不依赖 Electron，不修改 main.mjs；启动时由主进程调用。
//
// 状态转换：
//   setCandidate → beginBoot(试运行，次数先落盘) → confirmHealthy（候选升为当前，原当前成为上一版）
//                                        └ 未确认就再次启动 / reportFailure → 候选记入失败，继续用当前版
//   当前版连续启动但从未确认健康（崩溃循环）→ rollback 到上一版，把它记入失败
import { readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = 1, MAX_FAILED = 20;
export const MAX_CANDIDATE_BOOTS = 1;      // 候选只给一次启动机会：没来得及确认健康就退回
export const MAX_CURRENT_UNCONFIRMED = 3;  // 当前版连续这么多次启动都没确认健康，视为崩溃循环

const fresh = () => ({ schema: SCHEMA, current: null, previous: null, candidate: null, failed: [], updatedAt: null });
const isRel = x => x && typeof x === 'object' && Number.isSafeInteger(x.sequence) && typeof x.dir === 'string' && x.dir.length > 0;
function valid(s) {
  return s && s.schema === SCHEMA && (s.current === null || isRel(s.current)) && (s.previous === null || isRel(s.previous))
    && (s.candidate === null || isRel(s.candidate)) && Array.isArray(s.failed) && s.failed.every(f => Number.isSafeInteger(f?.sequence));
}

export class ReleaseState {
  constructor({ dir, now = () => new Date().toISOString(), exists = existsSync } = {}) {
    if (!dir) throw new Error('缺少状态目录');
    this.dir = dir; this.file = join(dir, 'release-state.json'); this.now = now; this.exists = exists;
    this.recovered = false; this.s = fresh(); this.load();
  }
  load() {
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.file)) { this.s = fresh(); return this; }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!valid(parsed)) throw new Error('状态文件结构无效');
      this.s = parsed;
    } catch {
      // 损坏的状态不能当成“没有候选”悄悄继续：保留原文件供排查，回到内置版本
      try { renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch {}
      this.s = fresh(); this.recovered = true; this.save();
    }
    return this;
  }
  // 原子写：先写同目录临时文件并落盘，再改名。任何时刻磁盘上的状态文件要么是旧的完整版本，要么是新的完整版本。
  save() {
    this.s.updatedAt = this.now();
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.s, null, 1));
    const fd = openSync(tmp, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.file);
  }
  snapshot() { return structuredClone(this.s); }
  highestKnown() { return Math.max(0, this.s.current?.sequence || 0, this.s.candidate?.sequence || 0, ...this.s.failed.map(f => f.sequence)); }
  isFailed(sequence) { return this.s.failed.some(f => f.sequence === sequence); }

  // 下载并校验完成的版本登记为候选。只能前进；失败过的序列号不自动重试。
  setCandidate({ sequence, dir }) {
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || !dir) throw new Error('候选版本信息无效');
    if (this.isFailed(sequence)) throw new Error('这个版本启动失败过，不再自动尝试，请等待新的发布');
    if (sequence <= (this.s.current?.sequence || 0)) throw new Error('候选版本不新于当前版本');
    if (this.s.candidate && this.s.candidate.sequence >= sequence) throw new Error('已有同样或更新的候选版本');
    this.s.candidate = { sequence, dir, stagedAt: this.now(), boots: 0 };
    this.save(); return this.snapshot().candidate;
  }

  // 启动前调用：决定加载哪个目录。试运行次数在返回之前落盘，这样加载过程中崩溃也会被记住。
  beginBoot() {
    this.cleanExitNoted = false;
    const s = this.s;
    if (s.candidate) {
      const c = s.candidate;
      if (c.boots >= MAX_CANDIDATE_BOOTS) this._failCandidate('上次试运行没有确认健康就再次启动');
      else if (!this.exists(c.dir)) this._failCandidate('候选版本目录不存在');
      else { c.boots += 1; c.lastBootAt = this.now(); this.save(); return { load: c.dir, sequence: c.sequence, trial: true }; }
    }
    if (s.current) {
      if (!this.exists(s.current.dir)) return this._rollbackOrBuiltin('当前版本目录不存在');
      if ((s.current.unconfirmed || 0) >= MAX_CURRENT_UNCONFIRMED) return this._rollbackOrBuiltin('当前版本连续启动都没有确认健康');
      s.current.unconfirmed = (s.current.unconfirmed || 0) + 1; this.save();
      return { load: s.current.dir, sequence: s.current.sequence, trial: false };
    }
    return { load: null, sequence: 0, trial: false };   // 内置版本
  }

  // 只有 Electron before-quit 的正常退出使用；强制终止与已报告失败不得调用。
  noteCleanExit(sequence) {
    if (this.cleanExitNoted) return { noted: false };
    const s = this.s;
    if (s.candidate?.sequence === sequence && s.candidate.boots > 0) s.candidate.boots = 0;
    else if (s.current?.sequence === sequence && s.current.unconfirmed > 0) s.current.unconfirmed -= 1;
    else return { noted: false };
    this.cleanExitNoted = true; this.save(); return { noted: true };
  }

  // 应用跑起来、关键功能自检通过之后调用。
  confirmHealthy(sequence) {
    const s = this.s;
    if (s.candidate && s.candidate.sequence === sequence && s.candidate.boots > 0) {
      s.previous = s.current ? { sequence: s.current.sequence, dir: s.current.dir, activatedAt: s.current.activatedAt } : null;
      s.current = { sequence, dir: s.candidate.dir, activatedAt: this.now(), unconfirmed: 0 };
      s.candidate = null; this.save(); return { promoted: true };
    }
    if (s.current && s.current.sequence === sequence) { s.current.unconfirmed = 0; this.save(); return { promoted: false, confirmed: true }; }
    return { promoted: false, confirmed: false };
  }

  // 用户点「回到上一版」：上一版重新当当前版；没有上一版就回到应用自带的版本。回退下来的版本不记失败，之后可以再装。
  rollbackByUser() {
    const s = this.s, from = s.current?.sequence || 0;
    if (s.previous) { s.current = { sequence: s.previous.sequence, dir: s.previous.dir, activatedAt: this.now(), unconfirmed: 0 }; s.previous = null; }
    else s.current = null;
    s.candidate = null; this.save(); return { from, to: s.current?.sequence || 0 };
  }

  // 启动过程中明确知道候选不行（加载抛错、自检失败）。
  reportFailure(sequence, reason = '') {
    const s = this.s;
    if (s.candidate?.sequence === sequence) { this._failCandidate(reason || '候选版本报告失败'); return { failed: 'candidate' }; }
    if (s.current?.sequence === sequence) { this._rollbackOrBuiltin(reason || '当前版本报告失败'); return { failed: 'current' }; }
    return { failed: null };
  }

  // 可以安全删除的已校验版本目录：不是当前、上一版或候选。
  prunable(allDirs) {
    const keep = new Set([this.s.current?.dir, this.s.previous?.dir, this.s.candidate?.dir].filter(Boolean));
    return allDirs.filter(d => !keep.has(d));
  }

  _record(rel, reason) {
    this.s.failed = [...this.s.failed, { sequence: rel.sequence, dir: rel.dir, at: this.now(), reason: String(reason).slice(0, 300) }].slice(-MAX_FAILED);
  }
  _failCandidate(reason) { this._record(this.s.candidate, reason); this.s.candidate = null; this.save(); }
  _rollbackOrBuiltin(reason) {
    const s = this.s; this._record(s.current, reason);
    if (s.previous && this.exists(s.previous.dir)) { s.current = { ...s.previous, unconfirmed: 0 }; s.previous = null; }
    else { s.current = null; s.previous = null; }
    this.save();
    return s.current ? { load: s.current.dir, sequence: s.current.sequence, trial: false, rolledBack: true } : { load: null, sequence: 0, trial: false, rolledBack: true };
  }
}
