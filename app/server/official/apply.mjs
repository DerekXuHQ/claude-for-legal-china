// 把一份官方文本并入本地资料库。
//
// 判断规则：
// - 本地没有同名法规：作为新法规加入。
// - 本地有同一版本（版本日期相同，或相差不到 90 天且 95% 以上条文相同）：用官方全文替换本地文本。
// - 官方版本比本地最新版本新：作为新版本加入；已施行的设为现行版本，旧版本标「旧版本」；
//   尚未施行的标「尚未生效」，现行版本加注说明。
// - 官方版本比本地旧：不处理。
import { createHash } from "node:crypto";
import { normTitle } from "./parse.mjs";
import { diffArticles, diffSummary } from "../diff.mjs";
import { topicsFor } from "../topics.mjs";

// 人大和最高法的栏目会列出已废止或已被修改吸收的旧文件。基础数据（2026-08-26 快照）收录了当时全部现行有效的文件，
// 所以本地没有、又早于 2026 年的文件不当作现行规定收录。国家行政法规库只列现行有效的，不受此限。
const OLD_CUTOFF = "2026-01-01";
const ART_COLS = "id,doc_id,title,article_no,article_cn,chapter,section,text,level,status,is_current,province,topics";

export function ensureOfficialColumns(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(docs)").all().map((c) => c.name));
  if (!cols.has("effective_date")) db.exec("ALTER TABLE docs ADD COLUMN effective_date TEXT DEFAULT ''");
  if (!cols.has("official")) db.exec("ALTER TABLE docs ADD COLUMN official INT DEFAULT 0");
  if (!cols.has("checked_at")) db.exec("ALTER TABLE docs ADD COLUMN checked_at TEXT DEFAULT ''");
}

function hasFts(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='articles_fts'").get();
}

function deleteArticles(db, docId) {
  if (hasFts(db)) {
    db.prepare("INSERT INTO articles_fts(articles_fts, rowid, title, text) SELECT 'delete', rowid, title, text FROM articles WHERE doc_id = ?").run(docId);
  }
  db.prepare("DELETE FROM articles WHERE doc_id = ?").run(docId);
}

function insertArticles(db, doc, rec) {
  const ins = db.prepare(`INSERT INTO articles(${ART_COLS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const fts = hasFts(db) ? db.prepare("INSERT INTO articles_fts(rowid, title, text) VALUES(?,?,?)") : null;
  const arts = rec.articles.length ? rec.articles : [{ article_cn: "全文", article_no: 0, chapter: "", section: "", text: rec.fulltext }];
  const used = new Set();
  let n = 0;
  for (const a of arts) {
    let id = `${doc.id}:${a.article_cn}`;
    for (let k = 2; used.has(id); k++) id = `${doc.id}:${a.article_cn}#${k}`;
    used.add(id);
    const r = ins.run(id, doc.id, doc.title, a.article_no ?? ++n, a.article_cn, a.chapter || "", a.section || "", a.text,
      doc.level, doc.status, doc.is_current, doc.province, doc.topics);
    fts?.run(r.lastInsertRowid, doc.title, a.text);
  }
  db.prepare("UPDATE docs SET n_articles = ? WHERE id = ?").run(rec.articles.length, doc.id);
}

function setStatus(db, docId, status, isCurrent) {
  db.prepare("UPDATE docs SET status = ?, is_current = ? WHERE id = ?").run(status, isCurrent, docId);
  db.prepare("UPDATE articles SET status = ?, is_current = ? WHERE doc_id = ?").run(status, isCurrent, docId);
}

function articlesOf(db, docId) {
  return db.prepare("SELECT id, article_cn, text FROM articles WHERE doc_id = ? ORDER BY article_no, rowid").all(docId);
}

function recArticles(rec) {
  return rec.articles.length ? rec.articles : [{ article_cn: "全文", text: rec.fulltext }];
}

function daysBetween(a, b) {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
}

// 司法解释的制定机关写法不统一（「最高人民法院」「最高人民法院、最高人民检察院」「最高人民法院++最高人民检察院」），
// 按「关于……」之后的部分匹配
const afterGuanyu = (t) => normTitle(t).replace(/^[^关]*?关于/, "关于");

