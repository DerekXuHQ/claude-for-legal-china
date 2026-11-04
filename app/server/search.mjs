// 检索层：界面和 AI 代理共用。
import { diffArticles } from "./diff.mjs";

export const LEVELS = ["法律", "司法解释", "行政法规", "监察法规", "地方性法规"];
// 排序时让效力层级高的规定靠前（bm25 越小越相关，减去加权）
const LEVEL_BOOST = "CASE a.level WHEN '法律' THEN 8 WHEN '司法解释' THEN 6 WHEN '行政法规' THEN 5 WHEN '监察法规' THEN 4 ELSE 0 END";
const SPLIT = /[\s，,。;；、]+/;

let db = null;
export function setDb(conn) { db = conn; }

function terms(query) {
  // 三个字及以上走全文索引，一两个字的用 LIKE 兜底（trigram 索引不支持短词）
  const words = query.trim().split(SPLIT).filter(Boolean);
  return { long: words.filter((w) => [...w].length >= 3), short: words.filter((w) => [...w].length < 3) };
}

const ftsExpr = (ts, op = " AND ") => ts.map((t) => '"' + t.replace(/"/g, '""') + '"').join(op);

function snippet(text, query, width = 90) {
  text = text || "";
  const words = query.split(/\s+/).filter(Boolean);
  const hits = words.map((w) => text.indexOf(w)).filter((i) => i >= 0);
  const pos = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, pos - Math.floor(width / 3));
  const s = text.slice(start, start + width).replace(/\n/g, " ");
  return (start ? "…" : "") + s + (start + width < text.length ? "…" : "");
}

function lawFilters(alias, { level, province, topic, current_only }) {
  const where = [], params = [];
  if (level) { where.push(`${alias}.level = ?`); params.push(level); }
  if (province === "全国") where.push(`${alias}.province = '全国'`);
  else if (province) { where.push(`${alias}.province IN ('全国', ?)`); params.push(province); }
  if (topic) { where.push(`(',' || ${alias}.topics || ',') LIKE ?`); params.push(`%,${topic},%`); }
  if (current_only) where.push(`(${alias}.is_current = 1 OR ${alias}.status = '尚未生效')`);
  return { where, params };
}

export function searchArticles(query, { level = "", province = "", topic = "", current_only = true, limit = 20, offset = 0 } = {}) {
  const { long, short } = terms(query);
  const { where, params } = lawFilters("a", { level, province, topic, current_only });
  for (const t of short) { where.push("(a.text LIKE ? OR a.title LIKE ?)"); params.push(`%${t}%`, `%${t}%`); }
  const provBoost = province && province !== "全国" ? "(CASE WHEN a.province = ? THEN 3 ELSE 0 END)" : "0";
  const provArg = provBoost !== "0" ? [province] : [];
  const cond = where.length ? " AND " + where.join(" AND ") : "";
  let sql, args;
  if (long.length) {
    sql = `SELECT a.*, bm25(articles_fts, 4, 1) - ${LEVEL_BOOST} - ${provBoost} AS score FROM articles_fts f
           JOIN articles a ON a.rowid = f.rowid WHERE articles_fts MATCH ?${cond} ORDER BY score LIMIT ? OFFSET ?`;
    args = [...provArg, ftsExpr(long), ...params, limit + 1, offset];
  } else if (short.length) {
    sql = `SELECT a.*, -(${LEVEL_BOOST}) - ${provBoost} AS score FROM articles a WHERE 1=1${cond}
           ORDER BY score, a.doc_id, a.article_no LIMIT ? OFFSET ?`;
    args = [...provArg, ...params, limit + 1, offset];
  } else return { items: [], more: false };
  let rows = db.prepare(sql).all(...args);
  if (long.length > 1 && offset === 0 && rows.length < Math.min(limit, 8)) {
    // 关键词同时命中的太少：补充只命中部分关键词的结果，排在后面
    const seen = new Set(rows.map((r) => r.id));
    const extra = db.prepare(sql).all(...provArg, ftsExpr(long, " OR "), ...params, limit * 2, 0).filter((r) => !seen.has(r.id));
    rows = rows.concat(extra.slice(0, limit - rows.length));
  }
  const items = rows.slice(0, limit).map((r) => ({
    kind: "article", id: r.id, doc_id: r.doc_id, title: r.title, article: r.article_cn, chapter: r.chapter,
    level: r.level, status: r.status, province: r.province, snippet: snippet(r.text, query),
  }));
  return { items, more: rows.length > limit };
}

export function searchLaws(query, { level = "", province = "", topic = "", current_only = true, limit = 20, offset = 0 } = {}) {
  const { where, params } = lawFilters("d", { level, province, topic, current_only });
  where.unshift("d.title LIKE ?");
  params.unshift(`%${query.trim()}%`);
  const sql = `SELECT d.* FROM docs d WHERE ${where.join(" AND ")} ORDER BY
    CASE d.level WHEN '法律' THEN 0 WHEN '司法解释' THEN 1 WHEN '行政法规' THEN 2 WHEN '监察法规' THEN 3 ELSE 4 END,
    length(d.title), d.version_date DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, limit + 1, offset);
  return {
    items: rows.slice(0, limit).map((r) => ({
      kind: "law", id: r.id, doc_id: r.id, title: r.title, level: r.level, status: r.status, province: r.province,
      jurisdiction: r.jurisdiction, version_date: r.version_date, n_articles: r.n_articles, official: !!r.official,
      snippet: (r.history || "").slice(0, 120),
    })),
    more: rows.length > limit,
  };
}

function loose(table, cols, query, exclude, limit, order = "") {
  // 宽松匹配：任一关键词命中即可，按命中关键词数排序。只用于数据量小的案例和实务资料表。
  const words = query.trim().split(SPLIT).filter(Boolean);
  if (words.length < 2 || limit <= 0) return [];
  const hay = cols.map((c) => `coalesce(${c}, '')`).join(" || ' ' || ");
  const score = words.map(() => `(instr(${hay}, ?) > 0)`).join(" + ");
  const rows = db.prepare(`SELECT *, (${score}) AS hits FROM ${table} WHERE (${score}) > 0 ORDER BY hits DESC${order} LIMIT ?`)
    .all(...words, ...words, limit * 2);
  return rows.filter((r) => !exclude.has(r.id)).slice(0, limit);
}

export function searchCases(query, { limit = 20, offset = 0 } = {}) {
  const { long, short } = terms(query);
  let cond = "";
  const params = [];
  for (const t of short) { cond += " AND (c.text LIKE ?)"; params.push(`%${t}%`); }
  let rows;
  if (long.length) {
    rows = db.prepare(`SELECT c.*, bm25(cases_fts, 5, 4, 4, 2, 1) AS score FROM cases_fts f JOIN cases c ON c.rowid = f.rowid
      WHERE cases_fts MATCH ?${cond} ORDER BY score LIMIT ? OFFSET ?`).all(ftsExpr(long), ...params, limit + 1, offset);
  } else {
    rows = db.prepare(`SELECT c.* FROM cases c WHERE 1=1${cond} ORDER BY c.number DESC LIMIT ? OFFSET ?`).all(...params, limit + 1, offset);
  }
  if (offset === 0 && rows.length < 5) {
    rows = rows.concat(loose("cases", ["title", "keywords", "points", "text"], query, new Set(rows.map((r) => r.id)), limit - rows.length, ", number DESC"));
  }
  return {
    items: rows.slice(0, limit).map((r) => ({ kind: "case", id: r.id, title: r.title, keywords: r.keywords, snippet: snippet(r.points || r.text, query, 140) })),
    more: rows.length > limit,
  };
}

export function searchRefs(query, { limit = 20, offset = 0 } = {}) {
  const { long, short } = terms(query);
  let cond = "";
  const params = [];
  for (const t of short) { cond += " AND (r.text LIKE ? OR r.title LIKE ?)"; params.push(`%${t}%`, `%${t}%`); }
  let rows;
  if (long.length) {
    rows = db.prepare(`SELECT r.*, bm25(refs_fts, 4, 4, 1) AS score FROM refs_fts f JOIN refs r ON r.rowid = f.rowid
      WHERE refs_fts MATCH ?${cond} ORDER BY score LIMIT ? OFFSET ?`).all(ftsExpr(long), ...params, limit + 1, offset);
  } else {
    rows = db.prepare(`SELECT r.* FROM refs r WHERE 1=1${cond} LIMIT ? OFFSET ?`).all(...params, limit + 1, offset);
  }
  if (offset === 0 && rows.length < 5) {
    rows = rows.concat(loose("refs", ["title", "heading", "text"], query, new Set(rows.map((r) => r.id)), limit - rows.length));
  }
  return {
    items: rows.slice(0, limit).map((r) => ({ kind: "ref", id: r.id, title: r.title, heading: r.heading, ref_kind: r.kind, plugin: r.plugin, snippet: snippet(r.text, query, 140) })),
    more: rows.length > limit,
  };
}

const DOC_META = "source, source_url, version_date, effective_date, history, note, official, checked_at";

export function getArticle(id) {
  const r = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (!r) return null;
  const d = db.prepare(`SELECT ${DOC_META} FROM docs WHERE id = ?`).get(r.doc_id) || {};
  return {
    kind: "article", id: r.id, doc_id: r.doc_id, title: r.title, article: r.article_cn, chapter: r.chapter, section: r.section,
    text: r.text, level: r.level, status: r.status, province: r.province, source: d.source || "", source_url: d.source_url || "",
    version_date: d.version_date || "", effective_date: d.effective_date || "", note: d.note || "", official: !!d.official, checked_at: d.checked_at || "",
  };
}

export function getDoc(id) {
  const d = db.prepare("SELECT * FROM docs WHERE id = ?").get(id);
  if (!d) return null;
  const articles = db.prepare("SELECT id, article_cn, chapter, section, text FROM articles WHERE doc_id = ? ORDER BY article_no, rowid").all(id);
  const others = db.prepare("SELECT id, status, version_date, official FROM docs WHERE title = ? AND jurisdiction = ? AND id != ? ORDER BY version_date DESC")
    .all(d.title, d.jurisdiction, id);
  // 名称带「（2026年修订）」之类后缀的版本也算同一部法规
  const base = d.title.replace(/[（(]\d{4}年?(修订|修正)?[）)]$/, "");
  const more = db.prepare("SELECT id, status, version_date, official FROM docs WHERE (title = ? OR title LIKE ?) AND province = ? AND id != ? AND title != ?")
    .all(base, base + "（%", d.province, id, d.title).filter((o) => !others.some((x) => x.id === o.id));
  return { ...d, official: !!d.official, kind: "law", articles, other_versions: [...others, ...more].sort((a, b) => (b.version_date || "").localeCompare(a.version_date || "")) };
}

export function compareVersions(newId, oldId) {
  const a = db.prepare("SELECT id, title, version_date, status FROM docs WHERE id = ?").get(newId);
  const b = db.prepare("SELECT id, title, version_date, status FROM docs WHERE id = ?").get(oldId);
  if (!a || !b) return null;
  const arts = (id) => db.prepare("SELECT id, article_cn, text FROM articles WHERE doc_id = ? ORDER BY article_no, rowid").all(id);
  // 始终让日期较新的一方作为「新版」
  const [n, o] = (a.version_date || "") >= (b.version_date || "") ? [a, b] : [b, a];
  return { new: n, old: o, diff: diffArticles(arts(o.id), arts(n.id)) };
}

export function getCase(id) {
  const r = db.prepare("SELECT * FROM cases WHERE id = ?").get(id);
  return r ? { ...r, kind: "case" } : null;
}

export function getRef(id) {
  const r = db.prepare("SELECT * FROM refs WHERE id = ?").get(id);
  return r ? { ...r, kind_label: r.kind, kind: "ref" } : null;
}

export function outline(docId, chapter = "") {
  // 不带 chapter 时返回各章及条号范围；带 chapter 时返回该章每条的开头
  const d = db.prepare("SELECT id, title, level, status, province, version_date, effective_date, history, note FROM docs WHERE id = ?").get(docId);
  if (!d) return null;
  const rows = db.prepare("SELECT id, article_cn, chapter, text FROM articles WHERE doc_id = ? ORDER BY article_no, rowid").all(docId);
  if (chapter) {
    return { ...d, chapter, articles: rows.filter((r) => (r.chapter || "").includes(chapter)).slice(0, 120).map((r) => ({ id: r.id, article: r.article_cn, start: r.text.slice(0, 80) })) };
  }
  const chapters = new Map();
  for (const r of rows) {
    const ch = r.chapter || "（无章节）";
    if (!chapters.has(ch)) chapters.set(ch, [r.article_cn, r.article_cn]);
    chapters.get(ch)[1] = r.article_cn;
  }
  return { ...d, n_articles: rows.length, chapters: [...chapters].map(([c, [from, to]]) => ({ chapter: c, from, to })) };
}

export function meta() {
  const provinces = db.prepare("SELECT province FROM docs WHERE province NOT IN ('全国','其他') GROUP BY province ORDER BY count(*) DESC").all().map((r) => r.province);
  const counts = Object.fromEntries(db.prepare("SELECT level, count(*) n FROM docs WHERE is_current = 1 GROUP BY level").all().map((r) => [r.level, r.n]));
  const official = Object.fromEntries(db.prepare("SELECT level, count(*) n FROM docs WHERE is_current = 1 AND official = 1 GROUP BY level").all().map((r) => [r.level, r.n]));
  const info = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
  return {
    levels: LEVELS, provinces, counts, official, ...info,
    topics: JSON.parse(info.topics || "[]"),
    articles: db.prepare("SELECT count(*) n FROM articles WHERE is_current = 1").get().n,
    cases: db.prepare("SELECT count(*) n FROM cases").get().n,
    refs: db.prepare("SELECT count(*) n FROM refs").get().n,
  };
}

/* ---------------- 浏览（目录） ---------------- */

const collator = new Intl.Collator("zh-Hans-CN-u-co-pinyin");
const LEVEL_ORDER = { 法律: 0, 司法解释: 1, 行政法规: 2, 监察法规: 3, 地方性法规: 4 };
const CURRENT = "(is_current = 1 OR status = '尚未生效')";

function browseWhere({ level = "", province = "", topic = "" }) {
  const where = [CURRENT], params = [];
  if (level) { where.push("level = ?"); params.push(level); }
  if (province === "全国") where.push("province = '全国'");
  else if (province) { where.push("province = ?"); params.push(province); }
  if (topic) { where.push("(',' || topics || ',') LIKE ?"); params.push(`%,${topic},%`); }
  return { sql: where.join(" AND "), params };
}

/** 现行法规目录。排序：name 按拼音，date 按日期新到旧。 */
export function browseLaws({ level = "", province = "", topic = "", sort = "name", offset = 0, limit = 200 } = {}) {
  const w = browseWhere({ level, province, topic });
  const rows = db.prepare(`SELECT id, title, level, status, province, version_date, effective_date, official, n_articles FROM docs WHERE ${w.sql}`).all(...w.params);
  if (sort === "date") rows.sort((a, b) => (b.version_date || "").localeCompare(a.version_date || "") || collator.compare(a.title, b.title));
  else rows.sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) || collator.compare(a.title.replace(/^中华人民共和国/, ""), b.title.replace(/^中华人民共和国/, "")));
  return { total: rows.length, items: rows.slice(offset, offset + limit).map((r) => ({ ...r, kind: "law", official: !!r.official })) };
}

/** 各筛选项下的数量，用于目录左侧的分类。 */
export function browseFacets({ level = "", province = "", topic = "" } = {}) {
  const count = (col, filters) => {
    const w = browseWhere(filters);
    return Object.fromEntries(db.prepare(`SELECT ${col} k, count(*) n FROM docs WHERE ${w.sql} GROUP BY ${col}`).all(...w.params).map((r) => [r.k, r.n]));
  };
  const levels = count("level", { province, topic });
  const provinces = count("province", { level, topic });
  const topics = {};
  const w = browseWhere({ level, province });
  for (const r of db.prepare(`SELECT topics FROM docs WHERE ${w.sql}`).all(...w.params)) {
    for (const t of (r.topics || "").split(",")) if (t) topics[t] = (topics[t] || 0) + 1;
  }
  return { levels, provinces, topics };
}

export function browseCases({ offset = 0, limit = 400 } = {}) {
  const total = db.prepare("SELECT count(*) n FROM cases").get().n;
  const items = db.prepare("SELECT id, number, title, keywords FROM cases ORDER BY number LIMIT ? OFFSET ?").all(limit, offset);
  return { total, items: items.map((r) => ({ ...r, kind: "case" })) };
}

export const PLUGIN_LABEL = {
  "commercial-legal": "商事合同", "corporate-legal": "公司与并购", "employment-legal": "劳动用工", "privacy-legal": "个人信息与数据",
  "product-legal": "产品合规", "regulatory-legal": "监管合规", "ai-governance-legal": "人工智能治理", "litigation-legal": "诉讼仲裁",
  "ip-legal": "知识产权", "criminal-legal": "刑事辩护", "law-student": "法学学习", "legal-clinic": "法律援助",
  "legal-research-cn": "法律检索方法", "procurement-legal": "采购与招投标", "law-practice-cn": "律所实务", "仓库共享": "通用",
};

/** 办案指引目录：每篇文档一项，按领域分组。 */
export function browseGuides() {
  const rows = db.prepare("SELECT kind, plugin, path, title, heading, id FROM refs ORDER BY rowid").all();
  const docs = new Map();
  for (const r of rows) {
    const key = "doc:" + r.path;
    if (!docs.has(key)) docs.set(key, { id: key, kind_label: r.kind === "处理流程" ? "流程" : "要点", plugin: r.plugin, title: r.title, summary: r.id.endsWith("#0") ? r.heading : "" });
  }
  const groups = new Map();
  for (const d of docs.values()) {
    const label = PLUGIN_LABEL[d.plugin] || d.plugin;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(d);
  }
  return [...groups].map(([label, items]) => ({ label, items: items.sort((a, b) => a.kind_label.localeCompare(b.kind_label) || collator.compare(a.title, b.title)) }))
    .sort((a, b) => (a.label === "通用" ? -1 : b.label === "通用" ? 1 : collator.compare(a.label, b.label)));
}

/** 读一篇办案指引（整篇）；检索结果里的分段编号也能打开，打开的是所在的整篇。 */
export function getGuide(id) {
  let path = id.startsWith("doc:") ? id.slice(4) : db.prepare("SELECT path FROM refs WHERE id = ?").get(id)?.path;
  if (!path) return null;
  const rows = db.prepare("SELECT * FROM refs WHERE path = ? ORDER BY rowid").all(path);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    kind: "ref", id: "doc:" + path, kind_label: r.kind === "处理流程" ? "流程" : "要点", plugin: r.plugin,
    plugin_label: PLUGIN_LABEL[r.plugin] || r.plugin, path, title: r.title, summary: r.id.endsWith("#0") ? r.heading : "",
    text: rows.map((x) => x.text).join("\n\n"),
  };
}

/** 合并检索：名称匹配的法规排在前面，然后是条文匹配。 */
export function searchAll(query, opts = {}) {
  const arts = searchArticles(query, opts);
  if (opts.offset) return arts;
  const laws = searchLaws(query.replace(/\s+/g, ""), { ...opts, limit: 10, offset: 0 });
  return { items: [...laws.items, ...arts.items], more: arts.more, title_hits: laws.items.length };
}
