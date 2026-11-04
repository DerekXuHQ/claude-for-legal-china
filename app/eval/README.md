# 法律 AI 评测集

`cases.jsonl` 是 App 法律问答的评测题，用来比较不同模型、推理强度和流程配置（见 `docs/AI-DESIGN.md`「评测」一节）。题目从企业主、HR 和企业法务的角度写，场景都在中国大陆。

## 文件格式

UTF-8 编码，一行一个 JSON 对象，共 24 题。字段如下：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 题号，前缀表示类别，如 `emp-01` |
| `task` | string | 期望的分流结果，取值与 `server/ai/tasks/<id>.md` 的任务编号一致 |
| `region` | string | 用户所在地区（如 `上海市`、`广东省深圳市`），不涉及地区时为空字符串 |
| `question` | string | 用户原话，口语化，有时故意漏掉关键事实 |
| `attachment` | string | 附件全文（合同、方案），没有附件时为空字符串 |
| `must_ask` | string[] | 用户没给、专业人士会追问的事实。回答可以先追问，也可以基于明确写出的假设给初步判断，但要点到这些事实 |
| `must_identify` | string[] | 必须答对的法律要点和问题 |
| `must_cite` | string[] | 必须引用的依据，格式为「法规全称 第X条」 |
| `must_not` | string[] | 应当扣分的常见错误 |
| `notes` | string | 优秀答案的样子，2–4 句 |

## 题目分布

| task | 数量 | 题号 |
|---|---|---|
| employment 劳动用工 | 6 | emp-01 ～ emp-06 |
| contract_review 合同审查 | 4 | con-01 ～ con-04 |
| plan_review 方案合规审查 | 2 | plan-01、plan-02 |
| legality 合法性判断 | 3 | leg-01 ～ leg-03 |
| dispute_defense 被诉、被索赔应对 | 3 | def-01 ～ def-03 |
| claim_feasibility 起诉、追款可行性 | 3 | sue-01 ～ sue-03 |
| deadline 期限与时效 | 1 | ddl-01 |
| corporate 公司治理与股权 | 2 | corp-01、corp-02 |

合同审查题附有完整合同文本（1,500–4,000 字），方案审查题附有活动或预售方案。文本都是虚构的，主体名称不对应真实公司，里面故意埋了问题：单方责任上限、免除故意或重大过失责任、缺少验收条款、自动续期、定金超过 20%、定金与违约金并用、过高违约金、或裁或诉、违反专属管辖的管辖约定、限定最低转售价格、有奖销售超过五万元上限、内定中奖、预付卡“概不退款”等。审查要点写在每题的 `must_identify` 里。

## 依据的核对

`must_cite` 里的每一条都已在本地资料库 `data/base.db` 中核对过：法规按 `docs.title` 精确匹配且 `is_current=1`，条文按 `articles.article_cn` 匹配，且只有一条结果。重建数据包或修改题目后可以重新核对：

```bash
python3 - <<'EOF'
import json, sqlite3
con = sqlite3.connect('file:data/base.db?mode=ro', uri=True)
for line in open('eval/cases.jsonl', encoding='utf-8'):
    case = json.loads(line)
    for cite in case['must_cite']:
        title, art = cite.rsplit(' ', 1)
        doc = con.execute("select id from docs where title=? and is_current=1", (title,)).fetchall()
        ok = len(doc) == 1 and con.execute(
            "select count(*) from articles where doc_id=? and article_cn=?", (doc[0][0], art)).fetchone()[0] == 1
        if not ok:
            print(case['id'], cite)
EOF
```

（在 `app/` 目录下运行，没有输出即全部通过。）

几点说明：

- 资料库里没有部门规章，所以《工资支付暂行规定》《单用途商业预付卡管理办法》等没有列入 `must_cite`。回答引用这些规章不扣分，但应当标明未在资料库核实。
- 2025 年修订的《反不正当竞争法》条号有变化：有奖销售是第十一条，商业秘密是第十条。按旧法条号引用属于 `must_not` 中的错误。
- 地方规定只在题目涉及当地时列入，例如 plan-01 的《浙江省反不正当竞争条例》、plan-02 的《上海市单用途预付消费卡管理规定》（2026 年 1 月 1 日起施行）。
- 社平工资、最低工资、听证“较大数额”标准等会变动的数字没有写进评分要点。回答给出具体数额的，必须注明年份和出处。
- 期限题以 2026-11-04 为“今天”出题（ddl-01 的上诉期最后一天是 2026-11-05）。换日期跑评测时要相应调整题目或评分。

## 评分建议

由另一个模型（与被测模型不同家族）按评分要点给每题打分，建议维度：

1. **识别**：`must_identify` 的覆盖率，以及结论是否正确。
2. **依据**：`must_cite` 的命中率；另外检查回答中所有引用能否在资料库核实，编造或错引的倒扣分（包括 Stanford/Yale 研究里说的“错误挂靠”，即条文存在但不支持该论断）。
3. **追问**：是否就 `must_ask` 中的事实追问，或明确写出假设。
4. **错误**：每出现一条 `must_not` 扣分。
5. **可用性**：对照 `notes`，看是否结论先行、有下一步和期限、合同题有没有给出可替换的修改文本。

`must_identify` 和 `must_cite` 列的是一个合格答案应当覆盖的内容，并非穷尽；回答提出其他正确且相关的要点不扣分。
