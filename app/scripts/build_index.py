"""把下载的法规数据、指导性案例和插件参考资料建成 data/legal.db（SQLite 全文索引）。

数据来源：
- data/raw/：HuggingFace 数据集 senry5433/china-effective-laws-regulations（CC0-1.0），
  内容取自国家法律法规数据库，非官方汇编，以公报和官方数据库为准。
- data/cases.jsonl：scripts/fetch_cases.py 抓取的最高人民法院指导性案例。
- 仓库各插件的 references/*.md 与 skills/*/SKILL.md：实务要点与处理流程。
- extras/：数据集快照之后公布的重要文本（例如 2026 年修订的商标法）。

重复运行会整库重建；收藏和设置存放在 data/user.db，不受影响。
"""
import glob
import json
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import pyarrow.parquet as pq

APP = Path(__file__).resolve().parent.parent
REPO = APP.parent
DATA = APP / "data"
DB = DATA / "legal.db"

CN_NUM = "零一二三四五六七八九十百千"
LEVEL = {"法律": "法律", "行政法规": "行政法规", "监察法规": "监察法规", "司法解释": "司法解释", "地方法规": "地方性法规"}
MUNICIPALITIES = {"北京市", "天津市", "上海市", "重庆市"}
SEZ_PROVINCE = {"深圳市": "广东省", "珠海市": "广东省", "汕头市": "广东省", "厦门市": "福建省"}
PROVINCES = [
    "北京市", "天津市", "河北省", "山西省", "内蒙古自治区", "辽宁省", "吉林省", "黑龙江省", "上海市", "江苏省",
    "浙江省", "安徽省", "福建省", "江西省", "山东省", "河南省", "湖北省", "湖南省", "广东省", "广西壮族自治区",
    "海南省", "重庆市", "四川省", "贵州省", "云南省", "西藏自治区", "陕西省", "甘肃省", "青海省",
    "宁夏回族自治区", "新疆维吾尔自治区",
]
# 领域按标题关键词粗分，一部法规可属于多个领域，仅用于筛选
TOPICS = {
    "民事": r"民法典|合同|物权|婚姻|继承|收养|侵权|担保|人格权|民事",
    "刑事": r"刑法|刑事|犯罪|监狱|社区矫正|禁毒|反有组织犯罪",
    "诉讼与仲裁": r"诉讼|仲裁|执行|证据|审判|调解|公证|律师|法律援助|人民陪审",
    "劳动与社保": r"劳动|就业|社会保险|工资|工伤|职工|养老|医疗保障|失业|人力资源",
    "公司与商事": r"公司|企业|证券|破产|合伙|商业银行|保险法|票据|信托|期货|基金|商会|国有资产",
    "知识产权": r"商标|专利|著作权|知识产权|植物新品种|集成电路|商业秘密|地理标志",
    "数据与网络": r"网络|数据|个人信息|电子商务|电子签名|信息化|人工智能|密码|电信",
    "市场监管与消费": r"消费者|广告|产品质量|价格|反不正当竞争|反垄断|食品|药品|计量|标准化|市场监督|招标|政府采购",
    "行政": r"行政|处罚|复议|许可|强制|公务员|监察|治安|信访|政府信息",
    "税收与财政": r"税|财政|预算|会计|审计|海关|外汇|关税",
    "房地产与建设": r"房|土地|物业|建筑|城乡规划|城市|住房|不动产|拆迁|征收",
    "环境与资源": r"环境|生态|污染|森林|草原|水法|水土|矿产|野生动物|自然保护|节能|能源|气候",
    "教育科技文化": r"教育|学校|科学技术|文化|文物|体育|出版|广播|电影",
    "医疗卫生": r"医|卫生|疫|传染病|中医药|精神卫生",
    "交通运输": r"交通|道路|铁路|民用航空|港口|海上|船舶|公路|运输",
    "外商投资与涉外": r"外商|外国|涉外|对外|出口|进出口|境外",
}


