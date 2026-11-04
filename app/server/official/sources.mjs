// 三个官方来源：列表页逐页列出条目，详情页解析成统一的法规记录。
//
// 记录格式：
// { source, source_name, url, title, level, history, version_date, effective_date,
//   doc_number, issuer, articles: [{article_cn, article_no, chapter, section, text}], fulltext }
import { getText, HttpError } from "./fetch.mjs";
import { htmlToLines, sliceBetween, findHistory, datesFromHistory, splitArticles, innerTitle, unescapeHTML, isoDate } from "./parse.mjs";

const JUNK = /^(返回|顶部|返回顶部|打印|打印本页|关闭|关闭窗口|【打印】|【关闭】|扫码下载|下载Word|下载PDF|分享到.*|相关链接)$/;

const TAIL = /^(相关新闻|相关链接|相关报道|相关阅读|相关文章|延伸阅读)[:：]?$/;

function finish(rec, bodyLines) {
  const cut = bodyLines.findIndex((l) => TAIL.test(l));
  if (cut >= 0) bodyLines = bodyLines.slice(0, cut);
  bodyLines = bodyLines.filter((l) => !JUNK.test(l));
  const { articles, ok } = splitArticles(bodyLines);
  rec.fulltext = bodyLines.join("\n");
  rec.articles = ok ? articles : [];
  if (!rec.version_date || !rec.effective_date) {
    const d = datesFromHistory(rec.history || "");
    rec.version_date ||= d.version;
    rec.effective_date ||= d.effective;
  }
  if (!rec.effective_date) {
    const m = rec.fulltext.match(/自\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*起\s*(施行|实施)/);
    if (m) rec.effective_date = isoDate(m[1], m[2], m[3]);
  }
  return rec;
}

/* ---------------- 中国人大网：法律 ---------------- */

const NPC_LIST = "http://www.npc.gov.cn/npc/c2/c12435/c12488/";
const NPC_SKIP = /主席令|条约|协定|公约|说明|报告|草案|议案|公告|名单|决议|任免|汇报|意见|通知|办法$/;

