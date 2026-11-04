# 续约提醒（Renewal Watcher）— 托管 Agent 模板

## 概述

扫描合同库中即将到来的续约和取消截止日，对照团队的合同手册，标出截止日临近、偏离合同手册或触发审批上报的合同，并写出一份提醒报告。它与 Claude Code 插件中的 [`renewal-watcher`](../../commercial-legal/agents/renewal-watcher.md) Agent 和 [`renewal-tracker`](../../commercial-legal/skills/renewal-tracker) 技能同源，本目录是对应 `POST /v1/agents` 的托管 Agent cookbook。

这是一份 **cookbook，不是成品**，拿来不能直接用。它不绑定特定合同管理系统：YAML 默认声明的是 Ironclad、Google Drive、iManage 和 Docusign 的 MCP。国内团队的合同多放在 e签宝、法大大、契约锁、飞书云文档或自建合同管理系统中，需要换成对应的 MCP，见下文"适配说明"。

## ⚠️ 部署前须知

- **从合同元数据取出的取消截止日和续约条款可能是错的。** 合同管理系统的元数据会与已签署文本脱节——补充协议签了却没有重新录入，生效日和签署日不同，自动续约机制标错了。在依据算出的截止日决定解除或续约之前，须由执业律师对照已签署的协议及全部补充协议核实。
- **上报路由按配置的矩阵走，不替律师作上报判断。** 被标为偏离合同手册的条款，放在具体情境下可能仍可接受；没被标出的条款，也可能需要关注。矩阵只是分派，不是审查。
- **没有提醒的一周不等于没事的一周。** 没被列出的合同，可能根本没录入系统、标签错了，或者通知期已过而元数据没有反映出来。"本期无到期续约"只说明 Agent 运行过了，不说明什么都不用做。
- **期限计算从严。** 截止日恰逢周末或法定节假日的，Agent 不会自动顺延，只会提示律师核实合同约定。

