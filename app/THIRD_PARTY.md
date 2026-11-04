# Claude for Legal China：数据来源与第三方许可

本 app 以 Apache-2.0 许可发布，源码见 <https://github.com/DerekXuHQ/claude-for-legal-china>。仅供参考，不构成法律意见。本 app 不是 Anthropic 官方产品；"Claude" 是 Anthropic, PBC 的商标，这里只用来说明 app 可以接 Claude 模型。

## 法规与案例数据

| 内容 | 来源 | 说明 |
|---|---|---|
| 法律 | 中国人大网「法律文件」栏目 | 能取到官方全文的，用官方全文；标「官方全文」 |
| 行政法规 | 国家行政法规库（司法部，xzfg.moj.gov.cn） | 同上 |
| 司法解释、最高人民法院指导性案例 | 最高人民法院网站 | 同上 |
| 其余法律法规、地方性法规 | 国家法律法规数据库的文本，经 HuggingFace 数据集 senry5433/china-effective-laws-regulations（CC0-1.0，快照 2026-08-26）获取 | 尚未与官方网站逐条核对的，界面上会注明 |
| 商标法（2026 年修订） | 国家知识产权局公布的全文 | |
| 实务要点与处理流程 | 本项目各插件的 references 和 skills | 来源与许可见项目根目录 NOTICE |

法律、法规、司法解释等文件属于《著作权法》第五条规定的不适用著作权保护的对象。

app 访问官方网站时：只读取公开栏目，同一网站两次请求至少间隔 2 秒；网站返回反自动访问的验证页时立即停止，不尝试绕过。国家法律法规数据库（flk.npc.gov.cn）的 robots.txt 禁止自动采集，app 不访问该网站。人民法院案例库、中国裁判文书网的用户协议禁止汇编和镜像，app 不收录其内容。

## 软件

| 组件 | 许可 |
|---|---|
| Electron | MIT |
| @anthropic-ai/sdk | MIT |
| openai（Node SDK） | Apache-2.0 |
| SQLite（随 Electron / Node.js 提供） | Public Domain |

完整许可文本随各组件分发，位于安装包内的 node_modules 目录。
