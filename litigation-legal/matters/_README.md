# matters/ — 案件组合数据

这个文件夹存放案件组合，分两层：

- **`_log.yaml`**：台账。一个案件一行，供技能解析，是汇总统计的权威来源。
- **`[slug]/`**：单个案件的详细材料，包括案情叙述和历史记录，供人阅读和编辑。

## 目录结构

```
matters/
├── _log.yaml                  # 台账（全部案件，含已结案）
├── _README.md                 # 本文件
└── [matter-slug]/
    ├── matter.md              # 立案登记信息、诉讼思路、当前态势
    └── history.md             # 只追加的事件记录
```

## 命名规则（slug）

小写字母，用连字符连接，年份放最后。例如：

- `acme-v-us-2026`（某某公司诉我方）
- `samr-inquiry-2026`（市场监管部门调查）
- `labor-zhang-2026`（劳动争议）

带年份，以后再出现类似案件时 slug 也不会冲突。文件夹名与 slug 完全一致。slug 用拼音或英文，不用中文和真实姓名。

## 谁写哪个文件

| 文件 | 由谁写入 | 能否直接编辑？ |
|---|---|---|
| `_log.yaml` | `/matter-intake`、`/matter-update`、`/matter-close` | 可以，但要在该案件的 `history.md` 里记一笔 |
| `matter.md` | 立案登记时由 `/matter-intake` 写入；结案时 `/matter-close` 追加 | 可以，用于更新诉讼思路和态势 |
| `history.md` | `/matter-intake` 建立；`/matter-update` 和 `/matter-close` 追加 | 实际上只追加，已有条目视为记录 |

## 已结案件

留在这里，不要删除。`/portfolio-status` 默认不把它们计入在办汇总，`/portfolio-status --all` 会包括。已结案件是判断整个案件组合的经验来源。

## 更正

历史条目写错了，不要改原条目。追加一条新记录，注明更正的是哪一条。更正的记录本身和更正内容一样重要。
