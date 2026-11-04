# 办案指引核实记录（2026-11-04）

把插件原文改写成通用可读版时，发现原文有约 90 处疑似错误或前后矛盾。随后逐条对照本 app 资料库里的现行条文核实：确有错误的，**同时改正了** `app/guides/` 里的指引和插件里的原始文件。

| 领域 | 已改正 | 原文无误 | 无法核实（保留〔待核〕） |
|---|---|---|---|
| 刑事 | 12 | 0 | 3 |
| 民事诉讼与执行 | 15 | 1 | 0 |
| 劳动用工 | 9 | 0 | 1 |
| 公司、知识产权、采购 | 18 | 0 | 1 |
| 个人信息、AI 治理、合同 | 15 | 0 | 5 |

**仍待核实的**：资料库里没有对应规范性文件，没有凭记忆改，原处标「〔待核〕」：
- 最高法、最高检《关于常见犯罪的量刑指导意见》相关的三处（文件名称写法、「累罚」、自首等量刑比例）；
- 《企业职工患病或非因工负伤医疗期规定》的年份；
- 专利号中类型代码的识别规则；
- 《生成式人工智能服务管理暂行办法》《互联网信息服务算法推荐管理规定》的条号冲突，以及 CMP 执法案例的说法。

另：数据安全法、个人信息保护法、网络安全法在资料库里还没有和官方网站逐条核对（中国人大网列表页后段拒绝自动访问），相关改正以资料库现行文本为准。

另：《反不正当竞争法》2025 年修订后条号整体后移，已把所有指引和插件文件里的引用统一改为现行条号（35 处，见文末）。

以下是逐条记录。

## 刑事

插件文件在 criminal-legal/skills/<技能>/SKILL.md；指引文件在 app/guides/criminal-legal/<技能>.md。

| 指引路径 | 问题 | 结论 | 依据 | 改动文件 |
|---|---|---|---|---|
| criminal-legal/investigation-stage-docs | 「拘留：公安一般37天」 | 已改正：改为拘留后3日内提请批捕，特殊情况延长1至4日，流窜、多次、结伙作案的重大嫌疑分子可延长至30日，加上检察院审查7日，最长37日 | 刑事诉讼法第91条 | 指引 + 插件 SKILL.md |
| criminal-legal/investigation-stage-docs | 「审查逮捕一般为7日，重大案件可延长至37日」 | 已改正：改为对已被拘留的，检察院在接到提请批准逮捕书后7日以内作出决定；从拘留到批捕决定合计最长37日 | 刑事诉讼法第91条第三款；人民检察院刑事诉讼规则第282条 | 指引 + 插件 SKILL.md |
| criminal-legal/investigation-stage-docs | 权利告知书引刑诉法第33条 | 已改正：改为第34条第二款（侦查机关应告知有权委托辩护人）；第33条讲的是辩护人的范围 | 刑事诉讼法第33条、第34条 | 指引 + 插件 SKILL.md |
| criminal-legal/investigation-stage-docs | 「第90条：有权申请变更强制措施」，取保申请依据「第90条（申请程序）」 | 已改正：两处都改为第97条，权利主体按条文补全为「犯罪嫌疑人、被告人及其法定代理人、近亲属或者辩护人」。第90条讲的是检察院作出批准或不批准逮捕的决定。不批准逮捕意见书里「第87条、第90条」的引用原样保留，没有改 | 刑事诉讼法第90条、第97条 | 指引 + 插件 SKILL.md |
| criminal-legal/investigation-stage-docs | 「第95条：辩护人有权申请羁押必要性审查」 | 已改正：第95条按原文改为检察院在逮捕后依职权审查；申请权另引人民检察院刑事诉讼规则第574条。说明部分和申请书正文两处依据也补上了规则第574条 | 刑事诉讼法第95条；人民检察院刑事诉讼规则第574条 | 指引 + 插件 SKILL.md（指引末尾的条文清单也补了第34、91、97条） |
| criminal-legal/investigation-stage-docs | 「五大核心原则」只列了四项 | 已改正：改为「从证据、程序、定性、量刑四个方面」。「五大核心原则」在本插件里指的是工作原则（见 client-communication），不是辩点的分类 | 内部一致性问题，不涉及法条 | 指引 + 插件 SKILL.md |
| criminal-legal/non-prosecution-opinion | 「量情情节」 | 已改正：改为「量刑情节」（每个文件2处） | 错别字 | 指引 + 插件 SKILL.md |
| criminal-legal/plea-negotiation | 量刑指导意见的写法前后不一致（法发〔2021〕21号 与「2021年修订」） | 无法核实，保留〔待核〕：资料库里没有这份量刑指导意见，没有凭记忆统一写法。两处原文本来就带〔待核〕/【待元典验证】 | 资料库中无 | 未改 |
| criminal-legal/sentencing | 示例「交通肇事致轻伤」 | 已改正：改为「交通肇事致一人重伤（负事故主要责任且酒后驾驶）」。致人轻伤不构成交通肇事罪 | 刑法第133条；最高人民法院关于审理交通肇事刑事案件具体应用法律若干问题的解释第2条第二款 | 指引 + 插件 SKILL.md |
| criminal-legal/sentencing | 「累罚」含义不明 | 无法核实，保留〔待核〕：在原文后加了〔待核〕。从严情节的列举出自量刑指导意见，资料库里没有 | 资料库中无 | 指引 + 插件 SKILL.md（只加了标记） |
| criminal-legal/defense-statement | 「依据《刑法》及相关司法解释，谅解情节应当从轻处罚」 | 已改正：改为取得谅解属于影响量刑的酌定情节，「可以酌情从轻处罚」；双方依法达成和解协议的，「应当从轻处罚」。刑法里没有关于谅解的规定 | 最高人民法院关于适用《中华人民共和国刑事诉讼法》的解释第276条、第596条；刑事诉讼法第288条、第290条 | 指引 + 插件 SKILL.md |
| criminal-legal/defense-plan | 自首、从犯、未遂、立功的量刑比例 | 无法核实，保留〔待核〕：比例出自量刑指导意见，资料库里没有。原文已经标了〔待核〕和 [模型知识 — 需验证] | 资料库中无 | 未改 |
| criminal-legal/case-file-notes | 「讯问笔录必备字段（第4、5部分必检）」与12部分结构对不上 | 已改正：改为第3、4部分。讯问笔录在第三部分（受援人供述）和第四部分（同案犯供述），第五部分是被害人陈述 | 本技能的12部分结构 | 指引 + 插件 SKILL.md |
| criminal-legal/case-file-notes | 「需核对原件」的使用规则前后冲突 | 指引原文无误：指引已统一为自用版可记「原件待核」、提交版禁用。插件已改正：插件里还有3处要求写「需核对原件」，与它自己的提交版禁词规则冲突，现统一为：页码定不了写「卷内目录第 X 页」，签名等事实在分部底稿里标「原件待核」，OCR 风险提示只写在自用版/工作底稿里 | 本技能的提交版禁词规则（SKILL.md 第104、224行；references/submission-version-standard.md） | 只改插件 SKILL.md |

