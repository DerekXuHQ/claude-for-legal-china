"""检索层：网页界面和 AI 代理共用。只读访问 data/legal.db。"""
import json
import re
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "legal.db"
LEVELS = ["法律", "司法解释", "行政法规", "监察法规", "地方性法规"]
# 排序时让效力层级高的规定靠前（bm25 越小越相关，减去加权）
LEVEL_BOOST = "CASE a.level WHEN '法律' THEN 8 WHEN '司法解释' THEN 6 WHEN '行政法规' THEN 5 WHEN '监察法规' THEN 4 ELSE 0 END"

_local = threading.local()


def db() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        _local.conn = conn
    return conn


def _terms(query: str) -> tuple[list[str], list[str]]:
    """拆分检索词：三个字及以上走全文索引，一两个字的用 LIKE 兜底（trigram 索引不支持短词）。"""
    words = [w for w in re.split(r"[\s，,。;；、]+", query.strip()) if w]
    long_terms = [w for w in words if len(w) >= 3]
    short_terms = [w for w in words if len(w) < 3]
    return long_terms, short_terms


def _fts_expr(terms: list[str]) -> str:
    return " AND ".join('"' + t.replace('"', '""') + '"' for t in terms)


def _snippet(text: str, query: str, width: int = 90) -> str:
    words = [w for w in re.split(r"\s+", query) if w]
    pos = min((text.find(w) for w in words if text.find(w) >= 0), default=0)
    start = max(0, pos - width // 3)
    s = text[start:start + width].replace("\n", " ")
    return ("…" if start else "") + s + ("…" if start + width < len(text) else "")


def search_articles(query: str, level: str = "", province: str = "", topic: str = "", current_only: bool = True,
                    limit: int = 20, offset: int = 0) -> dict:
    long_terms, short_terms = _terms(query)
    where, params = [], []
    if level:
        where.append("a.level = ?")
        params.append(level)
    if province == "全国":
        where.append("a.province = '全国'")
    elif province:
        where.append("a.province IN ('全国', ?)")
        params.append(province)
    if topic:
        where.append("(',' || a.topics || ',') LIKE ?")
        params.append(f"%,{topic},%")
    if current_only:
        where.append("(a.is_current = 1 OR a.status = '尚未生效')")
    for t in short_terms:
        where.append("(a.text LIKE ? OR a.title LIKE ?)")
        params += [f"%{t}%", f"%{t}%"]
    prov_boost = "0"
    if province and province != "全国":
        prov_boost = "(CASE WHEN a.province = ? THEN 3 ELSE 0 END)"
    cond = (" AND " + " AND ".join(where)) if where else ""
    if long_terms:
        sql = (f"SELECT a.*, bm25(articles_fts, 4, 1) - {LEVEL_BOOST} - {prov_boost} AS score FROM articles_fts f "
               f"JOIN articles a ON a.rowid = f.rowid WHERE articles_fts MATCH ?{cond} ORDER BY score LIMIT ? OFFSET ?")
        args = ([province] if prov_boost != "0" else []) + [_fts_expr(long_terms)] + params + [limit + 1, offset]
    elif short_terms:
        sql = (f"SELECT a.*, -({LEVEL_BOOST}) - {prov_boost} AS score FROM articles a WHERE 1=1{cond} "
               f"ORDER BY score, a.doc_id, a.article_no LIMIT ? OFFSET ?")
        args = ([province] if prov_boost != "0" else []) + params + [limit + 1, offset]
    else:
        return {"items": [], "more": False}
    rows = db().execute(sql, args).fetchall()
    if long_terms and len(long_terms) > 1 and offset == 0 and len(rows) < min(limit, 8):
        # 关键词同时命中的太少：补充只命中部分关键词的结果，排在后面
        seen = {r["id"] for r in rows}
        or_args = ([province] if prov_boost != "0" else []) + [" OR ".join('"' + t.replace('"', '""') + '"' for t in long_terms)] + params + [limit * 2, 0]
        extra = [r for r in db().execute(sql, or_args).fetchall() if r["id"] not in seen]
        rows = list(rows) + extra[: limit - len(rows)]
    items = [{
        "kind": "article", "id": r["id"], "doc_id": r["doc_id"], "title": r["title"], "article": r["article_cn"],
        "chapter": r["chapter"], "level": r["level"], "status": r["status"], "province": r["province"],
        "snippet": _snippet(r["text"], query),
    } for r in rows[:limit]]
    return {"items": items, "more": len(rows) > limit}


def search_laws(query: str, level: str = "", province: str = "", topic: str = "", current_only: bool = True,
                limit: int = 20, offset: int = 0) -> dict:
    """按法规名称检索。"""
    where, params = ["d.title LIKE ?"], [f"%{query.strip()}%"]
    if level:
        where.append("d.level = ?")
        params.append(level)
    if province == "全国":
        where.append("d.province = '全国'")
    elif province:
        where.append("d.province IN ('全国', ?)")
        params.append(province)
    if topic:
        where.append("(',' || d.topics || ',') LIKE ?")
        params.append(f"%,{topic},%")
    if current_only:
        where.append("(d.is_current = 1 OR d.status = '尚未生效')")
    sql = (f"SELECT d.* FROM docs d WHERE {' AND '.join(where)} ORDER BY "
           f"CASE d.level WHEN '法律' THEN 0 WHEN '司法解释' THEN 1 WHEN '行政法规' THEN 2 WHEN '监察法规' THEN 3 ELSE 4 END, "
           f"length(d.title), d.version_date DESC LIMIT ? OFFSET ?")
    rows = db().execute(sql, params + [limit + 1, offset]).fetchall()
    items = [{"kind": "law", "id": r["id"], "doc_id": r["id"], "title": r["title"], "level": r["level"],
              "status": r["status"], "province": r["province"], "jurisdiction": r["jurisdiction"],
              "version_date": r["version_date"], "n_articles": r["n_articles"], "snippet": r["history"][:120]}
             for r in rows[:limit]]
    return {"items": items, "more": len(rows) > limit}


def _loose(table: str, cols: list[str], query: str, exclude: set, limit: int, order: str = "") -> list:
    """宽松匹配：任一关键词命中即可，按命中关键词数排序。只用于数据量小的案例和实务资料表。"""
    words = [w for w in re.split(r"[\s，,。;；、]+", query.strip()) if w]
    if len(words) < 2:
        return []
    hay = " || ' ' || ".join(f"coalesce({c}, '')" for c in cols)
    score = " + ".join(f"(instr({hay}, ?) > 0)" for _ in words)
    sql = f"SELECT *, ({score}) AS hits FROM {table} WHERE ({score}) > 0 ORDER BY hits DESC{order} LIMIT ?"
    rows = db().execute(sql, words + words + [limit * 2]).fetchall()
    return [r for r in rows if r["id"] not in exclude][:limit]


def search_cases(query: str, limit: int = 20, offset: int = 0) -> dict:
    long_terms, short_terms = _terms(query)
    params, cond = [], ""
    for t in short_terms:
        cond += " AND (c.text LIKE ?)"
        params.append(f"%{t}%")
    if long_terms:
        sql = (f"SELECT c.*, bm25(cases_fts, 5, 4, 4, 2, 1) AS score FROM cases_fts f JOIN cases c ON c.rowid = f.rowid "
               f"WHERE cases_fts MATCH ?{cond} ORDER BY score LIMIT ? OFFSET ?")
        args = [_fts_expr(long_terms)] + params + [limit + 1, offset]
    else:
        sql = f"SELECT c.* FROM cases c WHERE 1=1{cond} ORDER BY c.number DESC LIMIT ? OFFSET ?"
        args = params + [limit + 1, offset]
    rows = db().execute(sql, args).fetchall()
    if offset == 0 and len(rows) < 5:
        rows = list(rows) + _loose("cases", ["title", "keywords", "points", "text"], query, {r["id"] for r in rows}, limit - len(rows), ", number DESC")
    items = [{"kind": "case", "id": r["id"], "title": r["title"], "keywords": r["keywords"],
              "snippet": _snippet(r["points"] or r["text"], query, 140)} for r in rows[:limit]]
    return {"items": items, "more": len(rows) > limit}


def search_refs(query: str, limit: int = 20, offset: int = 0) -> dict:
    long_terms, short_terms = _terms(query)
    params, cond = [], ""
    for t in short_terms:
        cond += " AND (r.text LIKE ? OR r.title LIKE ?)"
        params += [f"%{t}%", f"%{t}%"]
    if long_terms:
        sql = (f"SELECT r.*, bm25(refs_fts, 4, 4, 1) AS score FROM refs_fts f JOIN refs r ON r.rowid = f.rowid "
               f"WHERE refs_fts MATCH ?{cond} ORDER BY score LIMIT ? OFFSET ?")
        args = [_fts_expr(long_terms)] + params + [limit + 1, offset]
    else:
        sql = f"SELECT r.* FROM refs r WHERE 1=1{cond} LIMIT ? OFFSET ?"
        args = params + [limit + 1, offset]
    rows = db().execute(sql, args).fetchall()
    if offset == 0 and len(rows) < 5:
        rows = list(rows) + _loose("refs", ["title", "heading", "text"], query, {r["id"] for r in rows}, limit - len(rows))
    items = [{"kind": "ref", "id": r["id"], "title": r["title"], "heading": r["heading"], "ref_kind": r["kind"],
              "plugin": r["plugin"], "snippet": _snippet(r["text"], query, 140)} for r in rows[:limit]]
    return {"items": items, "more": len(rows) > limit}


def get_article(article_id: str) -> dict | None:
    r = db().execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
    if not r:
        return None
    d = db().execute("SELECT source, source_url, version_date, history, note FROM docs WHERE id = ?", (r["doc_id"],)).fetchone()
    return {"kind": "article", "id": r["id"], "doc_id": r["doc_id"], "title": r["title"], "article": r["article_cn"],
            "chapter": r["chapter"], "section": r["section"], "text": r["text"], "level": r["level"],
            "status": r["status"], "province": r["province"], "source": d["source"] if d else "",
            "source_url": d["source_url"] if d else "", "version_date": d["version_date"] if d else "",
            "note": d["note"] if d else ""}


def get_doc(doc_id: str) -> dict | None:
    d = db().execute("SELECT * FROM docs WHERE id = ?", (doc_id,)).fetchone()
    if not d:
        return None
    arts = db().execute("SELECT id, article_cn, chapter, section, text FROM articles WHERE doc_id = ? ORDER BY article_no",
                        (doc_id,)).fetchall()
    others = db().execute("SELECT id, status, version_date FROM docs WHERE title = ? AND jurisdiction = ? AND id != ? ORDER BY version_date DESC",
                          (d["title"], d["jurisdiction"], doc_id)).fetchall()
    return {**dict(d), "kind": "law", "articles": [dict(a) for a in arts], "other_versions": [dict(o) for o in others]}


def get_case(case_id: str) -> dict | None:
    r = db().execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    return {**dict(r), "kind": "case"} if r else None


def get_ref(ref_id: str) -> dict | None:
    r = db().execute("SELECT * FROM refs WHERE id = ?", (ref_id,)).fetchone()
    return {**dict(r), "kind_label": r["kind"], "kind": "ref"} if r else None


def outline(doc_id: str, chapter: str = "") -> dict | None:
    """法规目录：不带 chapter 时返回各章及条号范围；带 chapter 时返回该章每条的开头。"""
    d = db().execute("SELECT id, title, level, status, province, version_date, history, note FROM docs WHERE id = ?", (doc_id,)).fetchone()
    if not d:
        return None
    rows = db().execute("SELECT id, article_cn, chapter, text FROM articles WHERE doc_id = ? ORDER BY article_no", (doc_id,)).fetchall()
    if chapter:
        arts = [{"id": r["id"], "article": r["article_cn"], "start": r["text"][:80]} for r in rows if chapter in (r["chapter"] or "")]
        return {**dict(d), "chapter": chapter, "articles": arts[:120]}
    chapters, order = {}, []
    for r in rows:
        ch = r["chapter"] or "（无章节）"
        if ch not in chapters:
            chapters[ch] = [r["article_cn"], r["article_cn"]]
            order.append(ch)
        chapters[ch][1] = r["article_cn"]
    return {**dict(d), "n_articles": len(rows), "chapters": [{"chapter": c, "from": chapters[c][0], "to": chapters[c][1]} for c in order]}


def meta() -> dict:
    conn = db()
    provinces = [r[0] for r in conn.execute("SELECT province FROM docs WHERE province NOT IN ('全国','其他') GROUP BY province ORDER BY count(*) DESC")]
    counts = {r[0]: r[1] for r in conn.execute("SELECT level, count(*) FROM docs WHERE is_current = 1 GROUP BY level")}
    info = {r[0]: r[1] for r in conn.execute("SELECT key, value FROM meta")}
    info["topics"] = json.loads(info.get("topics", "[]"))
    return {
        "levels": LEVELS, "provinces": provinces, "counts": counts,
        "articles": conn.execute("SELECT count(*) FROM articles WHERE is_current = 1").fetchone()[0],
        "cases": conn.execute("SELECT count(*) FROM cases").fetchone()[0],
        "refs": conn.execute("SELECT count(*) FROM refs").fetchone()[0],
        **info,
    }
