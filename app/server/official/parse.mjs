// 把官方网页解析成「法规 + 条文」结构。三个来源共用。

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", mdash: "—", hellip: "…", middot: "·", emsp: "　", ensp: " " };

export function unescapeHTML(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** HTML 片段转成去掉空行的文本行。 */
export function htmlToLines(html) {
  let s = html.replace(/<[^>]*$/, "").replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|table|section)>/gi, "\n").replace(/<[^>]+>/g, "");
  s = unescapeHTML(s);
  return s.split("\n")
    .map((l) => l.replace(/[   　\t ]+/g, " ").trim())
    .filter(Boolean);
}

/** 截取 HTML 里某个容器之后、到页脚标记之前的部分。 */
export function sliceBetween(html, startMarkers, endMarkers) {
  let start = -1;
  for (const m of startMarkers) {
    start = html.indexOf(m);
    if (start >= 0) break;
  }
  if (start < 0) return html;
  let end = html.length;
  for (const m of endMarkers) {
    const i = html.indexOf(m, start + 50);
    if (i >= 0 && i < end) end = i;
  }
  return html.slice(start, end);
}

const CN = "零〇一二三四五六七八九十百千";
const DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function cnToInt(s) {
  let total = 0, section = 0, num = 0;
  for (const ch of s) {
    if (ch in DIGIT) num = DIGIT[ch];
    else if (ch === "十") { section += (num || 1) * 10; num = 0; }
    else if (ch === "百") { section += num * 100; num = 0; }
    else if (ch === "千") { section += num * 1000; num = 0; }
  }
  total += section + num;
  return total;
}

export const ARTICLE_RE = new RegExp(`^(第([${CN}]+)条(?:之([${CN}]+))?)\\s*(.*)$`);
const CHAPTER_RE = new RegExp(`^第[${CN}]+(编|分编|章)(\\s|$)`);
const SECTION_RE = new RegExp(`^第[${CN}]+节(\\s|$)`);

/** 中文日期 → YYYY-MM-DD。 */
export function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const DATE_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

/**
 * 从题注（例如「（2016年11月7日…通过　根据2025年10月28日…修正）」）推出版本日期和施行日期。
 * 版本日期取题注里最晚的、不是「起施行」的日期；施行日期取「自…起施行」。
 */
export function datesFromHistory(history) {
  let version = "", effective = "";
  for (const m of history.matchAll(DATE_RE)) {
    const d = isoDate(m[1], m[2], m[3]);
    const before = history.slice(Math.max(0, m.index - 2), m.index);
    const after = history.slice(m.index + m[0].length, m.index + m[0].length + 4);
    if (/^起(施行|实施|生效)/.test(after) || /自$/.test(before)) {
      effective = d;
      continue;
    }
    if (d > version) version = d;
  }
  return { version, effective };
}

/** 题注：正文开头括号里写通过、公布、修正经过的那一段。 */
export function findHistory(lines) {
  const head = lines.slice(0, 40).join("\n");
  const m = head.match(/[（(]\s*([^（）()]{6,1500}?(?:通过|公布|发布|修正|修订|批准)[^（）()]{0,1500}?)\s*[)）]/);
  return m ? m[1].replace(/\s*\n\s*/g, " ").trim() : "";
}

/**
 * 把正文行切成条文。返回 { articles, ok }；条号不是从第一条开始连续编号时 ok=false，
 * 调用方应改为整篇收录（决定、批复等）。
 */
export function splitArticles(lines) {
  const articles = [];
  let chapter = "", section = "", cur = null;
  for (const line of lines) {
    if (CHAPTER_RE.test(line) && line.length < 40) {
      chapter = line.replace(/\s+/g, " ");
      section = "";
      cur = null;
      continue;
    }
    if (SECTION_RE.test(line) && line.length < 40) {
      section = line.replace(/\s+/g, " ");
      cur = null;
      continue;
    }
    const m = line.match(ARTICLE_RE);
    if (m) {
      const no = cnToInt(m[2]);
      cur = { article_cn: m[1], article_no: no, sub: m[3] ? cnToInt(m[3]) : 0, chapter, section, text: m[1] + "　" + m[4] };
      articles.push(cur);
      continue;
    }
    if (cur) cur.text += cur.text.endsWith("　") ? line : "\n" + line;
  }
  for (const a of articles) a.text = a.text.replace(/　$/, "").trim();
  let expect = 1, ok = articles.length > 0;
  for (const a of articles) {
    if (a.sub) continue;
    if (a.article_no !== expect) { ok = false; break; }
    expect++;
  }
  return { articles, ok };
}

/** 标题规范化，用于把官方文本和本地已有法规对上号。 */
export function normTitle(t) {
  return (t || "")
    .replace(/\s+/g, "")
    .replace(/[（(]\s*\d{4}\s*年?\s*(修订|修正|版)?\s*[）)]$/, "")
    .replace(/\+\+/g, "、")
    .replace(/^最高人民法院、?最高人民检察院/, "最高人民法院最高人民检察院")
    .replace(/[〈<]/g, "《").replace(/[〉>]/g, "》")
    .replace(/[（]/g, "(").replace(/[）]/g, ")");
}

/** 取标题中最后一个书名号里的内容，例如「最高人民法院发布《关于…的规定》」。 */
export function innerTitle(t) {
  const m = [...(t || "").matchAll(/《([^《》]+)》/g)];
  return m.length ? m[m.length - 1][1] : t;
}
