# Reg Monitor — 托管 Agent 模板

## 概述

按计划检查法规动态源，按部署团队的重要度阈值过滤，对「始终重要」的事项对照制度库做一次快速差距检查，最后生成简报。它与 Claude Code 中的 [`reg-change-monitor`](../../regulatory-legal/agents/reg-change-monitor.md) Agent 以及 [`reg-feed-watcher`](../../regulatory-legal/skills/reg-feed-watcher) / [`policy-diff`](../../regulatory-legal/skills/policy-diff) 技能同源，本目录是面向 `POST /v1/agents` 的托管 Agent cookbook。

## ⚠️ 部署前必读

- **简报条目是筛过的线索，不是法律结论。** 重要度过滤用的是可配置的阈值，不是法律判断。被归为「了解情况」的变化可能对你的业务很重要；被标为「重要」的变化也可能并不适用。每份简报都要看，是否需要行动、披露、改制度或上报，由执业律师决定。
- **制度差距检查是初筛，不是适用性的法律评估。** 差距检查用启发式方法比对新规文本和你的制度库。「差距」是交给律师评估的线索；「已对齐」不代表合规。
- **重要度阈值是你们自己的校准，不是法律。** 实务画像里的「重要性阈值」部分如果过时，或是按另一种风险偏好调的，筛查结果也就过时了。开启定时运行前重新核对。
- **监测清单是你们自己划定的覆盖范围。** 不在清单上的机关照样可能发布重要文件。漏掉机关是配置问题，不是动态源的问题。
- **中国官方网站基本没有 RSS 或开放接口。** `feed-reader` 靠抓取栏目页工作，网站改版、反爬校验都会让抓取失败。抓取失败要当作「没查到」，不能当作「没有新规」。

## 部署

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GDRIVE_MCP_URL=...
../../scripts/deploy-managed-agent.sh reg-monitor
```

## Steering 事件

见 [`steering-examples.json`](./steering-examples.json)。默认的每周扫描用第一个示例，另外两个分别用于针对某项动态的深度检查和对已标记事项的差距分析。

## 安全与交接

法规动态内容（中国政府网、全国人大网、各部委网站的栏目和公告，付费数据库的更新提醒）是**不可信输入**。采用三层隔离：

| 层级 | 接触不可信内容？ | 工具 | 连接器 |
|---|---|---|---|
| **`feed-reader`** | **是** | 仅 `Read`、`Grep`、`WebFetch` | 无 |
| `materiality-filter` / 编排器 | 否 | `Read`、`Grep`、`Glob`、`Agent` | gdrive（仅编排器） |
| **`digest-writer`**（唯一持有 Write） | 否 | `Read`、`Write`、`Edit` | 无 |

`feed-reader` 返回限长、经 schema 校验的 JSON，`WebFetch` 的出站域名在工具层用 `allowed_hosts` 白名单限制。`materiality-filter` 只对这份 JSON 和磁盘上的 regulatory-legal 配置做计算，不连 MCP，不上网。`digest-writer` 生成 `./out/reg-digest-<YYYY-MM-DD>.md`，并发出 `handoff_request` 请求推送到 Slack。

**交接：** 编排器把 `digest-writer` 的 `handoff_request` 转给 Slack 发送 worker，频道取自部署团队配置。Agent 自己从不发 Slack 消息。

**不保证的事：** 这个 Agent 只负责发现变化、标出可能的制度差距；某项监管变化是否需要应对、由谁负责，由律师决定。

## 改造要点

在你们的流程里信任它的输出之前：

- **把 `feed-reader` 指向你们的来源。** 默认白名单是中国政府网、国家法律法规数据库、全国人大网、司法部、国家网信办、市场监管总局、证监会、中国人民银行、国家金融监督管理总局、人社部、工信部、最高人民法院和全国网络安全标准化技术委员会。可选来源和 2026-11-03 的可访问性检查结果见 [`source-catalog.md`](../../regulatory-legal/skills/reg-feed-watcher/references/source-catalog.md)。要加别的部委或付费数据库，在 `feed-reader` 的 `allowed_hosts` 里逐个加域名，同时调整编排器的扫描计划。不要用 `*.gov.cn` 这类通配。
- **已知的抓取问题。** 2026-11-03 检查时：全国人大网 https 版超时、只有 http 可用，而 `feed-reader` 的 `url` 字段要求 `https://`，只有 http 链接的条目会被跳过；司法部网站返回 302 自跳转，疑似需要 Cookie 校验，WebFetch 可能抓不到。这两个来源要么部署前实测，要么改为人工录入或用元典等连接器补位。
- **机关代码。** 输出 schema 的 `source`、`agency`、`docket_id` 只接受 ASCII 字符，`feed-reader` 用机关代码（CAC、SAMR、NPC 等）填写，`digest-writer` 排版时还原为中文全称。新增机关时，两处的代码表要同步更新。
- **配置简报推送频道。** `digest-writer` 发出的 `handoff_request` 要写明 Slack 频道，频道取自 regulatory-legal 实务画像中配置的简报推送频道。首次定时运行前要配好，否则交接会落空。想改用邮件、飞书或 Confluence 接收简报的，在编排器白名单里换掉交接目标。
- **调整重要度阈值。** `materiality-filter` 读取实务画像的「重要性阈值」部分（始终重要 / 值得审查 / 了解即可）。开启定时运行前确认这几档反映你们当前的风险偏好：阈值太低，简报会被淹没；太高，就会漏掉有期限的义务。
- **更新监测清单。** `materiality-filter` 也读取「我们关注的监管机构」表，业务范围变化时增删机关。
- **确认工作成果标头。** `agent.yaml` 的无人值守追加指令要求在简报开头加上配置中的工作成果标头。开启前请与总法律顾问确认标头措辞。
- **运行频率。** 默认每周一次。重要法律草案、部门规章集中征求意见期间可以改为每日。频率由你们自己的调度系统控制，cookbook 不会自己定时运行。
