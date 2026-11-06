// 和 iOS 原生层（Swift）通信。
// 同步调用：window.prompt 由原生的 WKUIDelegate 接住并立即返回结果（SQLite、文件读写这类本来就是同步的接口靠它）。
// 异步调用：webkit.messageHandlers.native.postMessage，原生做完后调 window.__native.resolve / emit 回来。

const hasNative = typeof window !== "undefined" && !!window.webkit?.messageHandlers?.native;

/** 同步调用原生；出错时抛异常。 */
export function callSync(op, args = {}) {
  if (!hasNative) throw new Error(`原生接口不可用：${op}`);
  const raw = window.prompt("__native__" + JSON.stringify({ op, args }));
  if (raw == null) throw new Error(`原生接口没有返回：${op}`);
  const r = JSON.parse(raw);
  if (r.error) throw new Error(r.error);
  return r.value;
}

// 每次页面加载一个前缀：网页进程被回收后重新加载，旧页面遗留的回调不会对上新页面的 id
const PAGE = "p" + Math.random().toString(36).slice(2, 8) + "-";
export const pageId = PAGE;
let seq = 0;
const pending = new Map();
const listeners = new Map(); // 事件名 -> Set<fn>

/** 异步调用原生，返回 Promise。 */
export function call(op, args = {}) {
  if (!hasNative) return Promise.reject(new Error(`原生接口不可用：${op}`));
  const id = PAGE + (++seq);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.webkit.messageHandlers.native.postMessage({ id, op, args });
  });
}

/** 订阅原生推送的事件（网络数据块、WebSocket 消息、下载进度等）。返回取消订阅的函数。 */
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

if (typeof window !== "undefined") {
  window.__native = {
    resolve(id, value, error) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error)); else p.resolve(value);
    },
    emit(event, data) {
      for (const fn of listeners.get(event) || []) { try { fn(data); } catch (e) { console.error(e); } }
    },
  };
}

export const isNative = hasNative;

// base64 <-> 字节
export function b64ToBytes(b64) {
  const s = atob(b64 || "");
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