export const npc = {
  key: "npc",
  name: "中国人大网",
  level: "法律",
  async *list({ maxPages = 3, signal } = {}) {
    for (let page = 0; page < maxPages; page++) {
      const url = NPC_LIST + (page === 0 ? "" : `index_${page}.html`);
      let html;
      try { html = await getText(url, { signal }); } catch (e) { if (e instanceof HttpError && e.status === 404) return; throw e; }
      const items = [...html.matchAll(/href="([^"]*c30834\/\d{6}\/t\d+_\d+\.html)"[^>]*>([^<]{2,120})</g)];
      if (!items.length) return;
      for (const [, href, raw] of items) {
        const title = unescapeHTML(raw).trim();
        const isLaw = /^中华人民共和国.+法(典)?$/.test(title) || /^全国人民代表大会(常务委员会)?关于.+的决定$/.test(title);
        if (!isLaw || NPC_SKIP.test(title.replace(/的决定$/, ""))) continue;
        yield { url: new URL(href, url).href, title };
      }
    }
  },
  async fetch(item, { signal } = {}) {
    const html = await getText(item.url, { signal });
    const title = unescapeHTML((html.match(/<h1>([^<]+)<\/h1>/) || [])[1] || item.title).trim();
    const h3 = unescapeHTML((html.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
    const body = sliceBetween(html, ['id="Zoom"'], ['<div class="editor"', '<div class="share"', 'class="about-article"']);
    const lines = htmlToLines(body.replace(/^id="Zoom">/, ""));
    const history = h3.replace(/^[（(]|[)）]$/g, "").trim() || findHistory(lines);
    return finish({
      source: "npc", source_name: "中国人大网", url: item.url, title, level: "法律", history,
      version_date: "", effective_date: "", doc_number: "", issuer: "全国人民代表大会常务委员会",
    }, lines);
  },
};

/* ---------------- 司法部国家行政法规库：行政法规 ---------------- */

const MOJ_BASE = "https://xzfg.moj.gov.cn";

export const moj = {
  key: "moj",
  name: "国家行政法规库（司法部）",
  level: "行政法规",
  async *list({ maxPages = 3, signal } = {}) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${MOJ_BASE}/search2.html?sortField=PublishTime&ascOrDesc=desc&timeliness=1&PageIndex=${page}`;
      const html = await getText(url, { signal });
      // 每一项的标题链接在 <div class="title"> 里；历史沿革里的旧版本链接不取
      const items = [...html.matchAll(/<div class="title">\s*<span><a[^>]*href="(https:\/\/xzfg\.moj\.gov\.cn\/front\/law\/detail\?LawID=\d+)"[^>]*>([^<]+)<\/a>/g)];
      if (!items.length) return;
      for (const [, href, raw] of items) yield { url: href, title: unescapeHTML(raw).trim() };
      const total = Number((html.match(/id="law-total"[^>]*value="(\d+)"/) || [])[1] || 0);
      if (total && page * 10 >= total) return;
    }
  },
  async fetch(item, { signal } = {}) {
    const html = await getText(item.url, { signal });
    const title = unescapeHTML((html.match(/class="text-title"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || item.title).replace(/<[^>]+>/g, "").trim() || item.title;
    const body = sliceBetween(html, ['class="text-bottom"'], ["<footer", 'class="footer', "<!--** 底部"]);
    let lines = htmlToLines(body.replace(/^class="[^"]*">/, ""));
    // 页面结构：标题 → 「历史沿革」折叠块 → 标题 → （题注） → 正文。正文从第二次出现的标题之后开始。
    const key = title.replace(/\s/g, "");
    let start = 0;
    for (let i = 0; i < Math.min(lines.length, 120); i++) if (lines[i].replace(/\s/g, "") === key) start = i + 1;
    let history = "";
    if (/^[（(]/.test(lines[start] || "")) {
      let end = start;
      while (end < lines.length - 1 && !/[)）]$/.test(lines[end])) end++;
      history = lines.slice(start, end + 1).join(" ").replace(/^[（(]\s*|\s*[)）]$/g, "").trim();
      start = end + 1;
    }
    if (start > 0) lines = lines.slice(start);
    else {
      const hIdx = lines.findIndex((l) => l === "(" || l === "（" || /^[（(].*(公布|通过|发布)/.test(l));
      history = findHistory(lines.slice(Math.max(0, hIdx - 1)));
      const firstBody = lines.findIndex((l, i) => i > hIdx && /^(第[零一二三四五六七八九十百千]+(章|条)|一、)/.test(l));
      if (firstBody > 0) lines = lines.slice(firstBody);
    }
    const num = history.match(/国务院令第\s*(\d+)\s*号/g);
    return finish({
      source: "moj", source_name: "国家行政法规库（司法部）", url: item.url, title, level: "行政法规", history,
      version_date: "", effective_date: "", doc_number: num ? num[num.length - 1].replace(/\s/g, "") : "", issuer: "国务院",
    }, lines);
  },
};

/* ---------------- 最高人民法院：司法解释 ---------------- */

const COURT = "https://www.court.gov.cn";

export const court = {
  key: "court",
  name: "最高人民法院",
  level: "司法解释",
  async *list({ maxPages = 2, signal } = {}) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${COURT}/fabu/gengduo/16${page === 1 ? "" : "_" + page}.html`;
      let html;
      try { html = await getText(url, { signal }); } catch (e) { if (e instanceof HttpError && e.status === 404) return; throw e; }
      const items = [...html.matchAll(/href="(\/fabu\/xiangqing\/\d+\.html)"[^>]*>([^<]{4,200})/g)];
      if (!items.length) return;
      for (const [, href, raw] of items) {
        const title = unescapeHTML(raw).trim();
        if (/典型案例|新闻发布|答记者问|理解与适用|解读|白皮书/.test(title)) continue;
        yield { url: COURT + href, title };
      }
    }
  },
  async fetch(item, { signal } = {}) {
    const html = await getText(item.url, { signal });
    const body = sliceBetween(html, ['<div class="txt_txt"', '<div class="detail"'], ['<div class="txt_etr"', 'class="share', 'class="bottom', "责任编辑", "相关链接</strong>", ">相关链接<"]);
    let lines = htmlToLines(body.replace(/^<div class="[^"]*"[^>]*>/, ""));
    // 公告段：「……现予公布，自……起施行。 最高人民法院 2026年9月20日 法释〔2026〕19号」
    const numIdx = lines.findIndex((l) => /^法释〔\d{4}〕\d+号$/.test(l));
    let docNumber = "", published = "";
    if (numIdx >= 0) {
      docNumber = lines[numIdx];
      for (let i = numIdx; i >= Math.max(0, numIdx - 3); i--) {
        const m = lines[i].match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
        if (m) { published = isoDate(m[1], m[2], m[3]); break; }
      }
    }
    const announce = lines.slice(0, Math.max(0, numIdx)).join("\n");
    const after = numIdx >= 0 ? lines.slice(numIdx + 1) : lines;
    // 正式标题：法释号之后、题注之前的一到两行
    const hIdx = after.findIndex((l) => /^[（(].*(通过|公布)/.test(l));
    let title = hIdx > 0 ? after.slice(0, hIdx).join("") : innerTitle(item.title);
    if (!/^(最高人民法院|最高人民检察院)/.test(title)) title = innerTitle(item.title);
    if (!/^(最高人民法院|最高人民检察院)/.test(title)) title = "最高人民法院" + title;
    // 「最高人民法院 最高人民检察院关于……」统一写成「最高人民法院、最高人民检察院关于……」
    title = title.replace(/\s+/g, "").replace(/^最高人民法院、?最高人民检察院/, "最高人民法院、最高人民检察院");
    // 栏目里偶尔有新闻稿，标题不像司法解释的不收
    if (!/(解释|规定|批复|决定|办法|安排|答复)([（(][一二三四五六七八九十]+[）)])?$/.test(title) || /[—…]/.test(title)) {
      return { source: "court", source_name: "最高人民法院", url: item.url, title, level: "司法解释", history: "", version_date: "", effective_date: "", doc_number: "", issuer: "", articles: [], fulltext: "" };
    }
    const history = hIdx >= 0 ? after[hIdx].replace(/^[（(]|[)）]$/g, "") : findHistory(lines);
    const bodyLines = hIdx >= 0 ? after.slice(hIdx + 1) : after;
    const rec = finish({
      source: "court", source_name: "最高人民法院", url: item.url, title, level: "司法解释", history,
      version_date: published, effective_date: "", doc_number: docNumber, issuer: "最高人民法院",
    }, bodyLines);
    if (!rec.effective_date) {
      const m = announce.match(/自\s*(\d{4})年(\d{1,2})月(\d{1,2})日起施行/);
      if (m) rec.effective_date = isoDate(m[1], m[2], m[3]);
    }
    return rec;
  },
};

export const SOURCES = { npc, moj, court };