数量：已改正 11 条（其中 case-file-notes「需核对原件」一条只改了插件，指引本身没问题）；无法核实、保留〔待核〕3 条；原文无误 0 条。
app/guides/criminal-legal/investigation-stage-docs | 不批准逮捕意见书依据引第87条、第90条 | 已改正 | 刑事诉讼法第88条第二款（审查批捕听取辩护律师意见） | 指引与 SKILL.md

## 民事诉讼与执行

指引路径 | 问题 | 结论 | 依据 | 改了哪些文件
---|---|---|---|---
litigation-legal/ref-civil-procedure-core（1.6） | 管辖权异议审查期间「撤诉获准不影响异议审查」逻辑不通 | 已改正：删去该句，改为管辖确定后不因反诉、增加或变更诉讼请求而改变（违反级别、专属管辖除外） | 民诉法解释第39条第1款；民诉法第130条、第148条 | app/guides/litigation-legal/ref-civil-procedure-core.md；litigation-legal/references/civil-procedure-core.md
litigation-legal/ref-civil-procedure-core（4.2） | 小额诉讼「百分之五十但在二倍以下」与注释「50%-100%」矛盾 | 已改正：删去「50%-100%」及〔待核〕/[需核实]，写明区间为超过年平均工资 50%、不超过二倍（200%） | 民诉法第165条第2款 | 同上两文件
litigation-legal/ref-civil-procedure-core（法律依据表） | 查封规定写「2021 年修正」 | 已改正为「2020 年修正」（资料库版本日期 2020-12-29）；同表「办理财产保全案件规定」同样误为 2021 年修正，一并改为 2020 年修正 | 《最高人民法院关于人民法院民事执行中查封、扣押、冻结财产的规定》《最高人民法院关于人民法院办理财产保全案件若干问题的规定》，现行版本均为 2020-12-29 | 同上两文件
litigation-legal/ref-enforcement-core（2.4） | 民诉法解释第481条被用于两个事项 | 已改正：1.3 节「逾期申请」引第481条无误；2.4 节「执行通知应告知迟延履行利息」改为第480条 | 民诉法解释第480条第2款、第481条 | app/guides/litigation-legal/ref-enforcement-core.md；litigation-legal/references/enforcement-core.md
litigation-legal/ref-enforcement-core（6.2） | 恢复执行「不受申请执行时效限制，但约定履行期限中断时效」前后矛盾 | 已改正：改为申请恢复执行适用二年申请执行期间，自和解协议约定履行期间最后一日起算 | 《最高人民法院关于执行和解若干问题的规定》第9条、第10条；民诉法第250条 | 同上两文件
litigation-legal/ref-enforcement-core（7.1） | 标题为《执行担保规定》却引草案条文 | 已改正：引文换成执行担保规定第1条原文，并注明其中「第二百三十一条」是 2017 年条号，对应现行第242条 | 执行担保规定第1条；民诉法第242条 | 同上两文件
litigation-legal/ref-enforcement-core（11.2） | 「民事诉讼法第二百五十三条」为旧条号 | 原文无误（引的是法释〔2014〕8号第1条原文，原文就写第二百五十三条，指 2012 年修正文本）；已在引文后补注对应现行第264条。另外 3.3 节引「民诉法第253条」（查询、冻结、划拨）也符合现行条号，没有改 | 法释〔2014〕8号第1条；民诉法第253条、第264条 | 同上两文件（只加注）
litigation-legal/ref-evidence-rules-core（1.2） | 「四类要件」与第91条两项不符 | 已改正（表述问题）：第91条标题改为「条文分两项」，分配表标明是学理细分、不是条文原文 | 民诉法解释第91条 | app/guides/litigation-legal/ref-evidence-rules-core.md；litigation-legal/references/evidence-rules-core.md
litigation-legal/brief-section-drafter | 「民诉法第13条要求附签名」不成立 | 已改正：改为「民事诉讼应当遵循诚信原则（第13条第1款）」，删去「要求附签名」 | 民诉法第13条 | app/guides/litigation-legal/brief-section-drafter.md；litigation-legal/skills/brief-section-drafter/SKILL.md
litigation-legal/civil-complaint-drafting | 违法解除劳动合同示例直接写起诉状，没有提示劳动仲裁前置 | 已改正：示例流程加「确认是否已经劳动仲裁；未经仲裁的，先拟仲裁申请书」 | 《劳动争议调解仲裁法》第2条、第5条 | app/guides/litigation-legal/civil-complaint-drafting.md；litigation-legal/skills/civil-complaint-drafting/SKILL.md
litigation-legal/claim-chart | 等同写作「功能-方式-结果」 | 已改正为「基本相同的手段、功能、效果，且无需创造性劳动即能联想到」 | 《最高人民法院关于审理专利纠纷案件适用法律问题的若干规定》第13条第2款 | app/guides/litigation-legal/claim-chart.md；litigation-legal/skills/claim-chart/SKILL.md
litigation-legal/legal-hold | 「民诉法第81条」为旧条号；「解释第94—99条」与调查令条文重叠 | 已改正：第81条改为第84条；「解释第94—99条」（第94—97条是调查收集证据，第99条是举证期限）改为「民诉法解释第98条、《民事诉讼证据规定》第25—29条」 | 民诉法第84条；民诉法解释第94—99条、第98条；《最高人民法院关于民事诉讼证据的若干规定》第25—29条 | app/guides/litigation-legal/legal-hold.md；litigation-legal/skills/legal-hold/SKILL.md
litigation-legal/privilege-log-review | 「民诉法第65条（逾期提交证据）」为旧条号 | 已改正：3 处（指引）/ 2 处（插件）第65条改为第68条 | 民诉法第68条第2款（另见民诉法解释第101条） | app/guides/litigation-legal/privilege-log-review.md；litigation-legal/skills/privilege-log-review/SKILL.md
litigation-legal/subpoena-triage | 商业秘密条号；「银保监会」已撤销 | 已改正：《反不正当竞争法》第9条改为第10条（2025 年修订）；「银保监会」改为「国家金融监督管理总局」 | 《反不正当竞争法》（2025-06-27）第10条；《第十四届全国人民代表大会第一次会议关于国务院机构改革方案的决定》（不再保留中国银行保险监督管理委员会） | app/guides/litigation-legal/subpoena-triage.md；litigation-legal/skills/subpoena-triage/SKILL.md
litigation-legal/demand-draft | 「律师函不享有和解证据豁免」没有提妥协事实规则 | 已改正：写明第107条只保护诉讼中为调解或和解作出妥协而认可的事实，诉讼外律师函不当然适用 | 民诉法解释第107条 | app/guides/litigation-legal/demand-draft.md；litigation-legal/skills/demand-draft/SKILL.md
legal-clinic/client-letter、status | 「学生实践规则」「认证法律实习生」是美国制度 | 已改正：签名栏改为「法学专业学生（法律诊所学员）」；插件中「学生实践规则」的说法改为查阅诊所及所在地规定，并注明法学专业学生可作为法律援助志愿者（指引正文原本已经本地化，只改了签名栏） | 《法律援助法》第17条第2款 | app/guides/legal-clinic/client-letter.md；app/guides/legal-clinic/status.md；legal-clinic/skills/client-letter/SKILL.md；legal-clinic/skills/status/SKILL.md

