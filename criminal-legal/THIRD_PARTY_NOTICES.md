# 第三方来源声明

## gcheng001/legal-skills

以下 9 个技能改编自 [gcheng001/legal-skills](https://github.com/gcheng001/legal-skills)（提交 `e3d1a82`，2026-10-10）：

| 本插件技能 | 原技能 |
|---|---|
| `investigation-stage-docs` | `criminal-investigation` |
| `client-meeting-prep` | `criminal-meeting` |
| `non-prosecution-opinion` | `criminal-non-prosecution` |
| `plea-negotiation` | `criminal-plea-bargain` |
| `trial-examination-outline` | `criminal-trial-examination` |
| `client-communication` | `criminal-client-comm` |
| `defense-statement` | `criminal-defense-statement` |
| `defense-plan` | `criminal-defense-strategy` |
| `case-file-notes` | `criminal-case-review`（含 `references/` 下 5 份模板） |

改编内容：

- 改名以避免与本插件已有技能冲突，并在描述中写明与 `bail-application`、`case-analysis`、`defense-strategy`、`compliance-non-prosecution` 的分工。
- 每个技能开头加入脱敏前置检查，与本插件 `CLAUDE.md` 的脱敏红线一致。
- 删除对原仓库总控技能 `criminal-case-os` 及其私有资料库（罪名要件库、跨专业知识库、交接协议等）的依赖，删除原作者本机的外部标准挂接。
- 未收录原作者注明"反哺自 defense-workflow"的 7 份参考文件，因其上游来源没有明确许可。
- 删除一处含真实当事人姓名的版本记录；文件命名示例改用案件代号。
- 量刑调节比例改为标注出处的经验参考区间，并要求核对原文后使用。

原许可证全文如下：

```
MIT License

Copyright (c) 2026 高澄

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
