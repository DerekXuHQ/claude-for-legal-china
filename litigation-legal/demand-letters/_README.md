# demand-letters/ — 诉前律师函

这个文件夹存放我方发出的每一份律师函的工作成果：催款函、违约通知及催告履行函、停止侵权函、劳动关系解除相关函件、证据保全函。

它和 `matters/` 分开，原因有三：

- 不是每封律师函都要升级为在册案件。小额催款和日常清欠不需要在台账里占一行。
- 每封律师函的流程都一样（登记 → 起草 → 发送 → 检查清单），不管它以后会不会变成案件。
- 律师函后来变成案件的，案件的 `matter.md` 会交叉链接回这里，起草过程跟着函件走。

## 目录结构

```
demand-letters/
├── _README.md                     # 本文件
└── [slug]/
    ├── intake.md                  # 背景收集、策略、谈判筹码、保密过滤
    ├── draft-v1.docx              # 函件正文（修改后依次为 v2、v3）
    └── checklist.md               # 发送后检查清单：送达方式、抄送、已登记的期限、后续跟进
```

## 命名规则（slug）

`[类型]-[对方当事人]-[yyyy-mm]`，用拼音或英文。例如：

- `payment-acme-2026-04`（催款）
- `ceasedesist-competitor-x-2026-04`（停止侵权）
- `breach-supplier-2026-04`（违约通知）
- `separation-zhang-2026-04`（劳动关系解除）
- `preservation-vendor-2026-04`（证据保全）

## 处理流程

1. `/litigation-legal:demand-intake [标题]` → 按情况追问，写入 `intake.md`
2. `/litigation-legal:demand-draft [slug]` → 过一遍保密、自认风险、和解谈判姿态和弃权检查清单，起草 `.docx`，写入 `checklist.md`，并提议创建案件

中国法下，发给对方的律师函不享有类似美国 FRE 408 的「和解谈判特权」，函件内容可能被对方当作证据使用（见 `demand-draft` 技能说明）。`[模型知识 — 需验证]`

## 与在册案件的关系

律师函起草完成后，`demand-draft` 会评估是否重大（判断标准来自 `~/.claude/plugins/config/claude-for-legal-zh/litigation-legal/CLAUDE.md`），并提议创建案件。确认后，`matters/_log.yaml` 会新增一行，`source: demand-letter`，`matters/[matter-slug]/matter.md` 会链接回这封律师函的文件夹。

不重大的律师函只留在这里。它们仍然是工作成果记录，只是不进案件组合台账。

## 更正与版本

已发出的草稿不要覆盖。函件发出后需要修改的（如补充主张），新建 `draft-v2.docx`。各版本的变化本身就是有用的记录。
