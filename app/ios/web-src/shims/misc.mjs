// 其他 node: 模块的 iOS 替身（只实现服务端代码实际用到的部分）。
import { Buffer } from "buffer";
import { callSync } from "../native.mjs";

// node:crypto
export function randomUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function createHash(alg) {
  const parts = [];
  return {
    update(d) { parts.push(typeof d === "string" ? Buffer.from(d, "utf8") : Buffer.from(d)); return this; },
    digest(encoding) {
      const hex = callSync("crypto.hash", { alg: String(alg).toLowerCase(), data: Buffer.concat(parts).toString("base64") });
      const buf = Buffer.from(hex, "hex");
      return encoding ? buf.toString(encoding) : buf;
    },
  };
}
export function randomBytes(n) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return Buffer.from(b); }

// node:url
export const fileURLToPath = (u) => decodeURIComponent(new URL(String(u)).pathname);
export const pathToFileURL = (p) => new URL("file://" + encodeURI(p));

// node:module —— 只有 pdf.js 的资源目录用到；页面里这些文件由 App 内置的网页服务提供
export const createRequire = () => ({ resolve: (id) => (id === "pdfjs-dist/package.json" ? "/vendor/pdfjs/package.json" : id) });

// node:os
export const tmpdir = () => "/data/tmp";
export const platform = () => "ios";
export const homedir = () => "/data";

// node:child_process —— iOS 没有子进程；用到的地方（本机文字识别、HEIC、AMR 转换）改走原生接口
export function execFile(cmd, args, opts, cb) { (typeof opts === "function" ? opts : cb)?.(new Error("iOS 不能运行外部程序"), "", ""); }
export function execFileSync() { throw new Error("iOS 不能运行外部程序"); }

// node:http —— iOS 版没有本机 HTTP 服务（页面直接调用请求处理函数）
export const createServer = () => { throw new Error("iOS 版不开 HTTP 服务"); };

// node:worker_threads / node:stream —— 只在桌面版的后台线程里用
export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export class Worker { constructor() { throw new Error("iOS 版不支持 Worker"); } }
export const pipeline = async () => { throw new Error("iOS 版不支持"); };
export class Readable {}

export default { randomUUID, createHash, randomBytes, fileURLToPath, pathToFileURL, createRequire, tmpdir, platform, homedir, execFile, execFileSync, createServer, isMainThread, parentPort, workerData, Worker, pipeline, Readable };
