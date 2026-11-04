# 上线雷达（Launch Radar）— 托管 Agent 模板

## 概述

定期扫描产品团队的上线追踪器（Jira、Linear 或 Asana），找出未来几周内可能需要法务审查的上线。逐条对照产品法务的风险校准分流，每周出一份雷达备忘录：哪些要上线、哪些需要法务关注、因为什么被标出。它与 Claude Code 插件中的 [`launch-watcher`](../../product-legal/agents/launch-watcher.md) Agent 同源，本目录是对应 `POST /v1/agents` 的托管 Agent cookbook。

这是一份 **cookbook，不是成品**，拿来不能直接用。你需要把 MCP 连接器指向自己的追踪器，载入风险校准，设定运行节奏，并配置备忘录的去向。具体见下文"适配说明"。

## ⚠️ 部署前须知

- **雷达分流是分派决定，不是法律审查。**"需要审查"表示应由产品法务看一看；"供知悉"不代表这次上线没问题；"跳过"也不代表已过法务。要看完整份雷达，不要只看被标出的条目——真正该看却漏掉的，往往就在没被标出的那些里。
- **风险分类依据插件配置中的风险校准。** 校准过时，分流结果也就过时。新产品线、新监管机构、新地区、新的第三方依赖，都要先写进校准，雷达才能据此分流。
- **触发词清单带有预设立场。** 如果你的产品与默认设置不符（例如大量使用人脸识别等生物识别信息、属于关键信息基础设施或等保三级以上系统、以不在关键词覆盖范围内的方式处理未成年人信息），首次运行前先调整，否则备忘录恰恰会漏掉它本该抓住的情形。
- **追踪器需求单是不可信输入。** 产品经理可以在标题或描述里写任何东西，攻击者也可以提单。分流只依据内容分派，不为需求单的真实性背书。

## 部署

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export LINEAR_MCP_URL=... ATLASSIAN_MCP_URL=... ASANA_MCP_URL=... GDRIVE_MCP_URL=...
../../scripts/deploy-managed-agent.sh launch-radar
```

只为实际使用的追踪器设置 MCP URL。未配置的 MCP，编排器和 `tracker-reader` 会自动跳过。

## Steering 事件

见 [`steering-examples.json`](./steering-examples.json)。常见用法是每周扫描一次、看未来 4–6 周，另外在产品经理拿着"这有没有问题？"来找产品法务时，按需对单张需求单做分流。

## 安全与交接

追踪器需求单是不可信输入。产品经理可以在标题、描述或评论里写任意文字，攻击者也可以提单。为此采用三层隔离：

| 层级 | 是否接触不可信的追踪器内容 | 工具 | 连接器 |
|---|---|---|---|
| **`tracker-reader`** | **是** | 仅 `Read`、`Grep` | Linear、Jira（atlassian）、Asana（部署时应使用只读凭据；YAML 未限定具体 MCP 工具） |
| `risk-classifier` | 否 | 仅 `Read`、`Grep` | 无 |
| 编排器 | 否 | `Read`、`Grep`、`Glob`，以及调用子 Agent（`callable_agents`） | 声明了 Linear / Jira / Asana / Drive 的 `mcp_servers`，但未授予 `mcp_toolset`，不直接调用 |
| **`memo-writer`**（唯一持有 Write） | 否 | `Read`、`Write`、`Edit` | 无 |

`tracker-reader` 返回限长、经 schema 校验的 JSON 上线清单。`risk-classifier` 没有 MCP、不联网，只依据校验后的清单和用户的校准文件工作。`memo-writer` 是唯一持有 Write 的工作节点，生成 `./out/launch-radar-<date>.md`。编排器不持有 Write，也从不自己解析需求单原文。

**中文字段：** `tracker-reader` 和 `risk-classifier` 的 schema 字符白名单在 ASCII 基础上放开了中文汉字，标题和理由字段另放开了中文标点，以便中文需求单能通过校验；ASCII 的 `<`、`>`、`|`、反引号和换行仍被排除。`memo-writer` 渲染时还会再做一遍转义。

**交接：** 某次上线需要出具完整的法律审查备忘录、而不只是一条雷达记录时，编排器发出指向 `launch-review` 技能的 `handoff_request`（在新会话中运行），而不是在本会话里直接起草。由 `scripts/orchestrate.py` 负责路由。

## 适配说明

要让它真正派上用场，以下几处需要改：

- **追踪器指向。** 把 [`agent.yaml`](./agent.yaml) 和 [`subagents/tracker-reader.yaml`](./subagents/tracker-reader.yaml) 中的 `mcp_servers` 改为你的追踪器 MCP URL。只用 Jira/Linear/Asana 其中之一的，删掉另外两个。用的是飞书项目、飞书多维表格、Teambition 等其他追踪器的，换上对应的 MCP，同步修改 `tracker-reader` 的系统提示，并把 `tracker-reader.yaml` 中 `url` 字段的域名白名单改成你的追踪器域名（例如 `feishu.cn`），否则返回的 URL 无法通过校验。
- **风险校准。** `risk-classifier` 从 `../../product-legal/CLAUDE.md` 读取用户的校准（由 `/product-legal:cold-start-interview` 填写）。还没跑过冷启动访谈的，先跑一遍，或者在首次扫描前手工编写一份带有"通常阻断上线 / 通常需付出工作量但可上线 / 通常仅 FYI 告知"三张表的 CLAUDE.md。没有校准时，分类器只能退回到关键词触发，噪音很大。
- **扫描节奏和时间窗口。** 默认每周一次、看未来 6 周。上线节奏快的可以每天扫，慢的可以两周一次；提前期短的，窗口要放长。节奏在你的调度器（cron、Temporal、Airflow、EventBridge 等）里配置，不在 Agent 内部配置；时间窗口通过 steering 事件传入。
- **推送渠道。** 备忘录默认写到 `./out/`。要改为（或同时）推送到飞书/Slack，可以 (a) 在 cookbook 里加上对应的消息 MCP，并让 `memo-writer` 写完后推送；或 (b) 由你的编排层读取 `./out/launch-radar-<date>.md` 再转发。把推送放在 Agent 外面更便于测试，按你的运维方式选择。
- **触发词。** `launch-watcher` 系统提示中的触发词清单带有预设立场（未成年人和儿童个人信息、医疗健康信息、人脸识别、AI 模型厂商名等）。删掉与你产品无关的类别，补上本领域的术语（例如等保、关键信息基础设施、商用密码、支付、金融数据、营销短信和外呼、游戏版号、互联网诊疗），并对照你的校准表重新调整严重程度阈值。改完重新部署。
- **工作成果页眉。** `memo-writer` 会在开头加上插件配置中的工作成果页眉。部署前与法务负责人确认具体标注。中国法下没有"律师工作成果"保护，标注本身不创设保护，见 `product-legal/CLAUDE.md` 的输出规范。

## 能得到什么，得不到什么

- **能得到：** 一份可用的清单文件（manifest）、按安全分层的处理流程、每条上线都能追溯到追踪器 URL 的备忘录，以及转入完整上线审查技能的交接路径。
- **得不到：** 一个可以直接投产的 Agent。你需要把它指向自己的追踪器、载入校准、设定节奏、做一轮评估，并请产品法务对照自己对同一批需求单的判断，审一审最初几期输出，之后才能信任它。
- **尤其得不到：** 产品法务的替代品。这个 Agent 只做分流，审查、标注和决定由律师来做。备忘录中每一条"需要审查"都是线索，不是结论。