统计：共 16 条。15 条已改正；1 条原文无误（11.2 节的引文，只补了一句注）；0 条无法核实。

## 劳动用工

指引路径 | 问题 | 结论 | 依据 | 改了哪些文件
---|---|---|---|---
employment-legal/ref-labor-core-rules | 2.4 表第40条一律写 N+1，与「代通知金才 +1」矛盾（同类错误还见于速查表「无过失性解除」行、7.5 节「需支付 N + 1 或代通知金」） | 已改正：经济补偿为 N，未提前 30 日书面通知、改为额外支付 1 个月工资的，另付 1 个月 | 《劳动合同法》第40条、第46条第（三）项 | app/guides/employment-legal/ref-labor-core-rules.md；employment-legal/references/labor-core-rules.md
employment-legal/ref-labor-core-rules | 7.4 浙江奖励假「30天（2021年修正后为60天）」表述不清 | 已改正：一孩延长产假60天，二孩、三孩延长产假90天；其他省份仍标待核 | 《浙江省人口与计划生育条例》（2021-11-25）第22条第（一）项 | 同上两文件
employment-legal/ref-labor-core-rules | 医疗期规定年份前后不一（7.5 写劳部发〔1994〕479号，附录四写1995年） | 无法核实，保留〔待核〕：资料库无该规章；附录四统一写文号，指引加〔待核〕，插件加 `[需核实]` | 资料库未收录《企业职工患病或非因工负伤医疗期规定》 | 同上两文件
employment-legal/ref-labor-core-rules | 附录四「劳动争议解释（一）第45条（加付赔偿金）」正文无对应 | 已改正：删去该项。第45条讲用人单位迫使劳动者解除合同，不是加付赔偿金；加付赔偿金在《劳动合同法》第85条（正文 3.5 节已有） | 《劳动争议解释（一）》第45条；《劳动合同法》第85条 | 同上两文件
employment-legal/hiring-review | 竞业限制范围、地域、期限的约定引「第24条第2款」，应为第1款 | 已改正（只改这一处；「期限不得超过二年（第24条第2款）」原文无误，未动） | 《劳动合同法》第24条第1款 | app/guides/employment-legal/hiring-review.md；employment-legal/skills/hiring-review/SKILL.md
employment-legal/labor-contract | 竞业补偿「在职后按月支付」应为「离职后」 | 已改正（每个文件 2 处：高管增强条款、合规自查表） | 《劳动合同法》第23条第2款（解除或者终止劳动合同后按月给予经济补偿） | app/guides/employment-legal/labor-contract.md；employment-legal/skills/labor-contract/SKILL.md
employment-legal/labor-contract | 「试用期参见第五节」应为第六节 | 插件已改正（第六节才是「生成前合规自查」，同一文件「生成前完成第五节的合规自查」也一并改为第六节）；指引原文已写「见『合规自查』」，无误未改 | 插件文件内部章节结构（非法条问题） | employment-legal/skills/labor-contract/SKILL.md
employment-legal/labor-contract | 「获准辞职」列入用人单位即时解除事由不当 | 已改正：删去「获准辞职」 | 《劳动合同法》第39条（六项事由中没有这一项；劳动者辞职适用第37条） | app/guides/employment-legal/labor-contract.md；employment-legal/skills/labor-contract/SKILL.md
employment-legal/severance-calc | 「超过6个月不满1年按1年计」，法条为「六个月以上」 | 已改正为「6 个月以上不满 1 年的（含满 6 个月），按 1 年计」 | 《劳动合同法》第47条第1款 | app/guides/employment-legal/severance-calc.md；employment-legal/skills/severance-calc/SKILL.md
employment-legal/leave-tracker | 年休假「一般不跨年结转」，没写单位确有必要的可以跨一个年度 | 已改正：「一般不跨年度安排；单位因生产、工作特点确有必要的，可跨 1 个年度安排」 | 《职工带薪年休假条例》第5条第2款 | app/guides/employment-legal/leave-tracker.md；employment-legal/skills/leave-tracker/SKILL.md

