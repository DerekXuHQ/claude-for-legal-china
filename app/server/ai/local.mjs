// 本机小模型（离线）：先在本机法规库里检索相关条文，再让小模型只依据这些条文作简短回答。
// 小模型能力有限，只做「检索 + 答疑」；Agent、文书起草、合同审查等需要在线模型。
import * as search from "../search.mjs";
import { expandQuery } from "./synonyms.mjs";

const STOP = /请问|请帮我|帮我|一下|怎么办|怎么样|怎么|如何|什么|哪些|哪个|是否|是不是|能不能|可不可以|可以|应该|需要|多久|多少|多长|为什么|有没有|我们|我的|我能|我要|我|你们|你|他们|公司的|的话|要求|的|了|吗|呢|吧|啊|呀|和|与|或者|还是|如果|因为|所以|但是|归谁|给谁|算|？|\?|！|!|：|:|“|”|"|'|（|）|\(|\)|《|》/g;

// 拆关键词：停用词切开；太长的片段再切成 3、4 字的小段（全文索引是三字切分，长句整句匹配会落空）
export function keywords(question) {
  const parts = String(question).replace(STOP, " ").split(/[\s，,。;；、]+/).map((w) => w.trim()).filter((w) => [...w].length >= 2);
  const out = [];
  for (const w of parts) {
    const ch = [...w];
    if (ch.length <= 4) { out.push(w); continue; }
    for (const n of [4, 3]) for (let i = 0; i + n <= ch.length; i++) out.push(ch.slice(i, i + n).join(""));
  }
  const extra = expandQuery(question).split(/\s+/).filter(Boolean);
  return [...new Set([...extra, ...out])].slice(0, 14);
}

const LEVEL_BONUS = { "法律": 1.2, "司法解释": 1, "行政法规": 0.6 };
const noise = (it) => /废止|目录|清理|决定$/.test(it.title || "") || it.article === "全文";

/** 检索相关条文：每个关键词单独查，按命中的关键词个数、排名和效力层级合并 */
export function findArticles(question, { province = "", limit = 5 } = {}) {
  const words = keywords(question);
  const score = new Map();
  for (const w of words) {
    let r;
    try { r = search.searchArticles(w, { province, limit: 12 }); } catch { continue; }
    const weight = 1;
    r.items.forEach((it, i) => {
      if (noise(it)) return;
      const cur = score.get(it.id) || { it, s: (LEVEL_BONUS[it.level] || 0) + (it.province === "全国" ? 0.4 : 0), words: new Set(), w: 0 };
      cur.s += weight / (i + 2); cur.words.add(w); cur.w += weight;
      score.set(it.id, cur);
    });
  }
  const ranked = () => [...score.values()].map((x) => ({ ...x, total: x.s + x.w * 1.5 })).sort((a, b) => b.total - a.total);
  // 排在前面的几个词合起来再查一次（同时命中的更准）
  const strong = [...new Set(ranked().slice(0, 3).flatMap((x) => [...x.words]))].slice(0, 2);
  if (strong.length === 2) { try { search.searchArticles(strong.join(" "), { province, limit: 6 }).items.forEach((it, i) => { const c = score.get(it.id); if (c) c.s += 3 / (i + 1); }); } catch { /* 跳过 */ } }
  const top = ranked().slice(0, limit);
  return { words, articles: top.map(({ it }) => ({ ...it, full: search.getArticle(it.id) })) };
}

const lawName = (t) => search.cleanTitle ? search.cleanTitle(t) : t;

// 提示词：2026-11-14 在 Mac 上用 Qwen3-0.6B / Qwen2.5-0.5B 实测过几种写法，带一个示例、只给前三条条文时答得最稳。
// 小模型仍会答偏，所以回答下面一定附上条文原文，用户以原文为准。
const SYSTEM = "你是法律检索助手。只根据用户给出的参考条文回答问题。回答两到三句话：第一句直接给结论，最后一句写「依据：《法律名称》第几条」。不要重复，不要编造条文里没有的内容。";
const EXAMPLE_Q = "参考条文：\n[1]《中华人民共和国劳动合同法》第十条：建立劳动关系，应当订立书面劳动合同。已建立劳动关系，未同时订立书面劳动合同的，应当自用工之日起一个月内订立书面劳动合同。\n\n问题：入职多久内要签劳动合同？";
const EXAMPLE_A = "应当自用工之日起一个月内订立书面劳动合同。\n依据：《中华人民共和国劳动合同法》第十条。";

export function localMessages(question, articles) {
  const refs = articles.slice(0, 3).map((a, i) => {
    const body = String(a.full?.text || a.snippet || "").replace(/\s+/g, " ").slice(0, 300);
    return `[${i + 1}]《${lawName(a.title)}》${a.article || ""}：${body}`;
  }).join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: EXAMPLE_Q }, { role: "assistant", content: EXAMPLE_A },
    { role: "user", content: `参考条文：\n${refs}\n\n问题：${question}` },
  ];
}
const tidyAnswer = (t) => String(t || "").replace(/\[\d\]/g, "").trim();

/**
 * 离线回答。generate({ messages, onText, signal }) 由平台提供（iOS：原生 MLX）。
 * 输出：小模型的简短回答（标明是本机小模型）＋ 前三条条文原文 ＋ 其他相关条文。
 */
export async function localAnswer({ question, region = "", generate, emit, signal }) {
  if (!generate) throw new Error("本机小模型还没准备好，请在「设置 → AI 设置」里下载");
  emit({ type: "route", name: "本机检索答疑" });
  emit({ type: "stage", text: "在本机法规库里检索" });
  const { words, articles } = findArticles(question, { province: region });
  emit({ type: "step", text: `关键词：${words.join("、") || "（无）"}；找到 ${articles.length} 条相关条文`, kind: "search" });
  if (!articles.length) {
    const text = "本机法规库里没有找到相关条文。可以换个说法（例如用法律术语）再问，或者到「检索」里直接搜关键词。\n\n> 本机小模型离线运行，只做检索和简短答疑；复杂问题请开通在线模型。";
    emit({ type: "text", delta: text });
    return { text };
  }
  emit({ type: "stage", text: "本机小模型整理回答" });
  const head = "**本机小模型的回答**（离线，可能不准确，请对照下面的条文原文）\n\n";
  emit({ type: "text", delta: head });
  let shown = "";
  const raw = await generate({
    messages: localMessages(question, articles), signal,
    onText: (full) => { const t = tidyAnswer(full); const delta = t.slice(shown.length); if (delta && t.startsWith(shown)) { shown = t; emit({ type: "text", delta }); } },
  });
  const answer = tidyAnswer(raw) || shown;
  if (answer.startsWith(shown) && answer.length > shown.length) emit({ type: "text", delta: answer.slice(shown.length) });
  else if (!answer.startsWith(shown)) { emit({ type: "text_reset" }); emit({ type: "text", delta: head + answer }); }
  const quote = (a) => `**《${lawName(a.title)}》${a.article || ""}**\n\n${String(a.full?.text || a.snippet || "").trim().split(/\n+/).map((l) => "> " + l).join("\n")}`;
  const more = articles.slice(3);
  const tail = `\n\n---\n\n**相关条文原文**\n\n${articles.slice(0, 3).map(quote).join("\n\n")}`
    + (more.length ? `\n\n**其他可能相关**\n${more.map((a) => `- 《${lawName(a.title)}》${a.article || ""}`).join("\n")}` : "")
    + "\n\n> 内容仅供参考，不构成法律意见。复杂问题请开通在线模型。";
  emit({ type: "text", delta: tail });
  return { text: head + answer + tail };
}
