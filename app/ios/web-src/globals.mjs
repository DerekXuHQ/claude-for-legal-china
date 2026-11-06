// 页面加载时最先执行：补上服务端代码需要的全局对象，接管网络请求。
// 必须是 boot.mjs 的第一个 import（ES 模块按 import 顺序执行）。
import { Buffer } from "buffer";
import { call, on, pageId } from "./native.mjs";

// iOS 16.0–17.3 的 WebKit 没有 AbortSignal.any（官方法规更新的请求要用）
if (typeof AbortSignal !== "undefined" && !AbortSignal.any) {
  AbortSignal.any = (signals) => {
    const c = new AbortController();
    for (const s of signals) {
      if (!s) continue;
      if (s.aborted) { c.abort(s.reason); break; }
      s.addEventListener("abort", () => c.abort(s.reason), { once: true });
    }
    return c.signal;
  };
}
if (typeof AbortSignal !== "undefined" && !AbortSignal.timeout) {
  AbortSignal.timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException("超时", "TimeoutError")), ms); return c.signal; };
}

globalThis.Buffer = Buffer;
globalThis.global = globalThis;
globalThis.process = globalThis.process || {
  env: {}, platform: "ios", arch: "arm64", pid: 1, version: "v22.0.0", versions: { node: "22.0.0" },
  cwd: () => "/", nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)),
};

// ---- 网络 ----
// 页面在 app:// 下，直接 fetch 外部网站会被跨域规则挡住（模型接口、官方法规网站都没有给 App 开跨域）。
// 外部请求一律交给原生 URLSession，响应按数据块流式回传，模型的流式输出照常工作。
const pageFetch = globalThis.fetch.bind(globalThis);
let netSeq = 0;

async function nativeFetch(url, init = {}) {
  const req = new Request(url, init); // 统一 body（字符串、二进制、FormData 都能转成字节）和请求头
  const body = ["GET", "HEAD"].includes(req.method) ? null : new Uint8Array(await req.arrayBuffer());
  const id = pageId + "n" + (++netSeq);
  const signal = init.signal;
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
  let ctrl, off = () => {};
  const stream = new ReadableStream({ start(c) { ctrl = c; }, cancel() { off(); call("net.cancel", { id }).catch(() => {}); } });
  return new Promise((resolve, reject) => {
    let settled = false;
    off = on("net:" + id, (ev) => {
      if (ev.type === "head") {
        settled = true;
        try {
          // 101/204/205/304 不能带响应体；请求头值里有非 ASCII 的去掉（fetch 只接受 ByteString）
          const nobody = [101, 204, 205, 304].includes(ev.status);
          const headers = new Headers();
          for (const [k, v] of Object.entries(ev.headers || {})) { if (/^[\x00-\xff]*$/.test(String(v))) try { headers.append(k, String(v)); } catch { /* 跳过 */ } }
          const res = new Response(nobody ? null : stream, { status: ev.status >= 200 && ev.status <= 599 ? ev.status : 200, headers });
          try { Object.defineProperty(res, "url", { value: ev.url || req.url }); } catch { /* 只读也没关系 */ }
          resolve(res);
          if (nobody) { off(); call("net.cancel", { id }).catch(() => {}); }
        } catch (e) { off(); reject(new TypeError(`fetch failed: ${e.message}`)); }
      } else if (ev.type === "data") {
        try { ctrl.enqueue(Uint8Array.from(atob(ev.b64), (c) => c.charCodeAt(0))); } catch { /* 已取消 */ }
      } else if (ev.type === "end") {
        off(); try { ctrl.close(); } catch { /* 已关闭 */ }
      } else if (ev.type === "error") {
        off();
        const err = new TypeError(`fetch failed: ${ev.message || "网络错误"}`);
        if (!settled) reject(err); else try { ctrl.error(err); } catch { /* 已关闭 */ }
      }
    });
    signal?.addEventListener("abort", () => {
      call("net.cancel", { id }).catch(() => {});
      off();
      const err = new DOMException("已取消", "AbortError");
      if (!settled) reject(err); else try { ctrl.error(err); } catch { /* 已关闭 */ }
    });
    let b64 = null;
    if (body) { let s = ""; for (let i = 0; i < body.length; i += 0x8000) s += String.fromCharCode.apply(null, body.subarray(i, i + 0x8000)); b64 = btoa(s); }
    call("net.fetch", { id, url: req.url, method: req.method, headers: Object.fromEntries(req.headers), body: b64 }).catch((e) => { off(); if (!settled) reject(new TypeError(`fetch failed: ${e.message}`)); });
  });
}

// /api/... 由页面里的服务端代码处理（boot.mjs 注册 localApi）；外部网址走原生；其余（App 内置的网页文件）照常
let localApi = null;
export const setLocalApi = (fn) => { localApi = fn; };
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(url, location.href);
  if (u.origin === location.origin && u.pathname.startsWith("/api/")) {
    if (!localApi) throw new TypeError("服务还没准备好");
    return localApi(u, typeof input === "object" && !(input instanceof URL) ? new Request(input, init) : new Request(u.href, init));
  }
  // 同源的其他地址（App 内置的网页文件）照常；只有外部网址交给原生
  if (u.origin !== location.origin && (u.protocol === "http:" || u.protocol === "https:")) return nativeFetch(u.href, typeof input === "object" && !(input instanceof URL) ? { method: input.method, headers: input.headers, body: init.body ?? (input.method && !["GET", "HEAD"].includes(input.method) ? await input.clone().arrayBuffer() : undefined), signal: init.signal || input.signal, ...init } : init);
  return pageFetch(input, init);
};

// ---- WebSocket（实时转写）----
// 服务端代码按 Node 的写法给 WebSocket 传请求头（Authorization），浏览器的 WebSocket 做不到；改用原生 URLSessionWebSocketTask。
let wsSeq = 0; // id 前面带页面前缀，见 native.mjs
class NativeWebSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url, opts = {}) {
    super();
    this.url = String(url);
    this.readyState = 0;
    this.id = pageId + "w" + (++wsSeq);
    this.off = on("ws:" + this.id, (ev) => {
      if (ev.type === "open") { this.readyState = 1; this.dispatchEvent(new Event("open")); }
      else if (ev.type === "message") this.dispatchEvent(new MessageEvent("message", { data: ev.data }));
      else if (ev.type === "error") { this.dispatchEvent(Object.assign(new Event("error"), { message: ev.message })); }
      else if (ev.type === "close") { this.readyState = 3; this.off(); this.dispatchEvent(Object.assign(new Event("close"), { code: ev.code || 1000, reason: ev.reason || "" })); }
    });
    call("ws.open", { id: this.id, url: this.url, headers: opts.headers || {} }).catch((e) => {
      this.dispatchEvent(Object.assign(new Event("error"), { message: e.message }));
      this.readyState = 3; this.dispatchEvent(new Event("close"));
    });
  }
  send(data) { call("ws.send", { id: this.id, data: String(data) }).catch(() => {}); }
  close() { if (this.readyState < 2) { this.readyState = 2; call("ws.close", { id: this.id }).catch(() => {}); } }
}
globalThis.__NativeWebSocket = NativeWebSocket;