def topics_for(title: str) -> str:
    return ",".join(k for k, pat in TOPICS.items() if re.search(pat, title))


def province_for(d: dict) -> str:
    jur, lvl = d["jurisdiction"] or "", d["jurisdiction_level"]
    if lvl == "national" or jur == "全国":
        return "全国"
    if jur in PROVINCES:
        return jur
    if jur in SEZ_PROVINCE:
        return SEZ_PROVINCE[jur]
    head = (d.get("promulgation_history") or "") + (d.get("text") or "")[:600]
    m = re.search(r"(" + "|".join(PROVINCES) + r")第[" + CN_NUM + r"]+届人民代表大会常务委员会", head)
    if m:
        return m.group(1)
    m = re.search(r"(" + "|".join(PROVINCES) + r")", head)
    return m.group(1) if m else "其他"


def schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
        CREATE TABLE docs(id TEXT PRIMARY KEY, title TEXT, level TEXT, status TEXT, is_current INT,
            jurisdiction TEXT, province TEXT, issuer TEXT, doc_number TEXT, version_date TEXT,
            listed_date TEXT, history TEXT, source TEXT, source_url TEXT, n_articles INT, topics TEXT, note TEXT);
        CREATE TABLE articles(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, doc_id TEXT, title TEXT, article_no INT,
            article_cn TEXT, chapter TEXT, section TEXT, text TEXT, level TEXT, status TEXT, is_current INT,
            province TEXT, topics TEXT);
        CREATE INDEX idx_art_doc ON articles(doc_id, article_no);
        CREATE VIRTUAL TABLE articles_fts USING fts5(title, text, content='articles', content_rowid='rowid', tokenize='trigram');
        CREATE TABLE cases(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, number INT, title TEXT, keywords TEXT,
            points TEXT, laws TEXT, facts TEXT, result TEXT, reasoning TEXT, url TEXT, text TEXT);
        CREATE VIRTUAL TABLE cases_fts USING fts5(title, keywords, points, laws, text, content='cases', content_rowid='rowid', tokenize='trigram');
        CREATE TABLE refs(rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, kind TEXT, plugin TEXT, path TEXT, title TEXT, heading TEXT, text TEXT);
        CREATE VIRTUAL TABLE refs_fts USING fts5(title, heading, text, content='refs', content_rowid='rowid', tokenize='trigram');
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
        """
    )


def load_laws(db: sqlite3.Connection) -> None:
    cols = ["id", "title", "category", "status", "jurisdiction", "jurisdiction_level", "issuer", "document_number",
            "filename_date", "listed_date", "promulgation_history", "source", "source_url", "n_articles", "text"]
    docs = [r for f in sorted(glob.glob(str(DATA / "raw/documents/*.parquet"))) for r in pq.read_table(f, columns=cols).to_pylist()]
    if not docs:
        sys.exit("未找到 data/raw/documents/*.parquet，请先运行 scripts/download_data.py")
    # 同名同地区的多个版本：日期最新的一个为现行版本，其余标为旧版本
    groups = defaultdict(list)
    for d in docs:
        groups[(d["title"], d["jurisdiction"])].append(d)
    current = set()
    for items in groups.values():
        valid = [d for d in items if d["status"] == "有效"] or items
        best = max(valid, key=lambda d: (d["filename_date"] or "", d["listed_date"] or ""))
        current.add(best["id"])
    info = {}
    for d in docs:
        is_cur = 1 if d["id"] in current and d["status"] == "有效" else 0
        status = d["status"] if (d["id"] in current or d["status"] != "有效") else "旧版本"
        prov = province_for(d)
        topics = topics_for(d["title"])
        level = LEVEL.get(d["category"], d["category"])
        info[d["id"]] = (d["title"], level, status, is_cur, prov, topics)
        db.execute(
            "INSERT INTO docs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (d["id"], d["title"], level, status, is_cur, d["jurisdiction"], prov, d["issuer"], d["document_number"],
             d["filename_date"], d["listed_date"], d["promulgation_history"], d["source"], d["source_url"],
             d["n_articles"], topics, ""),
        )
        if not d["n_articles"]:
            # 没有条文结构的决定、批复等，整篇作为一条收录，便于检索
            db.execute(
                "INSERT INTO articles(id,doc_id,title,article_no,article_cn,chapter,section,text,level,status,is_current,province,topics) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (d["id"] + ":全文", d["id"], d["title"], 0, "全文", "", "", d["text"], level, status, is_cur, prov, topics),
            )
    acols = ["id", "doc_id", "article_no", "article_no_cn", "chapter", "section", "text"]
    n = 0
    for f in sorted(glob.glob(str(DATA / "raw/articles/*.parquet"))):
        pf = pq.ParquetFile(f)
        for batch in pf.iter_batches(columns=acols, batch_size=20000):
            rows = []
            for a in batch.to_pylist():
                t = info.get(a["doc_id"])
                if not t:
                    continue
                title, level, status, is_cur, prov, topics = t
                rows.append((a["id"], a["doc_id"], title, a["article_no"], a["article_no_cn"], a["chapter"] or "",
                             a["section"] or "", a["text"], level, status, is_cur, prov, topics))
            db.executemany(
                "INSERT OR IGNORE INTO articles(id,doc_id,title,article_no,article_cn,chapter,section,text,level,status,is_current,province,topics) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
            n += len(rows)
    print(f"法规 {len(docs)} 部，条文 {n} 条", flush=True)


def load_extras(db: sqlite3.Connection) -> None:
    """数据集快照之后公布、但很重要的文本。extras/*.json 描述元数据，正文取自仓库内的官方全文。"""
    for spec_path in sorted((APP / "extras").glob("*.json")):
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        text = (REPO / spec["text_file"]).read_text(encoding="utf-8")
        body = text.split(spec["start_marker"], 1)[1]
        doc_id = spec["id"]
        level, prov, topics = spec["level"], "全国", topics_for(spec["title"])
        db.execute(
            "INSERT OR REPLACE INTO docs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (doc_id, spec["title"], level, spec["status"], 0, "全国", prov, spec["issuer"], spec.get("doc_number", ""),
             spec["version_date"], spec["version_date"], spec.get("history", ""), spec["source"], spec["source_url"],
             0, topics, spec.get("note", "")),
        )
        chapter, count, last_id = "", 0, None
        for line in body.split("\n"):
            line = line.strip()
            ch = re.match(r"^#+\s*(第[" + CN_NUM + r"]+章.*)$", line)
            if ch:
                chapter = ch.group(1)
                continue
            m = re.match(r"^\*\*(第([" + CN_NUM + r"]+)条)\*\*\s*(.*)$", line)
            if m:
                count += 1
                last_id = f"{doc_id}:{m.group(1)}"
                db.execute(
                    "INSERT OR REPLACE INTO articles(id,doc_id,title,article_no,article_cn,chapter,section,text,level,status,is_current,province,topics) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"{doc_id}:{m.group(1)}", doc_id, spec["title"], count, m.group(1), chapter, "",
                     f"{m.group(1)}　{m.group(3)}", level, spec["status"], 0, prov, topics),
                )
            elif last_id and line and not line.startswith(("#", "---")):
                db.execute("UPDATE articles SET text = text || char(10) || ? WHERE id = ?", (line, last_id))
        db.execute("UPDATE docs SET n_articles=? WHERE id=?", (count, doc_id))
        if spec.get("replaces_title"):
            db.execute("UPDATE docs SET note=? WHERE title=? AND is_current=1", (spec["replaces_note"], spec["replaces_title"]))
        print(f"补充：{spec['title']}（{spec['status']}）{count} 条", flush=True)



def load_cases(db: sqlite3.Connection) -> None:
    path = DATA / "cases.jsonl"
    if not path.exists():
        print("未找到 data/cases.jsonl，跳过案例（可运行 scripts/fetch_cases.py）", flush=True)
        return
    seen = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        c = json.loads(line)
        # 去掉页面底部混入的「责任编辑」行
        strip = lambda v: "\n".join(l for l in (v or "").split("\n") if not l.startswith("责任编辑")).strip()
        s = {k: strip(v) for k, v in c.get("sections", {}).items()}
        c["text"] = strip(c["text"])
        cid = f"GC{c['number']}" if c.get("number") else c["url"].rsplit("/", 1)[-1].split(".")[0]
        db.execute(
            "INSERT OR REPLACE INTO cases(id,number,title,keywords,points,laws,facts,result,reasoning,url,text) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (cid, c.get("number"), c["title"], s.get("关键词", ""), s.get("裁判要点", ""), s.get("相关法条", ""),
             s.get("基本案情", ""), s.get("裁判结果", ""), s.get("裁判理由", ""), c["url"], c["text"]),
        )
        seen += 1
    print(f"指导性案例 {seen} 件", flush=True)


def load_refs(db: sqlite3.Connection) -> None:
    """插件参考资料按二级标题切块；技能（处理流程）整篇收录。"""
    n = 0
    for f in sorted(REPO.glob("*/references/*.md")) + sorted(REPO.glob("references/*.md")):
        plugin = f.parent.parent.name if f.parent.parent != REPO else "仓库共享"
        text = f.read_text(encoding="utf-8")
        title = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), f.stem)
        chunks = re.split(r"\n(?=## )", text)
        for i, chunk in enumerate(chunks):
            heading = chunk.splitlines()[0].lstrip("# ").strip() if chunk.startswith("## ") else "概述"
            db.execute(
                "INSERT INTO refs(id,kind,plugin,path,title,heading,text) VALUES(?,?,?,?,?,?,?)",
                (f"ref:{f.relative_to(REPO)}#{i}", "实务要点", plugin, str(f.relative_to(REPO)), title, heading, chunk.strip()),
            )
            n += 1
    for f in sorted(REPO.glob("*/skills/*/SKILL.md")):
        plugin, skill = f.parts[-4], f.parts[-2]
        if skill in ("cold-start-interview", "customize", "matter-workspace"):
            continue
        text = f.read_text(encoding="utf-8")
        m = re.search(r"^description:\s*(?:[>|]-?\s*\n)?((?:.*\n)*?)(?=^[a-z_-]+:|^---)", text, re.M)
        desc = re.sub(r"\s+", " ", m.group(1)).strip() if m else ""
        body = text.split("\n---\n", 1)[-1]
        db.execute(
            "INSERT INTO refs(id,kind,plugin,path,title,heading,text) VALUES(?,?,?,?,?,?,?)",
            (f"flow:{plugin}/{skill}", "处理流程", plugin, str(f.relative_to(REPO)), f"{plugin} / {skill}", desc[:200], body.strip()),
        )
        n += 1
    print(f"实务资料与处理流程 {n} 段", flush=True)


def main() -> None:
    DATA.mkdir(exist_ok=True)
    tmp = DB.with_suffix(".building")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    schema(db)
    load_laws(db)
    load_extras(db)
    load_cases(db)
    load_refs(db)
    db.execute("INSERT INTO articles_fts(articles_fts) VALUES('rebuild')")
    db.execute("INSERT INTO cases_fts(cases_fts) VALUES('rebuild')")
    db.execute("INSERT INTO refs_fts(refs_fts) VALUES('rebuild')")
    meta = {"dataset": "senry5433/china-effective-laws-regulations（CC0-1.0，快照 2026-08-26）",
            "built_at": __import__("datetime").date.today().isoformat(),
            "topics": json.dumps(list(TOPICS), ensure_ascii=False)}
    db.executemany("INSERT INTO meta VALUES(?,?)", meta.items())
    db.commit()
    db.execute("VACUUM")
    db.close()
    tmp.replace(DB)
    print(f"完成：{DB}（{DB.stat().st_size / 1e6:.0f} MB）", flush=True)


if __name__ == "__main__":
    main()
