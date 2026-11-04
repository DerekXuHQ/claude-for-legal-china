"""抓取最高人民法院指导性案例（court.gov.cn 公开栏目），写入 data/cases.jsonl。

只抓官方公开的指导性案例，每秒最多一个请求。已抓过的案例会跳过，可反复运行做增量更新。
人民法院案例库、中国裁判文书网的用户协议禁止汇编和镜像，本脚本不访问这两个站点。
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://www.court.gov.cn"
LIST = BASE + "/shenpan/gengduo/77{suffix}.html"
OUT = Path(__file__).resolve().parent.parent / "data" / "cases.jsonl"
HEADERS = {"User-Agent": "Mozilla/5.0 (claude-for-legal-china local index)", "Accept-Encoding": "identity"}
SECTIONS = ["关键词", "裁判要点", "相关法条", "基本案情", "裁判结果", "裁判理由"]
# 早期案例标题写作「指导案例X号」，执行类案例的要点、结果、理由用词不同
CASE_RE = re.compile(r"指导性?案例\s*(\d+)\s*号")
HEAD_RE = re.compile(r"^(关键词|[\u4e00-\u9fa5]{0,4}要点|相关法条|基本案情|裁判结果|执行结果|裁判理由|执行理由)\s*(.*)$")
ALIAS = {"执行结果": "裁判结果", "执行理由": "裁判理由"}


def get(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def page_text(raw: str) -> str:
    m = re.search(r'<div class="txt_txt"[^>]*>(.*?)</div>\s*</div>', raw, re.S) or re.search(r'<div class="detail"[^>]*>(.*?)<div class="(?:share|bottom)', raw, re.S)
    body = m.group(1) if m else raw
    body = re.sub(r"(?is)<(script|style).*?</\1>", "", body)
    body = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", body)
    body = html.unescape(re.sub(r"<[^>]+>", "", body))
    lines = [l.strip().replace("　", " ").strip() for l in body.split("\n")]
    return "\n".join(l for l in lines if l and not l.startswith("责任编辑"))


def split_sections(text: str) -> dict:
    parts, current = {}, None
    for line in text.split("\n"):
        head = HEAD_RE.match(line)
        if head and (head.group(1) in SECTIONS or head.group(1) in ALIAS or head.group(1).endswith("要点")):
            name = head.group(1)
            current = "裁判要点" if name.endswith("要点") else ALIAS.get(name, name)
            parts.setdefault(current, [])
            if head.group(2):
                parts[current].append(head.group(2))
        elif current:
            parts[current].append(line)
    return {k: "\n".join(v).strip() for k, v in parts.items()}


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    if OUT.exists():
        seen = {json.loads(l)["url"] for l in OUT.read_text(encoding="utf-8").splitlines() if l.strip()}
    links = []
    for page in range(1, 40):
        try:
            raw = get(LIST.format(suffix="" if page == 1 else f"_{page}"))
        except urllib.error.HTTPError as e:
            if e.code == 404:  # 翻过最后一页
                break
            raise
        found = re.findall(r'href="(/shenpan/xiangqing/\d+\.html)"[^>]*>([^<]{4,200})<', raw)
        if not found:
            break
        links.extend(found)
        time.sleep(1)
    links = [(u, t) for u, t in dict(links).items() if CASE_RE.search(t) and BASE + u not in seen]
    print(f"待抓取 {len(links)} 件", flush=True)
    with OUT.open("a", encoding="utf-8") as f:
        for i, (path, title) in enumerate(links, 1):
            url = BASE + path
            try:
                text = page_text(get(url))
            except Exception as e:  # 单件失败不影响其他案例
                print(f"失败 {url}: {e}", file=sys.stderr, flush=True)
                continue
            no = CASE_RE.search(title) or CASE_RE.search(text)
            heading = title.replace("...", "").strip()
            record = {
                "url": url,
                "number": int(no.group(1)) if no else None,
                "title": heading,
                "sections": split_sections(text),
                "text": text,
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            f.flush()
            if i % 20 == 0:
                print(f"已抓取 {i}/{len(links)}", flush=True)
            time.sleep(1)
    print("完成", flush=True)


if __name__ == "__main__":
    main()