export function candidatesFor(db, rec) {
  const key = normTitle(rec.title);
  if (rec.level === "司法解释" && /关于/.test(key)) {
    const k2 = afterGuanyu(rec.title);
    const probe = k2.replace(/^关于/, "").slice(0, 8);
    return db.prepare("SELECT * FROM docs WHERE level = '司法解释' AND province = '全国' AND title LIKE ?")
      .all(`%${probe}%`)
      .filter((d) => afterGuanyu(d.title) === k2);
  }
  const prefix = rec.title.replace(/\s+/g, "").slice(0, 6);
  return db.prepare("SELECT * FROM docs WHERE level = ? AND province = '全国' AND replace(title, ' ', '') LIKE ?")
    .all(rec.level, prefix + "%")
    .filter((d) => normTitle(d.title) === key);
}

/**
 * @returns {{action:string, doc_id:string, title:string, summary:string, diff?:object, compare_to?:string}}
 */
export function applyOfficialDoc(db, rec, today = new Date().toISOString().slice(0, 10)) {
  ensureOfficialColumns(db);
  if (!rec.title || (!rec.articles.length && (rec.fulltext || "").length < 30)) {
    return { action: "unparsed", doc_id: "", title: rec.title, summary: "页面没有解析出正文，未处理" };
  }
  // 标题把正文吞进去的情况：截到第一个括号或「根据」之前
  if (rec.title.length > 100 || rec.title.includes("。")) {
    rec = { ...rec, title: rec.title.split(/[（(]\d{4}年|根据/)[0].slice(0, 100) };
  }
  const cands = candidatesFor(db, rec);
  const latest = cands.reduce((m, d) => (!m || (d.version_date || "") > (m.version_date || "") ? d : m), null);
  const sourceLabel = `${rec.source_name}（官方全文）`;
  const updateMeta = (docId) => db.prepare(
    "UPDATE docs SET source = ?, source_url = ?, official = 1, checked_at = ?, effective_date = coalesce(nullif(?, ''), effective_date), " +
    "history = coalesce(nullif(?, ''), history), doc_number = coalesce(nullif(doc_number, ''), ?) WHERE id = ?",
  ).run(sourceLabel, rec.url, today, rec.effective_date || "", rec.history || "", rec.doc_number || "", docId);

  db.exec("BEGIN");
  try {
    // 同一版本：用官方全文替换
    let same = cands.find((d) => d.version_date === rec.version_date);
    if (!same && latest && rec.version_date && daysBetween(latest.version_date, rec.version_date) <= 90) {
      const d = diffArticles(articlesOf(db, latest.id), recArticles(rec));
      if (d.same_ratio >= 0.95) same = latest;
    }
    if (!same && !rec.version_date) {
      // 页面上没找到版本日期：条文基本相同就当作同一版本，否则不处理
      const d = latest && diffArticles(articlesOf(db, latest.id), recArticles(rec));
      if (d && d.same_ratio >= 0.9) same = latest;
      else {
        db.exec("COMMIT");
        return { action: "unparsed", doc_id: latest?.id || "", title: rec.title, summary: "页面上没有找到版本日期，未处理" };
      }
    }
    if (same) {
      const d = diffArticles(articlesOf(db, same.id), recArticles(rec));
      const doc = { ...same };
      deleteArticles(db, same.id);
      insertArticles(db, doc, rec);
      updateMeta(same.id);
      db.exec("COMMIT");
      return { action: d.identical ? "confirmed" : "text_corrected", doc_id: same.id, title: same.title,
        summary: d.identical ? "与官方全文一致，已标记为官方文本" : `已按官方全文更正：${diffSummary(d)}`, diff: d.identical ? undefined : d };
    }
    if (latest && rec.version_date && rec.version_date < (latest.version_date || "")) {
      db.exec("COMMIT");
      return { action: "older", doc_id: latest.id, title: rec.title, summary: `官方页面是 ${rec.version_date} 的旧版本，本地已有 ${latest.version_date} 版，未处理` };
    }
    // 本地没有、又早于 OLD_CUTOFF 的文件：可能已废止或已被修改吸收，不当作现行规定收录
    if (!latest && rec.source !== "moj" && (rec.version_date || "") < OLD_CUTOFF) {
      db.exec("COMMIT");
      return { action: "skipped_old", doc_id: "", title: rec.title, summary: `${rec.version_date || "日期不详"} 的旧文件，本地现行库里没有，可能已废止或已被修改吸收，未收录` };
    }
    // 新法规或新版本
    const pending = !!(rec.effective_date && rec.effective_date > today);
    const status = pending ? "尚未生效" : "有效";
    const isCurrent = pending ? 0 : 1;
    const doc = {
      id: "off_" + createHash("sha1").update(rec.url).digest("hex").slice(0, 14),
      title: rec.title, level: rec.level, status, is_current: isCurrent, province: "全国", topics: topicsFor(rec.title),
    };
    if (db.prepare("SELECT 1 FROM docs WHERE id = ?").get(doc.id)) deleteArticles(db, doc.id);
    db.prepare("DELETE FROM docs WHERE id = ?").run(doc.id);
    db.prepare(
      "INSERT INTO docs(id,title,level,status,is_current,jurisdiction,province,issuer,doc_number,version_date,listed_date,history,source,source_url,n_articles,topics,note,effective_date,official,checked_at) " +
      "VALUES(?,?,?,?,?,'全国','全国',?,?,?,?,?,?,?,0,?,'',?,1,?)",
    ).run(doc.id, doc.title, doc.level, status, isCurrent, rec.issuer || "", rec.doc_number || "", rec.version_date || today, today,
      rec.history || "", sourceLabel, rec.url, doc.topics, rec.effective_date || "", today);
    insertArticles(db, doc, rec);
    let diff, summary;
    if (latest) {
      diff = diffArticles(articlesOf(db, latest.id), recArticles(rec));
      summary = `新版本（${rec.version_date}${rec.effective_date ? "，" + rec.effective_date + " 起施行" : ""}）：${diffSummary(diff)}`;
      if (pending) {
        db.prepare("UPDATE docs SET note = ? WHERE id = ?").run(
          `本法规已于 ${rec.version_date} 公布新版本，自 ${rec.effective_date} 起施行；在此之前仍适用本版本。新版见「${rec.title}」${rec.version_date} 版。`, latest.id);
      } else {
        for (const c of cands) if (c.is_current) setStatus(db, c.id, "旧版本", 0);
        db.prepare("UPDATE docs SET note = ? WHERE id = ?").run(`已被 ${rec.version_date} 公布的新版本取代。`, latest.id);
      }
    } else {
      summary = `新增${rec.level}（${rec.version_date}${rec.effective_date ? "，" + rec.effective_date + " 起施行" : ""}）`;
    }
    // 修改决定：在被修改的法律上加注
    const amended = rec.title.match(/关于修改《([^》]+)》(等[^的]*)?的决定$/);
    if (amended) {
      const target = db.prepare("SELECT id, version_date FROM docs WHERE replace(title,' ','') = ? AND province = '全国' AND is_current = 1")
        .get(amended[1].replace(/[〈〉]/g, "").replace(/\s+/g, ""));
      if (target && (target.version_date || "") < (rec.version_date || "")) {
        db.prepare("UPDATE docs SET note = ? WHERE id = ?").run(
          `本法已由 ${rec.version_date}《${rec.title.replace(/^全国人民代表大会常务委员会/, "")}》修改${rec.effective_date ? "，自 " + rec.effective_date + " 起施行" : ""}。修改后的全文尚未收录，请结合该决定理解本版本。`, target.id);
      }
    }
    db.exec("COMMIT");
    return { action: latest ? "new_version" : "new", doc_id: doc.id, title: doc.title, summary, diff, compare_to: latest?.id };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** 到了施行日期的「尚未生效」版本转为现行版本。返回转正的法规列表。 */
export function promotePending(db, today = new Date().toISOString().slice(0, 10)) {
  ensureOfficialColumns(db);
  const due = db.prepare("SELECT * FROM docs WHERE status = '尚未生效' AND effective_date != '' AND effective_date <= ?").all(today);
  const out = [];
  for (const d of due) {
    db.exec("BEGIN");
    try {
      const others = candidatesFor(db, d).filter((c) => c.id !== d.id && c.is_current);
      for (const c of others) {
        setStatus(db, c.id, "旧版本", 0);
        db.prepare("UPDATE docs SET note = ? WHERE id = ?").run(`已被 ${d.version_date} 公布、${d.effective_date} 起施行的新版本取代。`, c.id);
      }
      setStatus(db, d.id, "有效", 1);
      db.prepare("UPDATE docs SET note = '' WHERE id = ?").run(d.id);
      db.exec("COMMIT");
      out.push({ doc_id: d.id, title: d.title, effective_date: d.effective_date });
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return out;
}