合计：10 条中，已改正 9 条（labor-contract「第五节」一条只改了插件，指引原文无误），无法核实保留〔待核〕1 条，判定原文无误 0 条。

## 公司、知识产权、采购

指引路径 | 问题 | 结论 | 依据 | 改了哪些文件
---|---|---|---|---
corporate-legal/closing-checklist | 「出席会议的股东所持表决权三分之二以上」配第120条 | 已改正（改为第116条第3款；指引里原为占位符【条号】，一并填上） | 《公司法》第116条第3款（第120条是股份公司董事会） | app/guides/corporate-legal/closing-checklist.md；corporate-legal/skills/closing-checklist/SKILL.md
corporate-legal/ref-company-law-2024-core | 关联董事回避引第182条 | 已改正（改写为「董事会对第182条至第184条事项决议时，关联董事不得参与表决（第185条）」） | 《公司法》第182条、第185条 | app/guides/corporate-legal/ref-company-law-2024-core.md；corporate-legal/references/company-law-2024-core.md
corporate-legal/ref-company-law-2024-core | 双重代表诉讼引第189条第2款 | 已改正（改为第4款） | 《公司法》第189条第4款 | 同上两个文件
corporate-legal/ref-company-law-2024-core | 宽限期（不少于60日）放在第51条下 | 已改正（注明宽限期见第52条第1款，自发出催缴书之日起不少于60日） | 《公司法》第51条、第52条第1款 | 同上两个文件
corporate-legal/ref-company-law-2024-core | 优先购买权期限混写（把未通知情形的30日/1年当成一般行使期限） | 已改正（一般行使期限按解释四第19条；30日/1年限制移到「未通知的后果」下，注明解释四第21条第1款） | 《公司法》第84条；《公司法解释四》第19条、第21条第1款 | 同上两个文件
corporate-legal/entity-compliance | 清算组名单「60日内」公示 | 已改正（10日内） | 《市场主体登记管理条例》第32条第1款 | app/guides/corporate-legal/entity-compliance.md；corporate-legal/skills/entity-compliance/SKILL.md
corporate-legal/entity-compliance | 年报引《企业信息公示暂行条例》第7、8条 | 已改正（改为第8、9条；第7条是其他政府部门公示） | 《企业信息公示暂行条例》第7条、第8条、第9条 | 同上两个文件（指引正文和依据列表两处）
ip-legal/ref-ip-core-rules | 5.3 节故意、情节严重的示例来自已废止的法释〔2021〕4号 | 已改正（按新解释第6条第2款、第7条第2款重写两段示例，标注条号） | 法释〔2026〕7号第6条、第7条、第14条 | app/guides/ip-legal/ref-ip-core-rules.md；ip-legal/references/ip-core-rules.md
ip-legal/ref-ip-core-rules（附带） | 5.3 节《反不正当竞争法》第17条〔待核〕 | 已改正（第22条第3款） | 《反不正当竞争法》（2025年修订）第22条第3款 | 同上两个文件
ip-legal/infringement-triage | 著作权自动产生引《著作权法》第11条 | 已改正（改为《著作权法实施条例》第6条；依据列表同步） | 《著作权法》第11条（作者归属）；《著作权法实施条例》第6条 | app/guides/ip-legal/infringement-triage.md；ip-legal/skills/infringement-triage/SKILL.md
ip-legal/infringement-triage | 外观设计侵权判断引专利法第23条（授权条件） | 已改正（改为专利法第64条第2款＋专利侵权解释第8、10、11条；指引依据列表中第23条换成第64条） | 《专利法》第23条、第64条第2款；《最高人民法院关于审理侵犯专利权纠纷案件应用法律若干问题的解释》第8条、第10条、第11条 | 同上两个文件
ip-legal/clearance | 描述性标志引第11条第1款第2-3项 | 已改正（第2项；第3项是「其他缺乏显著特征」） | 《商标法》第11条第1款 | app/guides/ip-legal/clearance.md；ip-legal/skills/clearance/SKILL.md
ip-legal/clearance | 虚假关联引第10条第1款第5-6项（红十字、民族歧视） | 已改正（第10条第1款第1-4项；涉及他人姓名等在先权利的，第32条；指引依据列表补第32条） | 《商标法》第10条第1款、第32条 | 同上两个文件
ip-legal/ip-clause-review | 发明人署名权引专利法第17条 | 已改正（第16条；指引依据列表同步） | 《专利法》第16条、第17条（第17条是外国人申请） | app/guides/ip-legal/ip-clause-review.md；ip-legal/skills/ip-clause-review/SKILL.md
ip-legal/ip-clause-review | 「发明人认定错误是专利无效事由」〔待核〕 | 已改正（改为：不在细则第69条第2款列举的无效宣告理由之内；去掉〔待核〕） | 《专利法》第45条；《专利法实施细则》（2023）第69条第2款 | 同上两个文件
ip-legal/invention-intake | 宽限期混写12个月和6个月 | 已改正（插件原文第31、56、267行的「十二个月」统一为六个月；指引已是六个月，未动） | 《专利法》第24条 | ip-legal/skills/invention-intake/SKILL.md
ip-legal/invention-intake | 第24条只列三种情形 | 已改正（补「国家出现紧急状态或者非常情况时为公共利益目的首次公开」） | 《专利法》第24条第1项 | app/guides/ip-legal/invention-intake.md；ip-legal/skills/invention-intake/SKILL.md
ip-legal/cease-desist | 警告函依据列专利法第65条，赔偿在第71条 | 已改正（第65条本身无误，是侵权纠纷解决条款；补列第71条） | 《专利法》第65条、第71条 | app/guides/ip-legal/cease-desist.md；ip-legal/skills/cease-desist/SKILL.md
ip-legal/fto-triage 与 infringement-triage | 专利号类型识别规则互相矛盾（fto 写「前缀为'外观设计'」，infringement 写「以类型代码1/2/3开头」） | 无法核实，保留〔待核〕（资料库没有专利申请号编码标准；fto 原文的「前缀为外观设计」改成「以专利证书或专利登记簿记载的专利类型为准」并标 `[需核实]`；infringement 保留原文，加〔待核〕/`[需核实]` 和同样的兜底说明） | 资料库无相关规范 | ip-legal/skills/fto-triage/SKILL.md；app/guides/ip-legal/infringement-triage.md；ip-legal/skills/infringement-triage/SKILL.md

