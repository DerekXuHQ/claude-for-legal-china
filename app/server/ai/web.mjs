// 联网搜索：走接口的 Responses API 自带的 web_search 工具（Portkey 转给模型提供方），不自己抓搜索引擎页面。
// 用途限定在实务经验、类似做法、网上报道的案例和处罚、行业惯例、企业公开信息；法律条文以本地资料库为准，不从网上取。
import { client } from "./models.mjs";

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "……" : s || "");

/**
 * @returns {Promise<{summary: string, sources: {title: string, url: string}[], queries: string[]}>}
 */
export async function webSearch(settings, { model, query, purpose = "", signal }) {
  const api = client(settings);
  const input = `请联网搜索并整理（中文）：${query}
${purpose ? `用途：${purpose}\n` : ""}要求：
- 优先找中国大陆的实务经验、类似做法、网上报道的案例或处罚、行业惯例；知乎、小红书、豆瓣、微信公众号文章、新闻、法院和政府网站都可以。
- 用 5 到 8 条要点概括找到的内容，每条写明出处（网站名），区分「个人经验分享」「媒体报道」「官方发布」。
- 不要给出法律条文的内容和条号（法条以本地资料库为准）；网上说法彼此矛盾的，指出矛盾。`;
  const r = await api.responses.create({ model, input, tools: [{ type: "web_search" }], reasoning: { effort: "low" } }, { signal });
  const queries = [];
  const sources = [];
  const seen = new Set();
  let summary = "";
  for (const o of r.output || []) {
    if (o.type === "web_search_call") {
      const a = o.action || {};
      for (const q of [a.query, ...(a.queries || [])]) if (q && !queries.includes(q)) queries.push(q);
    } else if (o.type === "message") {
      for (const c of o.content || []) {
        if (c.text) summary += c.text;
        for (const an of c.annotations || []) {
          const url = String(an.url || "").replace(/[?&]utm_source=openai$/, "");
          if (url && !seen.has(url)) { seen.add(url); sources.push({ title: clip(an.title || url, 80), url }); }
        }
      }
    }
  }
  // 摘要里去掉 Markdown 链接和加粗（链接另列在 sources 里）
  const clean = summary.replace(/\(\[[^\]]*\]\([^)]*\)\)/g, "").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1").replace(/\*\*/g, "").replace(/[ \t]+\n/g, "\n").trim();
  return { summary: clip(clean, 6000), sources: sources.slice(0, 12), queries };
}
