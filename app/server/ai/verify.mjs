// 引用核对：扫描回答里的「《某法》第某条」，能在资料库对上的加上原文链接，对不上的标出来。
// 防止编造的或已失效的依据混进回答（调研里提到的「错误挂靠」由回答阶段的检索约束和复核处理）。

const DIGIT = "零一二三四五六七八九";

export function toChineseNumber(n) {
  n = Number(n);
  if (!Number.isInteger(n) || n <= 0 || n >= 10000) return String(n);
  const units = ["", "十", "百", "千"];
  const ds = String(n).split("").map(Number);
  let out = "", zero = false;
  ds.forEach((d, i) => {
    const u = units[ds.length - 1 - i];
    if (d === 0) { zero = true; return; }
    if (zero && out) out += "零";
    zero = false;
    out += (d === 1 && u === "十" && i === 0 ? "" : DIGIT[d]) + u;
  });
  return out;
}

const ARTICLE = /《([^《》\n]{2,60})》\s*(?:（[^）]{0,20}）)?\s*第\s*([0-9]+|[零〇一二三四五六七八九十百千]+)\s*条(?:\s*之\s*[一二三四五六七八九十]+)?/g;

function findDoc(db, title) {
  const t = title.replace(/\s+/g, "");
  const tries = [t, t.startsWith("中华人民共和国") ? t.slice(7) : "中华人民共和国" + t];
  for (const x of tries) {
    const d = db.prepare("SELECT id, title, status FROM docs WHERE replace(title,' ','') = ? AND (is_current = 1 OR status = '尚未生效') ORDER BY is_current DESC LIMIT 1").get(x);
    if (d) return d;
  }
  // 常见简称：民法典、公司法、劳动合同法……
  const d = db.prepare("SELECT id, title, status FROM docs WHERE is_current = 1 AND level IN ('法律','司法解释','行政法规') AND title LIKE ? ORDER BY length(title) LIMIT 1").get(`%${t}`);
  return d || null;
}

/**
 * @returns {{ text: string, checked: number, linked: number, unverified: string[] }}
 */
export function verifyCitations(db, markdown) {
  let checked = 0, linked = 0;
  const unverified = [];
  const cache = new Map();
  const text = markdown.replace(ARTICLE, (whole, title, num, offset, all) => {
    checked++;
    const after = all.slice(offset + whole.length, offset + whole.length + 4);
    if (after.startsWith("[[") || after.startsWith("〔资料库")) return whole;
    const cn = /^\d+$/.test(num) ? toChineseNumber(num) : num;
    const key = title + "|" + cn;
    if (!cache.has(key)) {
      const doc = findDoc(db, title);
      const art = doc && db.prepare("SELECT id FROM articles WHERE doc_id = ? AND article_cn = ?").get(doc.id, `第${cn}条`);
      cache.set(key, art ? art.id : null);
    }
    const id = cache.get(key);
    if (id) { linked++; return `${whole}[[art:${id}]]`; }
    unverified.push(`《${title}》第${cn}条`);
    return `${whole}〔资料库未核实〕`;
  });
  return { text, checked, linked, unverified: [...new Set(unverified)] };
}

// ---- 已废止的法律：答案里引用了，就标出现行对应依据（讲新旧衔接、同段已出现现行法的除外）----
const REPEALED = {
  合同法: "《民法典》合同编", 民法通则: "《民法典》总则编等", 民法总则: "《民法典》总则编", 物权法: "《民法典》物权编",
  担保法: "《民法典》物权编、合同编（担保部分）", 侵权责任法: "《民法典》侵权责任编", 婚姻法: "《民法典》婚姻家庭编",
  继承法: "《民法典》继承编", 收养法: "《民法典》婚姻家庭编（收养）",
};
const REPEALED_RE = /《(?:中华人民共和国)?(合同法|民法通则|民法总则|物权法|担保法|侵权责任法|婚姻法|继承法|收养法)》(?:\s*第[^条，。；\n]{1,10}条(?:之[一二三四五六七八九十]+)?)?(?:\[\[[^\]]+\]\]|〔[^〕]*〕)?/g;
export function flagRepealed(markdown) {
  let n = 0;
  const text = markdown.split(/\n{2,}/).map((para) => {
    if (/民法典/.test(para) && /(废止|施行前|原《|旧法|衔接)/.test(para)) return para;
    const done = new Set();
    return para.replace(REPEALED_RE, (whole, name) => {
      if (done.has(name)) return whole;
      done.add(name); n++;
      return `${whole}〔已于 2021-01-01 废止，现行依据为${REPEALED[name]}〕`;
    });
  }).join("\n\n");
  return { text, flagged: n };
}

// ---- 依据对照：每个挂了条文的句子，只给它所引条文的原文，单独判断原文是否支持这句话（CoVe 式独立核对）----
export function citedSentences(db, markdown) {
  const out = [];
  const get = db.prepare("SELECT a.id, a.text, a.article_cn, d.title FROM articles a JOIN docs d ON d.id = a.doc_id WHERE a.id = ?");
  // 模型常把引用标记放在句号后面（「……计算。[[art:x]]」）：把开头的引用标记并回上一句
  const segs = [];
  for (const seg of markdown.split(/(?<=[。；！？\n])/)) {
    const lead = seg.match(/^(?:\s*\[\[[^\]]+\]\])+/);
    if (lead && segs.length) { segs[segs.length - 1] += lead[0]; if (seg.slice(lead[0].length)) segs.push(seg.slice(lead[0].length)); }
    else segs.push(seg);
  }
  for (const sentence of segs) {
    const ids = [...sentence.matchAll(/\[\[art:([^\]]+)\]\]/g)].map((m) => m[1]);
    if (!ids.length) continue;
    // 只有引用标记、没有实际说法的片段不核对
    if (sentence.replace(/\[\[[^\]]+\]\]/g, "").replace(/[\s|#*>-]/g, "").length < 8) continue;
    const sources = [...new Set(ids)].map((id) => get.get(id)).filter(Boolean).map((a) => ({ id: a.id, line: `《${a.title}》${a.article_cn}：${a.text.slice(0, 700)}` }));
    if (sources.length) out.push({ sentence: sentence.trim(), sources });
    if (out.length >= 25) break;
  }
  return out;
}
