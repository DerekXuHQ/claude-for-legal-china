# CLAUDE.md

在本仓库工作的说明。本仓库是面向中国大陆法律实务的 Claude Code 插件 marketplace：16 个领域插件、202 个技能、12 个 Agent，另有 5 个托管 Agent cookbook，以及 Codex、DeepSeek Harness（dsh）、WorkBuddy 三套适配层。这里的工作大多是编辑提示内容（技能、Agent、钩子）、插件元数据或 cookbook 配置，而不是应用代码。

## 目录结构

```
.claude-plugin/marketplace.json   # marketplace 清单，每个插件一条
<plugin>/                         # 16 个领域插件（commercial-legal、criminal-legal、legal-research-cn ……）
  .claude-plugin/plugin.json      # 插件清单（name、version、description、author）
  .mcp.json                       # 插件使用的 MCP 连接器（默认是元典 yuandian）
  CLAUDE.md                       # 实务画像模板（见下文「插件 CLAUDE.md 是模板」）
  README.md                       # 插件说明
  skills/<name>/SKILL.md          # 一个技能一个目录
  agents/<name>.md                # Agent 定义
  references/                     # 部分插件自带的参考资料
.agents/skills/                   # Codex 适配层（脚本生成）
.dsh/skills/                      # DeepSeek Harness 适配层（脚本生成）
.workbuddy/skills/                # WorkBuddy 适配层（脚本生成）
managed-agent-cookbooks/<name>/   # 托管 Agent：agent.yaml + subagents/ + steering-examples.json
connectors/catalog.json           # 连接器目录（元典、北大法宝等）
references/                       # 仓库级共享参考：公司画像模板、知识库检索协议、官方法条核验源等
scripts/                          # 适配层生成、发布检查、cookbook 部署脚本
NOTICE                            # 上游项目署名（Apache 2.0 要求）
```

## 改完之后要做的事

### 1. 重新生成适配层

新增、删除或改名技能后，三套适配层里的技能清单会过时。重新生成：

```bash
python3 scripts/generate_codex_adapters.py
python3 scripts/generate_dsh_adapters.py
python3 scripts/generate_workbuddy_adapters.py
```

不要手改 `.agents/`、`.dsh/`、`.workbuddy/` 下的文件，下次生成会被覆盖。

### 2. 校验

```bash
# 插件与 marketplace 结构校验
claude plugin validate .claude-plugin/marketplace.json
for d in */; do [ -f "$d/.claude-plugin/plugin.json" ] && claude plugin validate "$d"; done

# 仓库自带检查：技能 frontmatter、JSON/YAML、私人路径与密钥泄露
python3 scripts/check-release.py
python3 scripts/check-upgrade.py
python3 scripts/check-connectors.py

# cookbook 工具权限检查（需要 PyYAML）
python3 scripts/lint-tool-scope.py
```

`claude plugin validate` 对每个插件都会提示「插件根目录的 CLAUDE.md 不会作为项目上下文加载」，这是预期行为，见下文。

### Marketplace 规则

- `plugins[]` 里插件名不能重复；`name` 必须匹配 `^[a-z0-9][a-z0-9-]{1,63}$`。
- `description` 10–2000 字，首尾无空白，不含零宽字符等隐藏 Unicode。
- `source`（`"./<dir>"`）必须指向含 `.claude-plugin/plugin.json` 的目录，不能含 `..` 或 shell 元字符。
- `marketplace.json` 里每个插件的 `name`、`description`、`author` 要与插件自己的 `plugin.json` 一致。改一处就同步改另一处。

### Frontmatter

每个 `skills/<name>/SKILL.md` 都要有 `name` 和 `description`，`name` 与目录名一致。每个 `agents/*.md` 要有 `name` 和 `description`。多行描述用 `>` 块标量没有问题。

## 约定

### 中国大陆法为默认框架

技能以中国大陆法为基础。涉及港澳台或境外管辖时，要识别出来并单独处理，不能把大陆法框架静默套用到境外事实上。不要新增美国法、欧盟法的实体内容，确需比较时明确标注是比较法。

### 法条引用必须可核验

- 引用条号前，按 `references/official-law-sources.md` 到官方来源核对现行版本。
- 来源标签沿用各插件 CLAUDE.md 的体系：`[法条原文]`、`[yuandian检索]`、`[模型知识 — 需验证]` 等。未经核实的内容一律标「需验证」。
- 技能里不要写死会变动的数字（社平工资、入罪数额、量刑比例等）；必须给出时，注明出处和版本，并标注 〔待核〕。

### 刑事插件的脱敏红线

`criminal-legal` 要求输入一律为已脱敏副本。新增或修改刑事技能时，保留开头的脱敏前置检查，文书模板中的姓名、案号保持占位。任何技能里都不能出现真实当事人的姓名、身份证号、联系方式或案号。

### 正文里的技能名必须准确

技能（尤其是 `customize`、`cold-start-interview`）让用户「运行 `/foo`」时，`foo` 必须是真实存在的 `skills/<foo>/` 目录名。简写看着对，但用户输入后什么也不会发生。

### 插件 CLAUDE.md 是模板，不是项目上下文

每个 `<plugin>/CLAUDE.md` 是实务画像模板，`cold-start-interview` 会把它复制到用户机器上的 `~/.claude/plugins/config/claude-for-legal-zh/<plugin>/CLAUDE.md`。安装插件时它不会作为项目上下文加载，`claude plugin validate` 的提示是预期的。不要为了消除提示把内容挪进技能。

### 引入第三方内容

- 只引入许可证允许的内容（Apache 2.0、MIT 等），并在根目录 `NOTICE` 或插件内的 `THIRD_PARTY_NOTICES.md` 记录来源、提交号和改动。
- 没有许可证、禁止商用（NC）或禁止改编（ND）的内容不要引入；上游自己标注来源不明的部分也不要引入。
- 引入前检查：真实姓名和案号、作者本机路径、密钥、外部私有依赖、律所名称等品牌信息。
- 与已有技能重名或功能重叠时，改名并在 `description` 里写清分工。

### 格式

- JSON 和 `.mcp.json` 一律 2 空格缩进。
- 每个文本文件以换行结尾，行尾不留空白。
- Markdown 表格列数保持一致即可，不要求对齐。

## Cookbooks

每个 `managed-agent-cookbooks/<name>/` 包含 `agent.yaml`（编排器）、`subagents/*.yaml`（叶子节点）、`steering-examples.json` 和 `README.md`。`scripts/lint-tool-scope.py` 检查两条规则：

1. 编排器只拿本地工具（`read`、`grep`、`glob`、`agent_toolset`），MCP 和写入工具归具体的子 Agent。
2. README 的安全表和 `agent.yaml` 的注释必须与 YAML 实际授予的权限一致，不能写出子 Agent 没有的工具。

## 不要动的地方

- 各插件的 `.gitignore` 略有差异，可能是有意的，统一之前先问。
- 有些插件没有 `hooks/hooks.json`，钩子是可选的，不算缺陷。
- 仓库级 `references/` 只在根目录，不随插件分发。几个插件 CLAUDE.md 模板把它当作插件内文件引用，这是已知问题，不要悄悄挪动。