## 发现但未改（不在待核清单内）

- 《反不正当竞争法》2025年修订后条号整体后移：混淆行为现为第7条（第6条是社会监督），虚假宣传第9条，商业秘密第10条。ip-legal/cease-desist（「反不正当竞争法第6条」）和 ip-legal/infringement-triage（第6条、第8条、第9条）仍按2019年版条号引用。建议另行统一核改。
- fto-triage 用《专利法》第23条描述外观设计「测试标准」，指引依据列表注明「外观设计授权条件」，标注本身无误，未改。

## 统计

共19条：已改正 18 条，原文无误 0 条（cease-desist 的第65条本身没错，补列第71条后计入已改正），无法核实保留〔待核〕1 条。

## 个人信息、AI 治理、合同

指引路径 | 问题 | 结论 | 依据 | 改了哪些文件
---|---|---|---|---
privacy-legal/ref-pipil-core-provisions（2.6 第45条） | 数据安全法第45条罚款数额套用旧数额 | 已改正：一般 5-50万元（直接责任人员1-10万），拒不改正或严重后果 50-200万元（直接责任人员5-20万），补第2款核心数据 200-1000万元 | 数据安全法第45条 | app/guides/privacy-legal/ref-pipil-core-provisions.md；privacy-legal/references/pipil-core-provisions.md
privacy-legal/ref-pipil-core-provisions（2.6 第48条） | 第48条被写成「主管人员责任」 | 已改正：第1款拒不配合数据调取（5-50万元），第2款未经批准向外国司法执法机构提供数据（10-100万元，严重后果100-500万元）。第46条一行原文无误，没动 | 数据安全法第46条、第48条 | 同上
privacy-legal/ref-pipil-core-provisions（1.2） | 合法性基础第2项漏「人力资源管理」 | 已改正，补上「按依法制定的劳动规章制度和依法签订的集体合同实施人力资源管理所必需」 | 个人信息保护法第13条第1款第2项 | 同上
privacy-legal/ref-pipil-core-provisions（1.5） | 标题写第44-47条，内容写到第48、49条 | 已改正：标题改为「第44-49条」 | 个人信息保护法第44-49条 | 同上
privacy-legal/dpa-review | 第57条写「通知网信办」 | 已改正：「通知履行个人信息保护职责的部门和个人」 | 个人信息保护法第57条 | app/guides/privacy-legal/dpa-review.md；privacy-legal/skills/dpa-review/SKILL.md
privacy-legal/pia-generation 与 use-case-triage | 第55条情形数「四类」与「四类+兜底」不一致 | 已改正：第55条共5项（4项具体情形加1项兜底）。指引原文（「第55条情形」「四类+兜底」）无误；插件里的两处「四类情形」改为「四类情形+兜底」 | 个人信息保护法第55条 | privacy-legal/skills/pia-generation/SKILL.md；privacy-legal/skills/use-case-triage/SKILL.md
privacy-legal/policy-monitor | 「网信办和市场监管部门已对 CMP 配置错误采取执法行动」没有出处 | 无法核实，保留〔待核〕：执法案例不在资料库里，原文保留，句末加〔待核〕 | 资料库无 | app/guides/privacy-legal/policy-monitor.md；privacy-legal/skills/policy-monitor/SKILL.md
regulatory-legal/ref-admin-law-core（2.1） | 行政复议法第11条只列12项 | 已改正：按2023年修订文本改为15项（补赔偿决定、工伤认定、政府信息公开；履职、给付、行政协议各项按原文改写；兜底项改为「其他行政行为」） | 行政复议法（2023）第11条 | app/guides/regulatory-legal/ref-admin-law-core.md；regulatory-legal/references/admin-law-core.md
regulatory-legal/ref-admin-law-core（期限表） | 政府信息公开写「可延长20日」 | 已改正：「可延长20个工作日」 | 政府信息公开条例第33条第2款 | 同上
regulatory-legal/ref-admin-law-core（4.2） | 「当当场」笔误 | 已改正：「应当当场」 | 行政许可法第32条第1款第4项 | 同上
ai-governance-legal（多篇）：生成式 AI 安全评估条号 | 多数篇目写第17条，ref-ai-governance-core 写第16条（1.5、8.x 触发条件） | 无法核实，保留〔待核〕：资料库里没有部门规章，各处冲突的条号后面加〔待核〕，条号没动 | 资料库无 | 指引：ai-inventory、aia-generation、vendor-ai-review、ref-ai-governance-core；插件：skills/ai-inventory、aia-generation、vendor-ai-review/SKILL.md，references/ai-governance-core.md
ai-governance-legal（多篇）：内容标识条号 | ref-ai-governance-core 写第12条，policy-starter、use-case-triage 写第15条 | 无法核实，保留〔待核〕：ref-core 1.3 节标题和 9.3 表加〔待核〕；指引里第15条原来已标〔待核〕，插件 policy-starter（2处）和 use-case-triage 补标 | 资料库无 | 指引：ref-ai-governance-core；插件：references/ai-governance-core.md，skills/policy-starter、use-case-triage/SKILL.md
ai-governance-legal（多篇）：罚则条号 | 各篇都写生成式 AI 办法第21条（金额1-10万元）、算法推荐规定第31条；指引 reg-gap-analysis 已标〔待核〕，插件没标 | 无法核实，保留〔待核〕：插件 reg-gap-analysis 补标〔待核〕 | 资料库无 | ai-governance-legal/skills/reg-gap-analysis/SKILL.md
ai-governance-legal（多篇）：算法推荐透明度条号 | ref-ai-governance-core 写第7条，ai-inventory、policy-starter 写第16条（ref-core 又把第16条写成「影响网络舆论」） | 无法核实，保留〔待核〕：ref-core 2.3 和 9.3 的第7条、ai-inventory 和 policy-starter 的第16条后面加〔待核〕 | 资料库无 | 指引：ref-ai-governance-core、ai-inventory、policy-starter；插件：对应 SKILL.md 和 references/ai-governance-core.md
ai-governance-legal/ref-ai-governance-core（10.3） | 数据安全法一行写「50-500万元」，条文里没有这个档次 | 已改正：拒不改正或严重后果 50-200万元（第45条），违规向境外提供重要数据情节严重的 100-1000万元（第46条）。同表网络安全法第61条一行已核对，无误 | 数据安全法第45条、第46条；网络安全法（2025修正）第61条 | app/guides/ai-governance-legal/ref-ai-governance-core.md；ai-governance-legal/references/ai-governance-core.md
ai-governance-legal/ref-currency-watch | 时效监测清单没有反映网络安全法2025年修正 | 已改正：补上「2025年10月28日修正，修正后版本2026年1月1日起施行（条文重新编号，新增第20条人工智能条款，罚则提高）」，等保义务标第23条。「最近核实」日期没改，因为只核了这一条 | 关于修改网络安全法的决定；网络安全法（2025）第20条、第23条 | app/guides/ai-governance-legal/ref-currency-watch.md；ai-governance-legal/references/currency-watch.md
commercial-legal/ref-contract-law-core（附二） | 附二仍把重大误解写成合同编通则解释第3条；条号区间也不对 | 已改正：第3条是合同成立的认定（重大误解指向总则编解释第十九条）；第11条是「缺乏判断能力」（不是电子合同提示，电子合同在第10条第3款）；原来的「32-42违约金」「53-61解除」「62-68违约责任」改为按原文分段：32情势变更、33-46代位权和撤销权、52-54解除、55-58抵销、59违约方请求终止、60-63损害赔偿、64-66违约金、67-68定金 | 合同编通则解释第3、10、11、32-68条；总则编解释第十九条 | app/guides/commercial-legal/ref-contract-law-core.md；commercial-legal/references/contract-law-core.md
commercial-legal/ref-contract-law-core（1.1） | 标题写第471-489条，内容引了第490条，还把第490条（成立时间）标成「合同成立地点」（地点在第493条） | 已改正：标题改为第471-490条，小标题改为「合同书形式的成立时间」 | 民法典第490条、第493条 | 同上
commercial-legal/nda-review | 法律适用选择引民法典第467条 | 已改正：第467条讲的是无名合同和三类中外合同适用中国法。改为涉外民事关系法律适用法第41条（协议选择合同适用的法律）、第4条（强制性规定直接适用）、第5条（损害社会公共利益的适用中国法），法律依据清单同步改 | 民法典第467条；涉外民事关系法律适用法第4、5、41条 | app/guides/commercial-legal/nda-review.md；commercial-legal/skills/nda-review/SKILL.md
commercial-legal/saas-msa-review | 「个保法第21条要求委托处理取得同意」 | 已改正：第21条要求约定委托事项并监督，受托人转委托须经个人信息处理者同意；单独同意是第23条（向其他个人信息处理者提供） | 个人信息保护法第21条、第23条 | app/guides/commercial-legal/saas-msa-review.md；commercial-legal/skills/saas-msa-review/SKILL.md
corporate-legal/legal-opinion | 法律意见书模板的免责声明写「不构成正式法律意见」，跟文书性质矛盾 | 已改正（表述问题，没有对应法条）：改为「仅供委托方就本事项使用；未经执业律师审核签署，不作为正式出具的法律意见」 | 没有直接对应的法条；按文书性质改 | app/guides/corporate-legal/legal-opinion.md；corporate-legal/skills/legal-opinion/SKILL.md（原则第7条、检查清单、模板，共3处）

