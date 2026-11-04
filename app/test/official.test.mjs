import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { cnToInt, datesFromHistory, splitArticles, normTitle, htmlToLines } from "../server/official/parse.mjs";
import { diffArticles } from "../server/diff.mjs";
import { applyOfficialDoc, promotePending } from "../server/official/apply.mjs";

test("中文数字", () => {
  assert.equal(cnToInt("一"), 1);
  assert.equal(cnToInt("十"), 10);
  assert.equal(cnToInt("十二"), 12);
  assert.equal(cnToInt("一百零五"), 105);
  assert.equal(cnToInt("一千二百六十"), 1260);
});

test("题注里的版本日期和施行日期", () => {
  const d = datesFromHistory("1999年4月3日中华人民共和国国务院令第262号发布 根据2019年3月24日《国务院关于修改部分行政法规的决定》第二次修订 自2019年5月1日起施行");
  assert.deepEqual(d, { version: "2019-03-24", effective: "2019-05-01" });
});

test("切分条文：章节、条号、多段", () => {
  const lines = htmlToLines("<div>第一章　总　则</div><div>第一条</div><div>为了……，制定本法。</div><div>第二条　本法适用于……</div><div>第二款内容。</div><div>第二章 附则</div><div>第三条 本法自2027年1月1日起施行。</div>");
  const { articles, ok } = splitArticles(lines);
  assert.ok(ok);
  assert.equal(articles.length, 3);
  assert.equal(articles[0].text, "第一条　为了……，制定本法。");
  assert.equal(articles[1].text, "第二条　本法适用于……\n第二款内容。");
  assert.equal(articles[2].chapter, "第二章 附则");
});

test("条号不连续时整篇收录", () => {
  const { ok } = splitArticles(["一、将第一条修改为：", "第三条 ……"]);
  assert.equal(ok, false);
});

test("标题规范化", () => {
  assert.equal(normTitle("最高人民法院 最高人民检察院关于办理X案件的解释"), normTitle("最高人民法院、最高人民检察院关于办理X案件的解释"));
  assert.equal(normTitle("中华人民共和国商标法（2026年修订）"), "中华人民共和国商标法");
});

test("逐条对比：改号、修改、新增、删除", () => {
  const old = [
    { article_cn: "第一条", text: "第一条　为了保护商标专用权，制定本法。" },
    { article_cn: "第二条", text: "第二条　国务院工商行政管理部门商标局主管全国商标注册和管理的工作。" },
    { article_cn: "第三条", text: "第三条　这一条会被删除，内容完全不同的一段话。" },
  ];
  const neu = [
    { article_cn: "第一条", text: "第一条　为了保护商标专用权，制定本法。" },
    { article_cn: "第二条", text: "第二条　新增的一条，讲的是别的事情，和旧条文毫无关系。" },
    { article_cn: "第三条", text: "第三条　国务院知识产权行政部门主管全国商标注册和管理的工作。" },
  ];
  const d = diffArticles(old, neu);
  assert.equal(d.unchanged, 1);
  assert.equal(d.modified.length, 1);
  assert.equal(d.modified[0].old_cn, "第二条");
  assert.equal(d.modified[0].new_cn, "第三条");
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 1);
});

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE docs(id TEXT PRIMARY KEY, title TEXT, level TEXT, status TEXT, is_current INT, jurisdiction TEXT, province TEXT,
      issuer TEXT, doc_number TEXT, version_date TEXT, listed_date TEXT, history TEXT, source TEXT, source_url TEXT, n_articles INT, topics TEXT, note TEXT);
    CREATE TABLE articles(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, doc_id TEXT, title TEXT, article_no INT, article_cn TEXT, chapter TEXT,
      section TEXT, text TEXT, level TEXT, status TEXT, is_current INT, province TEXT, topics TEXT);
    CREATE VIRTUAL TABLE articles_fts USING fts5(title, text, content='articles', content_rowid='rowid', tokenize='trigram');`);
  db.prepare("INSERT INTO docs VALUES('d1','中华人民共和国示例法','法律','有效',1,'全国','全国','','','2019-04-23','2019-04-23','','国家法律法规数据库','',2,'','')").run();
  const ins = db.prepare("INSERT INTO articles(id,doc_id,title,article_no,article_cn,chapter,section,text,level,status,is_current,province,topics) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  ins.run("d1:第一条", "d1", "中华人民共和国示例法", 1, "第一条", "", "", "第一条　为了示例，制定本法。", "法律", "有效", 1, "全国", "");
  ins.run("d1:第二条", "d1", "中华人民共和国示例法", 2, "第二条", "", "", "第二条　本法自2019年11月1日起施行。", "法律", "有效", 1, "全国", "");
  db.exec("INSERT INTO articles_fts(articles_fts) VALUES('rebuild')");
  return db;
}

const rec = (over) => ({
  source: "npc", source_name: "中国人大网", url: "http://example/1", title: "中华人民共和国示例法", level: "法律", history: "",
  version_date: "2019-04-23", effective_date: "", doc_number: "", issuer: "",
  articles: [
    { article_cn: "第一条", article_no: 1, chapter: "", section: "", text: "第一条　为了示例，制定本法。" },
    { article_cn: "第二条", article_no: 2, chapter: "", section: "", text: "第二条　本法自2019年11月1日起施行。" },
  ],
  fulltext: "", ...over,
});

test("同一版本：标记为官方全文，检索索引同步", () => {
  const db = freshDb();
  const r = applyOfficialDoc(db, rec(), "2026-11-04");
  assert.equal(r.action, "confirmed");
  const d = db.prepare("SELECT official, source FROM docs WHERE id='d1'").get();
  assert.equal(d.official, 1);
  assert.match(d.source, /官方全文/);
  assert.equal(db.prepare("SELECT count(*) n FROM articles_fts WHERE articles_fts MATCH '\"为了示例\"'").get().n, 1);
});

test("尚未施行的新版本：现行版本不变并加注，到期后自动转正", () => {
  const db = freshDb();
  const r = applyOfficialDoc(db, rec({
    url: "http://example/2", version_date: "2026-06-26", effective_date: "2027-01-01",
    articles: [{ article_cn: "第一条", article_no: 1, chapter: "", section: "", text: "第一条　为了新的示例，制定本法。" }],
  }), "2026-11-04");
  assert.equal(r.action, "new_version");
  assert.equal(db.prepare("SELECT is_current FROM docs WHERE id='d1'").get().is_current, 1);
  assert.match(db.prepare("SELECT note FROM docs WHERE id='d1'").get().note, /2027-01-01/);
  assert.equal(db.prepare("SELECT status FROM docs WHERE id=?").get(r.doc_id).status, "尚未生效");

  const promoted = promotePending(db, "2027-01-01");
  assert.equal(promoted.length, 1);
  assert.equal(db.prepare("SELECT status, is_current FROM docs WHERE id='d1'").get().status, "旧版本");
  assert.equal(db.prepare("SELECT is_current FROM docs WHERE id=?").get(r.doc_id).is_current, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM articles WHERE doc_id='d1' AND is_current=1").get().n, 0);
});

test("比本地旧的版本不处理", () => {
  const db = freshDb();
  const r = applyOfficialDoc(db, rec({ url: "http://example/3", version_date: "2015-01-01", articles: [{ article_cn: "第一条", article_no: 1, chapter: "", section: "", text: "第一条　完全不同的旧条文内容。" }] }), "2026-11-04");
  assert.equal(r.action, "older");
  assert.equal(db.prepare("SELECT count(*) n FROM docs").get().n, 1);
});
