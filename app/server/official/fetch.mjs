// 访问官方网站：限速（同一站点两次请求至少间隔 2 秒）；遇到反自动访问的验证页就停止、超时、重试一次。
// 只访问 robots.txt 允许的公开栏目：中国人大网、司法部国家行政法规库、最高人民法院。
// 国家法律法规数据库（flk.npc.gov.cn）的 robots.txt 禁止自动采集，这里不访问。

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 ClaudeForLegalChina/1.0";
const lastHit = new Map();
const MIN_GAP_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}：${url}`);
    this.status = status;
  }
}

/** 网站返回了反自动访问的验证页。按网站意愿停止访问，不尝试绕过。 */
export class BlockedError extends Error {
  constructor(url) {
    super(`网站暂时拒绝自动访问（返回验证页）：${new URL(url).host}`);
    this.blocked = true;
  }
}

export async function getText(url, { signal } = {}) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const wait = (lastHit.get(host) || 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        redirect: "follow",
      });
      if (!res.ok) throw new HttpError(res.status, url);
      const buf = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder("utf-8").decode(buf);
      if (res.headers.get("wzws-ray") && /Please enable JavaScript/i.test(text)) throw new BlockedError(url);
      if (text.length < 60000 && /<noscript>[\s\S]{0,200}enable JavaScript/i.test(text) && !/第[一二三四五六七八九十]+条/.test(text)) throw new BlockedError(url);
      return text;
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof HttpError && err.status === 404) throw err;
      if (err instanceof BlockedError) throw err;
      if (attempt >= 1) throw err;
      await sleep(3000);
    }
  }
}
