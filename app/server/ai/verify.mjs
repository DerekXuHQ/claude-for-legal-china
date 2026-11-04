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
