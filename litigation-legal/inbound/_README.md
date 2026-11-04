# inbound/ — 收到的法律文件

这个文件夹处理一切从外部寄来、送来的法律文件：收到的律师函、送达公司的法院调查令和协查通知、监管机关的问询函、对方要求保全证据的函件、指向我方的停止侵权函。

它和 `demand-letters/`（我方发出）、`matters/`（在册案件）分开，因为收到的文件有自己的流程：阅读 → 分流 → 决定 → 回复（或升级为案件）。不是每份收到的文件都会变成在册案件。

## 目录结构

```
inbound/
├── _README.md
└── [slug]/
    ├── incoming.pdf              # 或 .eml / .docx，原件（或指向原件的链接）
    ├── triage.md                 # 分析：范围、是否有理、可选方案、建议
    └── response-v1.docx          # 回复草稿（如需回复；修改后依次为 v2、v3）
```

## 命名规则（slug）

`[类型]-[来文方简称]-[yyyy-mm]`，用拼音或英文。例如：

- `demand-rec-acme-2026-04`（收到的律师函）
- `subpoena-zhang-v-li-2026-04`（作为案外人收到的调查令）
- `regulator-samr-inquiry-2026-04`（市场监管部门问询）
- `preservation-vendor-2026-04`（收到的证据保全函）

## 处理流程

| 类型 | 命令 | 输出 |
|---|---|---|
| 收到律师函 | `/litigation-legal:demand-received [路径]` | triage.md，可附回复草稿 |
| 收到调查令或协查通知 | `/litigation-legal:subpoena-triage [路径]` | triage.md，附异议意见 |
| 监管问询 | *后续技能* | |

每次分流都会比对 `matters/_log.yaml`，查有没有相关案件（同一对方当事人、事项重叠）。有相关案件的，分流结果会标出来，并提议把它记为 `related_matters`。如果这份文件本身应该立为在册案件，分流会把预填好的字段交给 `/matter-intake`。

## 与在册案件的关系

- 收到的文件与已有案件相关 → 在 `_log.yaml` 的 `related_matters` 字段里关联；文件仍放在 `inbound/`。
- 收到的文件应当立案 → 新建案件；matter.md 里交叉链接回 `inbound/[slug]/`。
- 收到的文件已处理完毕、无需立案 → 留在 `inbound/` 作为记录。

## 与我方发函的关系

如果对收到的律师函的回复本身是一份我方主张（反向主张），分流会把预填好的字段交给 `/demand-intake`。我方发出的函件放在 `demand-letters/`，并交叉链接回本文件夹。
