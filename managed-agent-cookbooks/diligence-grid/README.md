# 尽调网格（Diligence Grid）— 托管 Agent 模板

## 概述

对虚拟数据室中的文件做批量审查。两种模式：

- **监测（watch）**：监测数据室在某个截止时间之后的新上传，逐份对应到部署团队的尽调需求清单类别，标出落在高优先级类别（重大合同、诉讼仲裁与执行、知识产权等）中的上传。
- **网格（grid）**：按列模式对一个文件夹中的文件做表格审查。一份文件一行，一个数据点一列，每个单元格都能追溯到原文的逐字引文。这是并购尽调的主力工具。

它与 [`corporate-legal`](../../corporate-legal) 插件同源，本目录是对应 `POST /v1/agents` 的托管 Agent cookbook。网格模式就是 `tabular-review` 技能，由一组 extractor 工作节点在无界面模式下并行执行。

## ⚠️ 部署前须知

- **每个单元格都是线索，不是结论。** 在律师读过底层文件之前，尽调网格不是陈述与保证、不是披露函附表，也不是尽调报告。每个单元格附上逐字引文，是为了让审查人核实得快——请用上它。
- **重要性筛选和列分类依据的是经验规则，不是法律判断。** 被模式判为不重要的合同，可能恰恰是让交易告吹的那份。extractor 读错条款时，标为 `answered` 的单元格照样是错的。审查人的工作量取决于 `unclear` + `needs_review` + `answered` 的总和，而不只是被标出的那些。
- **监测模式只看元数据和预览，不看全文。** 分类器标为"低优先级"的新上传，也可能是改变交易的那份补充协议。把监测报告当作待办队列，而不是过滤器。
- **对方上传的文件对整条工具链也是不可信输入。** grid-writer 的 CSV 公式注入防护是必须的，不是可选项，见下文"安全与交接"。
- **网格只看合同和文件本身。** 经营者集中申报、外商投资准入（负面清单）、国有资产转让程序、上市公司信息披露等交易层面事项，需要在尽调问题清单中单独处理，见 [`ma-diligence-columns.md`](../../corporate-legal/skills/tabular-review/references/ma-diligence-columns.md) 的"交易层面的事项"一节。

