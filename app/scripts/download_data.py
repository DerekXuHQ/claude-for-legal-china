"""下载法规数据集到 data/raw/。

数据集：HuggingFace senry5433/china-effective-laws-regulations（CC0-1.0）。
数据集作者称内容取自国家法律法规数据库的官方 Word 原文；它不是官方汇编，引用前以公报和官方数据库为准。
国家法律法规数据库的 robots.txt 禁止自动化采集，所以这里只下载现成的数据集快照，不直接抓取 flk.npc.gov.cn。
"""
import sys
import urllib.request
from pathlib import Path

REPO = "senry5433/china-effective-laws-regulations"
FILES = [f"data/{kind}/{cat}.parquet" for kind in ("documents", "articles") for cat in ("法律", "行政法规", "监察法规", "司法解释", "地方法规")]
RAW = Path(__file__).resolve().parent.parent / "data" / "raw"


def main() -> None:
    force = "--force" in sys.argv
    for rel in FILES:
        target = RAW / rel.removeprefix("data/")
        if target.exists() and not force:
            print(f"已存在，跳过：{target.name}（{target.parent.name}）")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/datasets/{REPO}/resolve/main/{rel}"
        print(f"下载 {rel} …", flush=True)
        tmp = target.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(target)
    print("数据已就绪")


if __name__ == "__main__":
    main()