## 部署

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export IRONCLAD_MCP_URL=...           # 合同管理系统；换成国内系统时同步修改 YAML 中的 MCP 名称
export GDRIVE_MCP_URL=...             # 已签署协议放在云端盘时使用
# 可选——repo-reader 中默认未启用，已签署协议放在这里的，在清单中启用
export IMANAGE_MCP_URL=...
# 可选——编排器仅作声明，当前没有任何节点授予其工具集
export DOCUSIGN_MCP_URL=...
../../scripts/deploy-managed-agent.sh renewal-watcher
```

## Steering 事件

见 [`steering-examples.json`](./steering-examples.json)。每周一上午的例行扫描用第一个示例；另外两个分别用于针对某一合同相对方的临时扫描，以及签约后的偏离复核。

## 安全与交接

合同文本、对方消息和合同管理系统备注都是**不可信输入**。为此采用三层隔离：

| 层级 | 是否接触不可信文件 | 工具 | 连接器 |
|---|---|---|---|
| **`repo-reader`** | **是** | 仅 `Read`、`Grep` | Ironclad、Google Drive（默认启用）；iManage（声明但默认未启用）。部署时应使用只读凭据，YAML 未限定具体 MCP 工具 |
| `deadline-calculator` | 否 | `Read`、`Grep`、`Glob` | 无 |
| 编排器 | 否 | `Read`、`Grep`、`Glob`，以及调用子 Agent（`callable_agents`） | 声明了 Ironclad / Google Drive / iManage / Docusign 的 `mcp_servers`，但未授予 `mcp_toolset`，不直接调用 |
| **`alert-writer`**（唯一持有 Write） | 否 | `Read`、`Write`、`Edit` | 无 |

`repo-reader` 返回限长、经 schema 校验的 JSON。`deadline-calculator` 只对这份 JSON 和磁盘上的合同手册配置做计算——不用 MCP，不联网。`alert-writer` 生成 `./out/renewal-alerts-<YYYY-MM-DD>.md`，并发出用于推送的 `handoff_request`。

**中文字段：** `repo-reader` 和 `deadline-calculator` 的合同相对方白名单在 ASCII 基础上放开了中文汉字、全角括号和间隔号（·），合同类型和负责人字段放开了中文汉字，以便中文合同记录通过校验。`repo-reader` 的 `url` 域名白名单在 Ironclad 之外加入了 `google.com` 和 `cloudimanage.com`，与 YAML 中声明的 Google Drive 和 iManage 连接器一致。

**金额字段：** `annual_value_usd` 的字段名沿用上游模板，未改名以免破坏下游解析；实际按部署团队约定的记账币种填写（国内团队通常为人民币元），报告中注明币种。

**交接：** 编排器把 `alert-writer` 发出的 `handoff_request` 路由给负责推送的工作节点，频道取自部署团队合同手册配置的"行文风格"一节。本 Agent 自己从不发送飞书或 Slack 消息。

**相关 Agent：** 需要做签约后偏离复核时，`handoff_request` 也可以路由到 [`deal-debrief`](../../commercial-legal/agents/deal-debrief.md)；续约时发现的偏离积累成规律时，可以路由到 [`playbook-monitor`](../../commercial-legal/agents/playbook-monitor.md)。命名 Agent 之间从不直接相互调用——路由是编排器的事。

**不保证：** 本 Agent 只提建议；取消、重新谈判还是任其续约，由律师决定。

## 适配说明

在依赖它的输出之前，先做以下调整：

- **接入你的合同管理系统。** 把 `IRONCLAD_MCP_URL` 换成你的合同管理系统。用 e签宝、法大大、契约锁、飞书云文档或自建系统的，在 [`agent.yaml`](./agent.yaml) 和 [`subagents/repo-reader.yaml`](./subagents/repo-reader.yaml) 的 `mcp_servers`、`tools` 中换上对应 MCP，同步修改 `repo-reader` 的系统提示，并把 `url` 字段的域名白名单改为该系统域名，否则返回的 URL 无法通过校验。已签署协议放在共享盘的，依靠 `gdrive` 和 repo-reader 的检索。所用系统没有公开 MCP 的，自建连接器并更新 MCP 服务器配置。
- **设置推送频道。** alert-writer 发出的 `handoff_request` 会指明一个频道。编排器从你的合同手册配置 **行文风格 → 续约提醒发送至** 字段读取该频道（`~/.claude/plugins/config/claude-for-legal-zh/commercial-legal/CLAUDE.md`）。首次定时运行前先设置好，否则交接会无处投递。
- **调整提前查看的时间窗口。** deadline-calculator 默认分档为已逾期 / 30 / 60 / 90 / 180 天。续约周期较短（一年以内的 SaaS 订单）或较长（通知期 12 个月的多年期框架协议）的，同时调整 deadline-calculator 提示中的分档阈值和 `alert-writer.yaml` 中对应的报告部分。注意 schema 中的 `urgency` 取值是固定的，改分档要一并改 schema 和下游解析。
- **调整审批上报矩阵。** deadline-calculator 读取合同手册中的审批上报矩阵，决定是否设置 `escalation_needed: true` 以及转给谁。启用定时运行前，确认矩阵反映当前的审批权限（谁有权决定让自动续约到期失效，超过多少金额的重新谈判由谁审批）。`alert-writer` 加载了 [`escalation-flagger`](../../commercial-legal/skills/escalation-flagger) 技能用于排版。
- **确认工作成果页眉。** `agent.yaml` 中追加的无界面提示要求 Agent 在报告开头加上合同手册中的工作成果页眉。启用前请法务负责人确认措辞。中国法下没有"律师工作成果"保护，标注本身不创设保护，见 `commercial-legal/CLAUDE.md` 的输出规范。
- **运行频率。** 默认每周一次。合同量大的团队可以每天运行，小团队可以每月一次。频率在你自己的调度系统中配置——cookbook 不会自行定时。