附注：
- 资料库里的数据安全法、个人信息保护法、网络安全法正文标的是 official=0，也就是还没有和官网核对过。上面的改正以资料库条文为准；pipil-core 原有的「金额尚未对照官方文本复核〔待核〕」提示保留没删。
- 《生成式人工智能服务管理暂行办法》《算法推荐管理规定》《深度合成管理规定》都是部门规章，资料库里没有，所以条号一处都没改，只标了〔待核〕。
- use-case-triage 示例行「大规模敏感个人信息（第55条第1项）」：第1项本身没有「大规模」的限定，但这一行不算错，没改。

## 《反不正当竞争法》条号统一（2019 → 2025）

file | old | new | subject
app/guides/employment-legal/hiring-review.md | 《反不正当竞争法》第9条 | 《反不正当竞争法》第10条 | 商业秘密
app/guides/employment-legal/hiring-review.md | 《反不正当竞争法》第9条 | 《反不正当竞争法》第10条 | 商业秘密
employment-legal/skills/hiring-review/SKILL.md | 《反不正当竞争法》第9条 | 《反不正当竞争法》第10条 | 商业秘密
app/guides/ip-legal/cease-desist.md | 反不正当竞争法第6条 | 反不正当竞争法第7条 | 混淆行为
app/guides/ip-legal/cease-desist.md | 《反不正当竞争法》第6条 | 《反不正当竞争法》第7条 | 混淆行为
ip-legal/skills/cease-desist/SKILL.md | 反不正当竞争法第6条 | 反不正当竞争法第7条 | 混淆行为
app/guides/ip-legal/infringement-triage.md | 《反不正当竞争法》第8条关于虚假宣传 | 《反不正当竞争法》第9条关于虚假宣传 | 虚假宣传
app/guides/ip-legal/infringement-triage.md | 《反不正当竞争法》第6条对包装装潢 | 《反不正当竞争法》第7条对包装装潢 | 混淆（包装装潢）
app/guides/ip-legal/infringement-triage.md | 依《反不正当竞争法》第9条： | 依《反不正当竞争法》第10条： | 商业秘密
app/guides/ip-legal/infringement-triage.md | 《反不正当竞争法》第6条、第8条、第9条 | 《反不正当竞争法》第7条、第9条、第10条 | 混淆/虚假宣传/商业秘密
ip-legal/skills/infringement-triage/SKILL.md | 《反不正当竞争法》第8条 `[法条原文]` 关于虚假宣传 | 《反不正当竞争法》第9条 `[法条原文]` 关于虚假宣传 | 虚假宣传
ip-legal/skills/infringement-triage/SKILL.md | 《反不正当竞争法》第6条 `[法条原文]` 关于包装装潢 | 《反不正当竞争法》第7条 `[法条原文]` 关于包装装潢 | 混淆（包装装潢）
ip-legal/skills/infringement-triage/SKILL.md | 《反不正当竞争法》第9条 `[法条原文]` 关于商业秘密 | 《反不正当竞争法》第10条 `[法条原文]` 关于商业秘密 | 商业秘密
ip-legal/skills/infringement-triage/SKILL.md | 《反不正当竞争法》第9条列举的不正当手段 | 《反不正当竞争法》第10条列举的不正当手段 | 商业秘密（不正当手段）
app/guides/product-legal/launch-review.md | 《反不正当竞争法》第8条 | 《反不正当竞争法》第9条 | 虚假宣传
app/guides/product-legal/launch-review.md | 《反不正当竞争法》第8条 | 《反不正当竞争法》第9条 | 虚假宣传
product-legal/skills/launch-review/SKILL.md | 《反不正当竞争法》第8条 | 《反不正当竞争法》第9条 | 虚假宣传
app/guides/product-legal/marketing-claims-review.md | 《反不正当竞争法》第8条 | 《反不正当竞争法》第9条 | 虚假宣传
app/guides/product-legal/marketing-claims-review.md | 《反不正当竞争法》第8条 | 《反不正当竞争法》第9条 | 虚假宣传
product-legal/skills/marketing-claims-review/SKILL.md | 《反不正当竞争法》第8条 | 《反不正当竞争法》第9条 | 虚假宣传
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第32条 | 《反不正当竞争法》第39条 | 商业秘密举证责任转移
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第11条 | 《反不正当竞争法》第12条 | 商业诋毁
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第11条 | 《反不正当竞争法》第12条 | 商业诋毁
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第9条 | 《反不正当竞争法》第10条 | 商业秘密
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第9条 | 《反不正当竞争法》第10条 | 商业秘密
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第8条 | 《反不正当竞争法》第9条 | 虚假宣传
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第8条 | 《反不正当竞争法》第9条 | 虚假宣传
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第6条 | 《反不正当竞争法》第7条 | 混淆行为
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第6条 | 《反不正当竞争法》第7条 | 混淆行为
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第6条 | 《反不正当竞争法》第7条 | 混淆行为
litigation-legal/skills/claim-chart/references/element-templates.md | 《反不正当竞争法》第6条 | 《反不正当竞争法》第7条 | 混淆行为
app/guides/ip-legal/ref-ip-core-rules.md | ### 4.1 商业秘密定义与侵权（第9条） | ### 4.1 商业秘密定义与侵权（第9条，2025年修订为第10条） | 商业秘密（2019版条文，加注现条号）
app/guides/ip-legal/ref-ip-core-rules.md | **举证责任转移（第32条）** | **举证责任转移（第32条，2025年修订为第39条）** | 商业秘密举证责任转移（加注现条号）
ip-legal/references/ip-core-rules.md | ### 4.1 商业秘密定义与侵权（第9条） | ### 4.1 商业秘密定义与侵权（第9条，2025年修订为第10条） | 商业秘密（2019版条文，加注现条号）
ip-legal/references/ip-core-rules.md | **举证责任转移（第32条）** | **举证责任转移（第32条，2025年修订为第39条）** | 商业秘密举证责任转移（加注现条号）

未改动（已核实）：
- app/guides/litigation-legal/subpoena-triage.md L80, L233 与 litigation-legal/skills/subpoena-triage/SKILL.md L98：已是第10条（商业秘密），正确
- ip-core-rules（两份）惩罚性赔偿 第22条第3款（2025年修订）：正确
- ip-core-rules 4.2/4.3/4.4 标题已注明 2025 年条号（7/9/13），正文引用的是 2019 年版原文，保留；第2条未变
- product-legal currency-watch（两份）只泛称"条号整体后移"，无具体条号，未改
- 其余命中只提法律名称（无条号）
