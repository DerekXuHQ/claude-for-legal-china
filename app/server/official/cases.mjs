// 最高人民法院指导性案例：court.gov.cn「指导案例」栏目。
import { getText, HttpError } from "./fetch.mjs";
import { htmlToLines, sliceBetween, unescapeHTML } from "./parse.mjs";

const BASE = "https://www.court.gov.cn";
const CASE_RE = /指导性?案例\s*(\d+)\s*号/;
const HEAD_RE = /^(关键词|[一-龥]{0,4}要点|相关法条|基本案情|裁判结果|执行结果|裁判理由|执行理由)\s*(.*)$/;
const SECTIONS = new Set(["关键词", "裁判要点", "相关法条", "基本案情", "裁判结果", "裁判理由"]);
const ALIAS = { 执行结果: "裁判结果", 执行理由: "裁判理由" };

export async function* listCases({ maxPages = 2, signal } = {}) {
  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/shenpan/gengduo/77${page === 1 ? "" : "_" + page}.html`;
    let html;
    try { html = await getText(url, { signal }); } catch (e) { if (e instanceof HttpError && e.status === 404) return; throw e; }
    const items = [...html.matchAll(/href="(\/shenpan\/xiangqing\/\d+\.html)"[^>]*>([^<]{4,200})</g)];
    if (!items.length) return;
    for (const [, href, raw] of items) {
      const title = unescapeHTML(raw).replace(/\.\.\.$/, "").trim();
      if (CASE_RE.test(title)) yield { url: BASE + href, title };
    }
  }
}

export function splitSections(lines) {
  const parts = {};
  let cur = null;
  for (const line of lines) {
    const h = line.match(HEAD_RE);
    if (h && (SECTIONS.has(h[1]) || ALIAS[h[1]] || h[1].endsWith("要点"))) {
      cur = h[1].endsWith("要点") ? "裁判要点" : ALIAS[h[1]] || h[1];
      parts[cur] ||= [];
      if (h[2]) parts[cur].push(h[2]);
    } else if (cur) parts[cur].push(line);
  }
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.join("\n").trim()]));
}

export async function fetchCase(item, { signal } = {}) {
  const html = await getText(item.url, { signal });
  const body = sliceBetween(html, ['<div class="txt_txt"', '<div class="detail"'], ['<div class="txt_etr"', 'class="share', 'class="bottom']);
  const lines = htmlToLines(body.replace(/^<div class="[^"]*"[^>]*>/, "")).filter((l) => !l.startsWith("责任编辑"));
  const text = lines.join("\n");
  const no = item.title.match(CASE_RE) || text.match(CASE_RE);
  return { url: item.url, number: no ? Number(no[1]) : null, title: item.title, sections: splitSections(lines), text };
}

export function upsertCase(db, c) {
  const s = c.sections || {};
  const id = c.number ? `GC${c.number}` : c.url.split("/").pop().split(".")[0];
  const hasNote = db.prepare("PRAGMA table_info(cases)").all().some((c) => c.name === "note");
  const old = db.prepare(`SELECT rowid, title, keywords, points, laws, text${hasNote ? ", note" : ""} FROM cases WHERE id = ?`).get(id);
  const fts = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='cases_fts'").get();
  if (old && fts) {
    db.prepare("INSERT INTO cases_fts(cases_fts, rowid, title, keywords, points, laws, text) VALUES('delete', ?, ?, ?, ?, ?, ?)")
      .run(old.rowid, old.title, old.keywords, old.points, old.laws, old.text);
  }
  if (old) db.prepare("DELETE FROM cases WHERE id = ?").run(id);
  const r = db.prepare("INSERT INTO cases(id,number,title,keywords,points,laws,facts,result,reasoning,url,text) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, c.number, c.title, s["关键词"] || "", s["裁判要点"] || "", s["相关法条"] || "", s["基本案情"] || "", s["裁判结果"] || "", s["裁判理由"] || "", c.url, c.text);
  // 保留「不再参照」等状态说明
  if (hasNote && old?.note) db.prepare("UPDATE cases SET note = ? WHERE id = ?").run(old.note, id);
  if (fts) {
    db.prepare("INSERT INTO cases_fts(rowid, title, keywords, points, laws, text) VALUES(?,?,?,?,?,?)")
      .run(r.lastInsertRowid, c.title, s["关键词"] || "", s["裁判要点"] || "", s["相关法条"] || "", c.text);
  }
  return { id, isNew: !old };
}