## 部署

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export BOX_MCP_URL=...
export GDRIVE_MCP_URL=...
export IMANAGE_MCP_URL=...            # 可选；默认未启用，启用需修改 doc-reader.yaml
export DEFINELY_MCP_URL=...           # 可选；编排器仅作声明，当前没有任何节点授予其工具集
../../scripts/deploy-managed-agent.sh diligence-grid
```

只为实际使用的数据室设置 MCP URL。

## Steering 事件

见 [`steering-examples.json`](./steering-examples.json)。

## 安全与交接

数据室文件——合同、决议和会议记录、补充协议、对方上传的材料——都是**不可信输入**。对方上传的合同里可能夹带意在操纵审查人或下游工具链的文字。为此采用四层隔离，让持有 Write 的节点和持有 MCP 的节点都不接触文件原文以外的权限：

| 层级 | 是否接触不可信文件 | 工具 | 连接器 |
|---|---|---|---|
| **`doc-reader`** | **是**（只读） | `Read`、`Grep` | Box、Google Drive（默认启用）；iManage（声明但默认未启用）。部署时应使用只读凭据，YAML 未限定具体 MCP 工具 |
| **`extractor`** | **是**（只读） | `Read`、`Grep` | 无 |
| `normalizer` | 否 | `Read`、`Grep` | 无 |
| 编排器 | 否 | `Read`、`Grep`、`Glob`，以及调用子 Agent（`callable_agents`） | 声明了 Box / Google Drive / iManage / Definely 的 `mcp_servers`，但未授予 `mcp_toolset`，不直接调用 |
| **`grid-writer`**（唯一持有 Write） | 否 | `Read`、`Write` | 无 |

`doc-reader` 和 `extractor` 返回限长、经 schema 校验的 JSON。编排器和 `normalizer` 只看到结构化数据。`grid-writer` 生成 `./out/diligence-grid-<date>.csv`、`./out/diligence-grid-<date>_sources.csv` 和 `./out/diligence-grid-<date>-summary.md`。

**中文字段：** `doc-reader` 的当事人名称白名单在 ASCII 基础上放开了中文汉字、全角括号和间隔号（·），以便中文公司名和人名通过校验；`path` 的域名白名单在原有 Box、Datasite、Intralinks、SharePoint、iManage 之外加入了 `google.com`，与默认启用的 Google Drive 连接器一致。

**CSV 公式注入。** `grid-writer` 写入的每个单元格——值、逐字引文、位置、文件名、列标题——都先检查首字符是否为 `=`、`+`、`-`、`@`、制表符或回车符，命中的在写入 CSV 前加一个单引号。对方上传的合同经常含有这样的字符串：交易团队一打开文件，Excel、WPS 或在线表格就会把它当公式执行（`=HYPERLINK(...)` 外泄数据，旧版 Excel 上 `=cmd|...` 触发 DDE）。来源 CSV 的风险更大——逐字引文正是攻击者能控制的部分。

**xlsx 由部署方处理。** 本 cookbook 只输出 CSV。部署团队按 [`corporate-legal/skills/tabular-review/references/excel-output.md`](../../corporate-legal/skills/tabular-review/references/excel-output.md) 中的工作簿结构转换为 `.xlsx`——隐藏的 `_source` 列、悬停显示引文的单元格批注、按状态填色、每列一个 `Verified` 下拉、`_schema` 和 `_summary` 两张表。转换在部署团队自己的表格环境中完成（Claude in Excel、openpyxl，或通过 API 写入在线表格，见 [`gsheets-output.md`](../../corporate-legal/skills/tabular-review/references/gsheets-output.md)）。从无界面 Agent 直接产出 xlsx，需要可信的运行环境和宏环境，本 cookbook 有意不作此假设。

**不保证：** 本 Agent 产出的每个单元格都是**需要核实的线索**，不是结论。审查人阅读原文、核对引文、在 `Verified` 列打标记。哪些内容写入陈述与保证、披露函附表或尽调报告，由律师决定。

## 适配说明

- **数据室连接。** 按你的数据室设置 `BOX_MCP_URL` / `GDRIVE_MCP_URL` / `IMANAGE_MCP_URL`。默认启用 Box 和 Google Drive；主力平台不同的，改 [`subagents/doc-reader.yaml`](./subagents/doc-reader.yaml) 中各 `mcp_toolset` 的 `default_config`。数据室在飞书云文档、坚果云、企业网盘或其他专用平台的，在 `agent.yaml` 和 `doc-reader.yaml` 的 `mcp_servers` 与 `doc-reader.yaml` 的 `tools` 中加入对应 MCP，并把 `doc-reader.yaml` 中 `path` 的域名白名单改为该平台域名（例如 `feishu.cn`、`jianguoyun.com`），否则返回的路径无法通过校验。
- **列模式。** 默认使用 [`ma-diligence-columns.md`](../../corporate-legal/skills/tabular-review/references/ma-diligence-columns.md) 中的并购尽调标准列。按交易类型调整——科技与知识产权、医药与医疗器械、不动产、政府采购与国有企业客户、金融类受监管主体——可直接使用该文件中的补充列。
- **输出去向。** 输出写到 `./out/`。通过部署流水线接到交易文件夹、飞书云文档空间或共享盘。不要给 `grid-writer` 配上传用的 MCP；交给你自己的上传步骤更干净，也能保持 Write 层的隔离。
- **默认模式。** 监测还是网格，由每个 steering 事件指定。如果你的流程几乎总是其中一种，相应地预置编排器中的 steering 事件模板。
- **需求清单类别。** 监测模式按部署团队 corporate-legal 配置（`~/.claude/plugins/config/claude-for-legal-zh/corporate-legal/CLAUDE.md`）中的需求清单类别分类。在真实交易中接入监测模式之前，先运行 `/corporate-legal:cold-start-interview`。
- **工作成果页眉。** `grid-writer` 会在开头加上部署团队 `## 输出规范` 配置中的页眉。部署前与法务团队确认——审查人角色不同（律师 / 非律师），页眉也不同。中国法下没有"律师工作成果"保护，标注本身不创设保护，见 `corporate-legal/CLAUDE.md` 的输出规范。
- **频道推送。** 本 Agent 从不直接推送。报告就是文件；`handoff_request` 告诉你的编排层该推送到哪个频道。交易频道在部署团队的 corporate-legal 配置中设置（交易团队简报一节）。
