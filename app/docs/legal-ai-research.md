# 中国法律检索 App：专业法律 AI 设计调研报告

调研日期：2026-11-04。只读调研，未修改任何仓库文件。
说明：A 部分以公开网页为准，厂商自述的指标一律标为“厂商自报”。C 部分的探测请求从中国大陆以外的 IP 发出，部分站点（如中国执行信息公开网）按地域直接拦截，大陆网络下的表现可能不同。

---

## 摘要

1. 头部产品已经不再是“问答+摘要”，而是 **技能/工作流 + 编排层 + 自有权威数据 + 引用核验 + 人工复核节点**。共同做法有：先出计划再执行（CoCounsel Deep Research）、按 playbook 逐条审查合同并给出首选/后备立场（Ironclad、Harvey、Legora、Spellbook）、引用链接到段落级出处并做“幻觉检查”（Harvey source score、Westlaw/Lexis 的引证核验、元典 hall-detect）。
2. 独立评测显示：法律专用工具在文档问答、抽取、摘要上已经超过律师基线，但**红线修改（redlining）仍落后于律师**（Vals 2025-02：律师 79.7%，Harvey 65.0%）；法律检索类工具仍有 **17%–33% 的幻觉率**（Stanford/Yale）。所以本 App 最该投入的是：检索有据、引用逐条核验、合同审查按清单分段多轮做。
3. 面向老板和 HR，最常见也最值钱的 8 类任务：**劳动用工争议/解除评估、合同审查、某行为是否合法（合法性判断）、被诉/被索赔应对、催款与起诉可行性、期限与时效计算、交易对手主体调查、公司治理/股权与出资问题**（详见 B 部分）。
4. 官方公开查询普遍有 JS 反爬、滑块验证码或登录墙，**不适合后台自动抓取**。现实做法是：App 内生成查询要素，再“一键打开官方页面”让用户本人查，查到的结果由用户截图或粘贴回来交给 AI 分析。中国商标网的公告页、人民法院公告网首页、CAC 公布的算法/大模型备案名单等静态页面可以直接读取。

---

## Part A：专业法律 AI 产品的设计模式

### A1. 国际产品逐个看

| 产品 | 任务/技能形态 | 路由与编排 | 合同审查方法 | 防幻觉/核验 | 输出呈现 | 来源 |
|---|---|---|---|---|---|---|
| **Harvey** | Assistant（问答/起草）、Vault（大批量文档库与批量分析）、Workflows/Agents（把律所流程做成智能体）、Word 内 Playbook | 管理员可开放 Builder 权限让团队建工作流，由管理员控制发布；Agent 端到端执行多步任务 | Word 内 Playbook 把条款分为 **可接受 / 需复核 / 不可接受**，选中的修改以修订模式写入；可先建 playbook 再生成“合同审查 Agent”，需要判断时转人工 | BigLaw Bench 的 **source score**：每个实质性论断必须挂到原文出处，内部要求到段落级；**多模型链路中传递原文而不是摘要，减少层层转述的失真** | 行内引用+参考来源区，点击跳到原文段落 | [BigLaw Bench](https://www.harvey.ai/blog/introducing-biglaw-bench)、[source score](https://www.harvey.ai/blog/biglaw-bench-sources)、[Agents](https://www.harvey.ai/resources/videos/agents-overview)、[帮助文档(需登录)](https://eu.help.harvey.ai/articles/harvey-admin-quick-start-part-2) |
| **Thomson Reuters CoCounsel Legal** | 技能式（文档审阅、摘要、时间线、检索）+ Guided Workflows（隐私政策、员工制度、起诉状、证据开示请求与答复、证人笔录审阅）+ Deep Research | 自建编排层；**Deep Research 先生成多步检索计划给用户确认，再迭代执行** | 引导式工作流按步骤走，每步链接 Practical Law 范本，最后出初稿供复核 | 智能体调用 Westlaw 自有工具（Key Number、KeyCite、法条注释）；有**引证幻觉检查器**；Litigation Document Analyzer 逐条比对诉状里的法律论断和所引来源 | 报告包含正反论点、胜诉/败诉类似案例、待研究的相关问题 | [LawNext 2025-08](https://www.lawnext.com/2025/08/thomson-reuters-launches-cocounsel-legal-with-agentic-ai-and-deep-research-capabilities-along-with-a-new-and-final-version-of-westlaw.html)、[TR 新闻稿](https://www.thomsonreuters.com/en/press-releases/2025/august/thomson-reuters-launches-cocounsel-legal-transforming-legal-work-with-agentic-ai-and-deep-research)、[UK 扩展 2026-01](https://legaltechnology.com/thomson-reuters-expands-cocounsel-legal-to-uk-including-deep-research-on-practical-law-and-westlaw/) |
| **Lexis+ with Protégé**（原 Lexis+ AI） | 研究、分析、起草、审阅一体；技能（LexisNexis 预置，客户自建“即将推出”） | 用户用自然语言说目标，系统在后台挑模型、智能体、技能和数据源；**上下文在步骤间延续** | 文档感知编辑+修订模式；可接 DMS 选材料起草 | 引用链接 + **Shepard's 引证状态/处理情况核验**；无法链接的引用会被标记 | Word/Excel/PPT 输出、结构化表格、建议下一步 | [Lexis 新闻稿](https://www.lexisnexis.com/community/pressroom/b/news/posts/lexis-with-protege-accelerates-frictionless-agentic-productivity-from-first-idea-to-review-ready-legal-work-product)、[Protégé General AI](https://www.lexisnexis.com/community/pressroom/b/news/posts/lexisnexis-unveils-next-generation-protege-general-ai-the-most-integrated-legal-ai-workflow-solution) |
| **Spellbook** | Word 插件：起草、Review、Benchmarks；Associate（多文档智能体：数据室审阅、披露函） | Associate 规划并执行有监督的多文档流程 | **Benchmarks**：按合同类型对照“标准”（市场标准或自定义），做整份文档“体检”找缺失条款；可上传金标准模板/playbook 生成可编辑的“主题+规则”；标准团队共享 | 用户逐条接受/拒绝红线 | 红线+批注 | [Benchmarks 报道](https://www.artificiallawyer.com/2024/07/10/spellbook-launches-contract-benchmarks-to-show-whats-market/)、[Spellbook in-house](https://spellbook.com/in-house) |
| **Luminance** | 起草、谈判、签后分析；Autopilot 处理 NDA 等常规合同（分流、谈判、风险修复、回复）；Lumi Go 自动和对方谈判 | — | “Panel of Judges”：**多模型专家混合，用概率共识决定结果**（相当于多模型投票/交叉复核） | 共识机制（厂商自述，无独立测试） | — | [Luminance 新闻稿](https://www.luminance.com/press/luminance-raises-75-million-in-series-c-funding-round/)、[TechCrunch](https://techcrunch.com/2025/02/18/legal-ai-startup-luminance-backed-by-the-late-mike-lynch-raises-75m) |
| **Robin AI** | Playbook 合同审查、Word 红线、合同库检索、数据抽取 | — | Playbook 驱动 | — | — | 公开资料少；有资料称其 2025 年底已停止独立运营（来自竞品 Spellbook，需核实）：[spellbook.com/learn/robin-ai-pricing](https://spellbook.com/learn/robin-ai-pricing) |
| **Legora** | Assistant、Tabular Review、Word/Outlook 插件、Playbooks、Agent、Workflows、Legal Research、Intake、Monitors、Skills | **aOS 编排层**：工具路由、控制流、记忆、模型选择、护栏；**并行派发专门子智能体** | Playbook = 条款清单+谈判准则+红线偏好，起草/审阅时自动或手动套用；**Tabular Review：一份文档一行、一个问题一列**，批量尽调 | 法律检索“基于真实来源、结构化引用” | 表格、修订模式 | [legora.com/product](https://legora.com/product)、[支持中心](https://support2.legora.com/introduction/welcome/welcome-to-legora) |
| **Ironclad**（Jurist → Contract Review Agent） | 起草、Intake、红线、合同智能；Word 插件 | **专门智能体流水线：解析 playbook → 抽规则 → 条款切分与分类 → 生成红线** | Playbook 写明 **首选立场、后备立场及触发条件、谈判姿态、显式规则**；结合“谁的模板、在谈什么、我方立场”逐条评估；律师可切换“首选 / 后备 / 不改”；**playbook 上线前用人工标注的“金标准集”验证** | 每处修改挂到 playbook 依据；按 **有依据、完整、简洁、不改合规文字** 四个维度评质量；厂商自报 99% 有依据 | 带理由的修订，理由可直接发给对方 | [redlining playbooks](https://ironcladapp.com/resources/articles/jurist-redlining-playbooks)、[Agent 发布](https://ironcladapp.com/resources/articles/ai-agentic-launch)、[Word 中的审查 Agent](https://ironcladapp.com/resources/articles/contract-review-agent-for-microsoft-word) |
| **Kira (Litera)** | 抽取起家：内置 1,400+ smart fields，覆盖 40+ 领域；生成式 smart fields 用提示词自定义字段；Kira Chat | — | 先抽取再结构化（字段→表），适合尽调 | Chat 回答带链接引用；可按项目关闭生成式 AI；非英文准确率下降（用户评价） | 字段表格 | [LTH: Kira](https://www.legaltechnologyhub.com/vendors/kira-by-litera)、[aicounsel](https://aicounsel.substack.com/p/kira-systems-litera-ai-contract-review) |

### A2. 中国产品逐个看

| 产品 | 公开可确认的能力 | 值得借鉴的设计点 | 来源 |
|---|---|---|---|
| **北大法宝（法宝新AI / 2026 年“法宝灵境”）** | 法规库 470 万+、案例 1.6 亿+（第三方报道）；“法宝联想”把法条、案例、期刊互相关联；“新AI 检查文书”入口；2026-09 发布智能工作台“法宝灵境”、律爱升级、**北大法宝 MCP 生态** | 权威库 + 法条/案例/文献交叉链接（等同于本 App 的“法条↔司法解释↔案例”关联图）；以 MCP 把检索开放给智能体 | [中国矿大图书馆指南](https://lib.cumt.edu.cn/16bdfb.pdf)、[中华网 2026-09](https://m.tech.china.com/articles/20260923/202609231961699.html) |
| **通义法睿（阿里）** | 法律问答、法律适用推理、类案推荐、案情分析、文书生成、法律知识检索、合同条款审查；底层能力：要素抽取、案情摘要、案由识别、法条预测、争议焦点识别 | 技术路线 = **精调 + 强化学习 + RAG + 法律 Agent + 司法专用小模型**；把“案由识别、法条预测、争议焦点”做成前置结构化步骤 | [阿里云帮助文档](https://help.aliyun.com/document_detail/2778916.html)、[文档2](https://help.aliyun.com/document_detail/2778994.html) |
| **元典（元典问达 / 开放 API）** | 问答引擎生成可溯源的答案与研究报告；API 提供法条语义/关键词/详情检索、案例关键词/向量检索；**专项接口 hall-detect 检测文本中的法规/案例引用是否准确** | **“引用幻觉检测”做成独立工具**，回答生成后专门调用一次 | [skills.sh: yuandian-law-search](https://www.skills.sh/site/skills.volces.com/yuandian-law-search)、[第三方介绍](https://besthub.dev/articles/how-ai-is-transforming-legal-research-inside-the-yuandian-wenda-smart-q-a-engine-973d50dd8dfa) |
| **iCourt / AlphaGPT** | 案情分析：提炼关键词、案由标签、分析意见、答辩意见；生成文书并匹配法条和案例；意见书含**时间轴、诉讼可行性、风险评估**；类案库（称与最高法合作） | **按意图路由**：合同审查请求进“条款漏洞检查”模块，诉讼策略问题进“类案推理引擎”；展示推导过程 | [投资界 2023](https://news.pedaily.cn/20230721/63653.shtml)、[中华网 2025-12](https://m.tech.china.com/hea/articles/20251218/202512181783339.html)、[LTH](https://www.legaltechnologyhub.com/vendors/alpha-by-icourt/) |
| **幂律智能（MeCheck / MeFlow / PowerLawGLM）** | 合同上传后给出 **高/中/低风险**；审查点 300+（另有报道近千个），称综合准确率 95%+（厂商自报）；MeCheck 可自主实现、优化审查点；MeCheck Agent 把企业制度和审查标准结合成可积累的风控能力 | **审查点库**（= issue list / 清单）是合同审查的核心资产；企业可以加入自己的制度 | [36氪](https://www.36kr.com/p/1716361195336452)、[每经 2022](https://www.nbd.com.cn/articles/2022-02-13/2122823.html)、[投资界 2023-12](https://news.pedaily.cn/202312/526910.shtml)、[腾讯云](https://cloud.tencent.com/developer/news/4261553) |
| **得理（得理法搜 / 小理AI / 得理律助）** | 约 1.3 亿裁判文书、300 万法规（第三方）；语义/关键词/长文本检索；**AI 类案检索总结报告：审判观点、常见争议点、相关法条**；合同生成/审查、文书撰写、咨询 | 类案报告的固定结构（裁判观点归纳 + 争议点 + 法条）值得照搬 | [得理新闻](https://www.delilegal.com/news/company/NKXfTjoVBIjHRlcDmrTyFvjJrrtnnuNg)、[App Store](https://apps.apple.com/us/app/%E5%BE%97%E7%90%86%E5%BE%8B%E5%8A%A9/id1622777222) |
| **秘塔 AI 搜索** | 本次检索未找到其法律专业模式的一手资料。按公开使用经验：通用 AI 搜索，可选“学术/文库”等范围，答案带编号来源 | 编号来源 + 来源卡片的展示方式 | 未找到一手来源（标为待核实） |

### A3. 公开评测结果

| 评测 | 要点 | 来源 |
|---|---|---|
| **Vals Legal AI Report（2025-02，VLAIR 第一期）** | 7 项任务，律师基线 / 最佳 AI：数据抽取 71.1% / 75.1%（Harvey）；文档问答 70.1% / **94.8%**（Harvey）；文档摘要 50.3% / 77.2%（CoCounsel）；**红线修改 79.7% / 65.0%（律师领先）**；笔录分析 53.7% / 77.8%；时间线 80.2% / 80.2%（持平）；EDGAR 检索 70.1% / 55.2%。用 LLM-as-judge 对照参考答案逐要素打分；样本来自律所 500+ 真实任务；厂商自选参测任务 | [vals.ai](https://www.vals.ai/industry-reports/vlair-2-27-25)、[伯克利 PDF](https://www.law.berkeley.edu/wp-content/uploads/archive/2025/12/VALs-AI-Legal-AI-report-February-2025-.pdf) |
| **Vals 法律检索报告（2025-10）** | 法律 AI（Alexi、Counsel Stack、Midpage）准确率 78–81%，通用 ChatGPT 80%，都超过律师；Harvey/CoCounsel 未参加 | [LawNext 2025-10](https://www.lawnext.com/2025/10/vals-ais-latest-benchmark-finds-legal-and-general-ai-now-outperform-lawyers-in-legal-research-accuracy.html) |
| **Stanford/Yale “Hallucination-Free?”（JELS 2025）** | Lexis+ AI、Westlaw AI-AR、Ask Practical Law AI 幻觉率 **17%–33%**；Lexis+ AI 正确率约 65%，Westlaw 约 42%；Practical Law 60%+ 回答不完整。幻觉分两类：**内容错误**，以及 **“错误挂靠”（misgrounded：论断本身可能对，但所引来源并不支持它）** | [arXiv 2405.20362](https://arxiv.org/abs/2405.20362)、[论文 PDF](https://nlp.stanford.edu/~manning/papers/Magesh-Hallucination%E2%80%90Free-2025.pdf) |
| **Harvey BigLaw Bench / BLB Arena / LAB** | 律师设计的真实任务+定制评分细则；“source score”考核来源挂靠；2025-11 推出两两比较的 Arena；LAB 测长链路智能体任务（厂商自建，未见独立复现） | [BLB](https://www.harvey.ai/blog/introducing-biglaw-bench)、[Arena](https://www.harvey.ai/blog/introducing-biglaw-bench-arena)、[扩展版](https://www.harvey.ai/blog/expanding-big-law-bench) |
| **LegalBench（2023，Guha 等）** | 162 项任务，按 IRAC 拆为 issue-spotting、rule-recall、rule-application、rule-conclusion、interpretation、rhetorical-understanding | [arXiv 2308.11462](https://arxiv.org/abs/2308.11462) |
| **LawBench（2023）/ LexEval（NeurIPS 2024）**（中文） | LawBench：20 任务，分记忆、理解、应用三层，测 51 个模型；LexEval：23 任务、14,150 题，测 38 个模型，含伦理、逻辑推理维度。可直接用来回归测试本 App 的模型选型 | [LexEval](https://arxiv.org/html/2409.20288v4)、[LawBench GitHub](https://github.com/open-compass/LawBench) |

### A4. 提炼出的设计模式（建议本 App 采用）

**1. 意图路由到“技能/工作流”，不要一个通用 prompt 包打天下**
- iCourt 按意图路由到不同模块；Lexis 在后台挑模型、技能和数据源；Legora aOS 做工具路由和子智能体并行。
- 建议：第一步由路由器把请求分到 B 部分的任务族（合法性判断、合同审查、被诉应对……），每个任务族配自己的 **intake 问题清单 + 推理步骤 + 输出模板 + 必查数据源**。

**2. 先问、后查、再答（Intake）**
- CoCounsel 的引导式工作流按步骤收集材料；Deep Research 先给计划让用户确认。
- 建议：缺少关键事实时，先问 3–6 个关键问题，不要直接作答。例如劳动争议必问：入职时间、合同是否签订、月工资构成、工作地点（决定地方规定和赔偿基数上限）、解除理由及证据、是否已有仲裁。复杂问题先展示“检索计划”。

**3. 多步检索 + 权威层级**
- CoCounsel 让智能体调用自有检索工具迭代检索；北大法宝做法条↔案例↔文献关联。
- 建议：检索顺序固定为 **法律 → 司法解释 → 行政法规/部门规章 → 地方性法规（按用户所在地） → 指导性案例/参考案例 → 实务指引**；每条依据都要检查**时效性（现行有效/已修订/已废止）和施行日期**，按“行为发生时”的法律判断（新旧法衔接）。

**4. 合同审查：清单 + 立场 + 分级 + 多轮**
- Ironclad：playbook 解析 → 条款切分分类 → 逐条对照首选/后备立场 → 生成带理由的红线；用金标准集验证。
- Harvey：可接受 / 需复核 / 不可接受三分类，再写入修订。
- 幂律：审查点库 + 高中低风险。Spellbook：先做“整份文档体检”，查缺失条款。
- 建议的流水线：①识别合同类型、我方身份（甲/乙、谁的模板）、交易背景、谈判地位；②**缺失条款检查**（按合同类型的必备条款清单）；③逐条审查（合法性/效力 → 权利义务平衡 → 可执行性 → 商业风险）；④风险分级（高/中/低，或“不可接受/需谈判/可接受”）；⑤出修改建议：首选文本 + 后备文本 + 给对方的谈判理由；⑥**引用核验**：每条法律依据回库核对原文。Vals 显示红线是 AI 最弱的一环，所以建议对高风险条款单独做第二轮复核（换一个模型或换一种 prompt 做“对抗式复核”，借鉴 Luminance 的多模型共识）。

**5. 防幻觉**
- 段落级引用（Harvey）；智能体之间传原文、不传摘要（Harvey）；独立的引用核验工具（元典 hall-detect、TR 幻觉检查器、Lexis Shepard's）；还要防 Stanford 提出的“错误挂靠”。
- 建议：生成后做一次核验：抽取答案里所有“《X法》第N条”和案例编号 → 回本地库取原文 → 判断条文存在、现行有效、内容确实支持该论断 → 不通过的删掉或改写，并提示用户。本地库查不到的依据，**不允许出现在答案里**。

**6. 输出呈现**
- CoCounsel 报告：正反论点、类似胜败案例、待研究的问题。得理类案报告：裁判观点、争议点、法条。iCourt 意见书：时间轴、可行性、风险评估。
- 建议的统一结构：**结论先行（一句话答复 + 风险等级） → 事实与假设（明确列出“基于您提供的…假设…”） → 法律依据（可点击原文） → 分析 → 行动建议/操作步骤（含期限） → 需补充的材料 → 不确定性与需要律师介入的情形**。

**7. 人在回路**
- 每家都强调“可复核的初稿”。建议在高风险结论（解除劳动合同、对外发函、起诉）前提示“建议律师复核”，并给出可编辑的文书草稿。

**8. 模型分工（基于本 App 可用模型的建议，未经实测）**
- 路由/intake 用较快的模型；深度分析和合同多轮审查用最强的推理模型（如 claude-opus-5-5 或 gpt-6 系列中最强的一档）；交叉复核用另一家族的模型（如 deepseek-v4-pro 或 claude-sonnet-5），实现“异构复核”。可以用 LawBench/LexEval 子集加自建的 50–100 道真实咨询题做回归评测，再决定最终分工。

---

## Part B：任务分类（中国大陆在岗法务/律师助理视角）

标 ★ 的是对**企业主和 HR**最常见、最有价值的 8 类。

### B1. 总表

| # | 任务族 | 典型子任务 | 必须先收集的信息 | 专业推理步骤 | 专业产出 |
|---|---|---|---|---|---|
| 1 ★ | **合法性/合规性判断**（“这样做合法吗”） | 某项管理措施、营销方式、收费、用工安排、数据处理是否合法 | 行为的具体内容、主体性质（公司/个体/外资）、行业、地域、时间、是否已实施、已造成的后果 | 识别涉及的法律关系 → 找效力最高的规范 → 查有无地方规定或行业特别规定 → 查禁止性/强制性规定 → 后果分析（民事、行政、刑事三层） → 给合规替代方案 | 合规意见：是/否/有条件合法 + 依据 + 风险等级 + 整改方案 |
| 2 ★ | **劳动用工**（HR 第一高频） | 解除/辞退评估、经济补偿与赔偿金计算、试用期、加班费、竞业限制、规章制度效力、社保、劳务派遣、外包、灵活用工、工伤、女职工三期、调岗降薪、员工违纪处理 | 入职日期、劳动合同签订情况、工资构成及前 12 个月平均工资、工作地（地方标准和三倍封顶）、解除理由与证据、规章制度是否经民主程序并公示、是否处于三期/医疗期、是否已有仲裁 | 定性解除类型（协商/过失性/无过失性/经济性裁员） → 核对程序要件（通知工会、书面通知、送达） → 计算 N、N+1、2N → 评估违法解除风险 → 地方裁审口径 | 解除风险评估表 + 金额测算 + 操作步骤与文书（解除通知、协商协议） |
| 3 ★ | **合同审查** | 采购、销售、服务、租赁、借款、投资、合作、保密、劳动合同、平台用户协议 | 合同文本、我方身份、交易背景和商业目的、谈判地位、关注重点、是否已签 | 合同类型识别 → 主体资格与效力 → 必备条款缺失检查 → 逐条审查（权利义务、价款支付、交付验收、违约责任、解除、争议解决、知识产权、保密、不可抗力） → 风险分级 → 修改文本 | 审查意见表（条款/问题/风险等级/修改建议/依据）+ 修订版合同 + 谈判要点 |
| 4 | **文书起草** | 合同、律师函/催款函、通知（解除、催告、异议）、规章制度、授权书、股东会决议、承诺书 | 文书目的、双方信息、事实经过、诉求、期限、语气（强硬/和缓） | 选文书类型 → 确定法律依据和请求权基础 → 事实陈述 → 要求与期限 → 送达方式建议 | 可直接使用的文书草稿 + 送达与留痕建议 |
| 5 ★ | **被诉/被索赔应对** | 收到起诉状、仲裁申请、律师函、行政处罚告知书、消费者投诉、员工索赔 | 对方文书原文、合同与往来证据、时间线、对方主张金额、已收到的期限（答辩期、举证期、听证申请期） | 先定期限 → 审对方请求权基础 → 抗辩（时效、主体、管辖、事实、金额） → 证据盘点 → 和解与诉讼的成本收益 → 是否反诉 | 应对备忘录（期限清单、抗辩要点、证据清单、和解区间）+ 答辩状/回函草稿 |
| 6 ★ | **起诉/追款可行性预判** | 欠款、违约、侵权、劳动仲裁 | 债权凭证（合同、对账单、发票、聊天记录）、金额、对方主体与履约能力、发生时间、此前催收记录 | 请求权基础 → 诉讼时效（3 年、中断事由） → 证据链完整性 → 管辖 → 对方偿债能力（执行信息、失信） → 成本（诉讼费、保全担保） → 路径选择（支付令、诉讼、仲裁、小额诉讼） | 可行性评估（胜诉可能、可回收性、成本、时间）+ 证据补强清单 + 催告函 |
| 7 ★ | **期限与时效计算** | 诉讼时效、仲裁时效（劳动 1 年）、上诉期（15/10 日）、答辩期、举证期、除斥期间、行政复议 60 日/诉讼 6 个月、医疗期、试用期、工伤认定申请期 | 事件类型、起算事件及日期、有无中断/中止事由、送达日期 | 定适用规则 → 定起算点（知道或应当知道） → 计算（节假日顺延规则） → 提示风险 | 期限表 + 到期日 + 提醒 |
| 8 ★ | **主体调查/尽调** | 交易对手核查、供应商准入、投资尽调 | 公司名称或统一社会信用代码、交易金额与类型 | 工商登记（存续、注册资本实缴、股东、经营范围） → 经营异常/严重违法 → 失信/被执行/限高 → 涉诉 → 行政处罚 → 资质许可 → 知识产权 | 主体风险报告（红/黄/绿）+ 建议（担保、预付比例、审批） |
| 9 ★ | **公司治理/股权** | 设立、章程、出资（新《公司法》5 年认缴实缴）、股权转让、股东会/董事会决议、法定代表人变更、减资、注销、股权代持、对赌 | 公司类型、章程、股权结构、拟议事项 | 公司法和章程中的表决要求 → 程序合规 → 债权人保护 → 工商变更要件 | 决议/协议草稿 + 程序清单 + 风险提示 |
| 10 | **方案/商业模式合规审查** | 营销活动（抽奖、返利、广告用语）、会员预付卡、分销、平台规则、跨境业务 | 方案全文、业务流程、资金流、目标用户、地域 | 逐环节识别监管规则（广告法、反不正当竞争法、电子商务法、消费者权益保护法、价格、预付卡、传销认定） → 红线与灰区 → 改造方案 | 合规审查意见 + 修改后的方案 |
| 11 | **数据与网络合规** | 个人信息处理、隐私政策、数据出境、等保、App 合规、算法/生成式 AI 备案、ICP | 业务、处理的数据类型与规模、是否出境、系统类型 | 《个人信息保护法》《数据安全法》《网络安全法》及配套规定 → 判断义务触发（规模门槛、敏感个人信息） → 差距分析 | 合规差距清单 + 隐私政策/告知同意文本 + 备案路线图 |
| 12 | **知识产权查询与保护** | 商标查询与注册风险、商标/版权侵权判断、专利 FTO 初筛、软件著作权、商业秘密保护、侵权投诉 | 标识/作品/技术、使用的商品或服务类别、使用时间、地域 | 检索在先权利 → 近似性与类别判断 → 侵权构成 → 抗辩 → 维权路径（投诉、函告、诉讼） | 查询结论 + 风险等级 + 注册/维权方案 |
| 13 | **行政监管应对** | 行政检查、处罚告知、听证、复议、诉讼、信用修复 | 执法文书、违法事实、证据、期限 | 程序合法性 → 事实与法律适用 → 裁量基准（首违不罚、从轻减轻） → 陈述申辩/听证 → 复议/诉讼 | 陈述申辩书 + 期限 + 信用修复路径 |
| 14 | **消费者纠纷/产品责任** | 退货、三倍/十倍赔偿、职业打假应对、广告投诉 | 商品、宣传内容、交易记录、投诉内容 | 欺诈认定、食品安全标准、惩罚性赔偿适用 | 应对方案 + 回复函 |
| 15 | **债权管理与担保** | 担保合同、抵押质押、保证期间、应收账款、对账函 | 债权、担保类型、期间 | 《民法典》担保制度及其司法解释：保证方式、保证期间 6 个月、登记对抗 | 担保方案 + 时效/保证期间管理表 |
| 16 | **税务与发票相关法律问题** | 虚开风险、个税、劳务报酬与工资区分 | 业务实质、合同、资金流 | 税收征管法与刑法虚开罪的界限 | 风险提示（通常建议转税务专业人士） |
| 17 | **刑事风险筛查**（企业和高管） | 职务侵占、非法吸收公众存款、虚开、商业贿赂、侵犯公民个人信息、拒不支付劳动报酬 | 行为事实 | 构成要件与立案追诉标准 | 风险提示 + 立即止损建议 + 转律师 |
| 18 | **法规检索与解读/法规变动监测** | “最新规定是什么”、新法对我的影响 | 主题、行业、地域 | 检索 → 时效核对 → 新旧对比 → 影响分析 | 规定摘要 + 原文 + 影响和应对清单 |
| 19 | **类案检索与裁判倾向** | 同类案件怎么判 | 争议焦点、地域、法院层级 | 指导性案例/参考案例 → 本地裁判口径 → 裁判观点归纳 | 类案报告（观点、争议点、法条） |
| 20 | **婚姻家事/继承（老板个人）** | 股权与婚姻财产、遗嘱、继承 | 财产情况 | — | 方案建议（多转律师） |
| 21 | **房产/租赁** | 办公场地租赁、装修、转租、提前退租 | 租赁合同 | — | 审查意见 + 函件 |
| 22 | **投融资/对外投资**（外资准入、ODI 备案等） | — | — | 负面清单、备案路径 | 路径图 |

### B2. 8 类高频任务的推理模板（可直接写成 skill）

**① 劳动解除评估（HR）**
- Intake：员工入职日 / 合同期限 / 月平均工资（应发，含奖金）/ 工作城市 / 解除理由 / 证据（考勤、违纪记录、签收） / 规章制度是否民主程序 + 公示 / 员工是否处于三期、医疗期、工伤、临近退休 / 是否已发通知。
- 推理：解除类型 → 法定事由是否成立（《劳动合同法》第 39/40/41 条） → 程序（第 43 条通知工会） → 禁止解除情形（第 42 条） → 金额（第 47 条，N；第 87 条，2N；三倍社平工资封顶、12 年封顶） → 地方口径。
- 产出：结论（合法/有风险/违法）+ 金额测算表 + 推荐路径（协商优先）+ 文书草稿。

**② 合同审查**：见 A4 第 4 点的流水线；产出“审查意见表 + 修订文本 + 谈判要点”。

**③ 合法性判断**：民事效力（是否违反强制性规定、公序良俗）、行政责任（处罚幅度）、刑事红线三层；给“怎样改才合法”。

**④ 被诉应对**：第一屏先给 **期限**（答辩期 15 日、举证期限、管辖异议在答辩期内提出），再给抗辩与证据。

**⑤ 追款/起诉可行性**：时效 → 证据 → 对方偿付能力（引导用户查执行信息公开网） → 成本 → 路径；产出催款函。

**⑥ 期限计算**：结构化计算器 + AI 解释；必须注明起算点假设。

**⑦ 主体调查**：生成核查清单 + 打开官方页面（见 C 部分），用户把结果贴回来，由 AI 出风险报告。

**⑧ 公司治理/股权**：新《公司法》（2024-07-01 施行）的出资期限、股东失权、法定代表人、董监高责任是高频点。

### B3. 通用 intake 要素（所有任务）
身份（企业/个人/HR）、所在地（决定地方性法规和裁判口径）、行业、时间点（适用新法还是旧法）、目标（预防/应对/索赔）、紧急程度与期限、已有文件。

---

## Part C：官方公开查询的自动化可行性

探测方法：用 curl 抓 robots.txt 和首页（UA 为普通浏览器），只记录看到的情况，**没有尝试绕过任何验证**。探测 IP 位于中国大陆以外。

| 系统 | 可查询内容 | robots.txt / 访问情况（本次实测） | 验证码/登录 | 现实方案 |
|---|---|---|---|---|
| **国家企业信用信息公示系统** gsxt.gov.cn | 登记信息、股东及出资、变更、年报、经营异常名录、严重违法失信、行政处罚、抽查检查、股权出质、动产抵押 | robots.txt 和首页都返回 **HTTP 521 + JS 计算 cookie 的挑战页（`__jsl_clearance`，加速乐类反爬）**，拿不到 robots 文本 | 检索时有滑块/点选验证（公开使用经验） | **打开官方页面让用户查**；不要后台抓取。备选：购买合规商业数据接口（企查查、天眼查等开放平台，属于第三方付费服务） |
| **信用中国** creditchina.gov.cn | 统一社会信用代码查询、行政许可与处罚、失信惩戒对象名单、重点关注名单、信用承诺 | robots.txt 可读（200）：`User-agent:*`，只禁止两个备份目录，**robots 层面并不禁止**；但首页和栏目页返回 **HTTP 412**（瑞数类动态反爬，需执行 JS） | 查询有验证码 | robots 不禁止，但技术上有反爬，**打开官方页面**；可以关注其面向机构的数据共享/信用服务接口（需申请） |
| **中国商标网** sbj.cnipa.gov.cn | 商标局门户、商标公告入口、业务指南 | robots.txt 路径返回门户 HTML（无 robots 规则）；首页 200，可读 | 门户无验证；网上申请需 CNIPA 统一身份认证（sso.cnipa.gov.cn） | 静态内容（公告目录、指南）可以**直接读取** |
| **商标网上检索** wcjs.sbj.cnipa.gov.cn | 商标近似检索、综合查询、状态查询 | robots 路径返回 SPA 页面（无规则）；首页对 curl 返回 **HTTP 406**（拒绝非浏览器请求），是 Vue 单页应用 | 需在浏览器内运行，检索时有使用条款/验证环节 | **打开官方页面**；AI 侧帮用户确定类别（尼斯分类）、近似检索词 |
| **国家知识产权局商标公告** | 初审公告、注册公告、转让、续展、无效等 | 商标网首页链接到“商标公告查询”（pub.sbj.cnipa.gov.cn 等），公告期刊可分期查看 | 查询页可能有验证 | 期刊目录可直接读取；按商标号精确查**打开官方页面** |
| **专利检索及分析系统** pss-system.cponline.cnipa.gov.cn（旧址 pss-system.cnipa.gov.cn） | 中外专利检索、法律状态、引证 | 旧域名连接失败（HTTP 000）；新域名返回 **HTTP 412** 反爬 | **需注册登录**才能检索（公开使用经验） | **打开官方页面**；或使用 CNIPA 数据服务、Google Patents 等公开替代 |
| **ICP/IP地址/域名信息备案管理系统** beian.miit.gov.cn | 按域名/主体/备案号查 ICP 备案 | robots 和首页都是 **HTTP 521 JS 挑战** | 查询有滑块验证码 | **打开官方页面**；可选：查电信业务经营许可证另走 dxzhgl.miit.gov.cn（未实测） |
| **全国组织机构统一社会信用代码数据服务中心** cods.org.cn | 统一社会信用代码核验、机构基本信息 | robots.txt 不存在（404 页面）；首页 200 可读，页面包含 WAF 脚本标记和“登录”入口 | 查询需登录/验证（页面有登录入口，具体规则未实测） | **打开官方页面**；本地可离线校验 18 位统一社会信用代码的**校验位**（GB 32100-2015 算法，无需联网） |
| **中国执行信息公开网** zxgk.court.gov.cn | 被执行人、失信被执行人、限制消费、终本案件、财产处置 | robots 和首页返回 **403，原因 “GeoBL”**（境外 IP 被地域封禁）；大陆网络下可访问 | 每次查询需图形验证码（公开使用经验） | **打开官方页面**；不要自动化 |
| **人民法院公告网** rmfygg.court.gov.cn | 送达公告、开庭公告、破产公告、宣告失踪等；可按当事人查 | robots.txt 被腾讯云 WAF 拦截（403）；**首页 200 可读**，有“公告查询”和“当事人”检索 | 检索页可能有验证（未实测） | 首页公告列表可以读；按当事人查**打开官方页面**；提醒用户“公告送达可能已经开始计算期限” |
| **中国裁判文书网** wenshu.court.gov.cn（补充） | 裁判文书 | robots.txt 可读：对百度、谷歌等是 `Disallow: /?` `Allow: /`，**明确禁止若干比价爬虫**；没有对 `*` 的通用规则 | **需登录**（手机号注册） | 不自动抓取；本地库可收录已公开的指导性案例、人民法院案例库参考案例（rmfyalk.court.gov.cn，需登录，未实测） |
| **网络安全等级保护网** djbh.net | 等保政策、测评机构名录、标准 | robots 404；首页 200 可读 | 无 | 政策和测评机构信息可直接读取；**单个系统的等保备案证明不公开查询**，需向企业索要备案证明和测评报告 |
| **全国互联网安全管理服务平台（公安联网备案）** beian.gov.cn | 网站公安备案号查询 | 本次连接失败（HTTP 000，可能是地域或网络原因） | 查询有验证码（公开使用经验） | 打开官方页面 |
| **国家网信办** cac.gov.cn | **算法备案清单、生成式 AI 服务备案/登记名单**（以公告形式分批发布）、数据出境相关公告 | robots.txt 可读：`User-agent: *` 只禁止 `/zfz/` `/wxb_zfz/` `/wxzf/` 和视频页，**公告栏目允许抓取** | 无 | **可以直接读取**并入本地库（例如“某产品是否已完成大模型备案”） |
| **CCRC 中国网络安全审查认证和市场监管大数据中心** ccrc.org.cn / **ISCCC** | 网络安全产品认证、数据安全管理认证、App 安全认证、个人信息保护认证证书查询 | ccrc.org.cn 本次连接失败；isccc.gov.cn robots 404 | 证书查询页情况未实测 | 打开官方页面；或经市场监管总局“全国认证认可信息公共服务平台”查证书（cx.cnca.cn，未实测） |
| **国家市场监督管理总局** samr.gov.cn | 政策、处罚公示入口 | robots 404 | — | 政策可读 |

**“网络方面的验证”可能指什么**（需和业主确认）：
1. ICP 备案/ICP 经营许可证（工信部）——网站或 App 能否合法上线、收费；
2. 公安联网备案（beian.gov.cn）；
3. **网络安全等级保护备案与测评**（公安机关备案，不公开查询）；
4. **算法备案、生成式 AI 服务备案**（网信办公开名单，可直接查）；
5. App 合规与个人信息保护认证（CCRC）；
6. 数据出境安全评估/标准合同备案（不公开查询）。
建议在 App 里做成“网络合规体检”问卷，而不是去查数据库。

**C 部分总结**：可以自动读取的只有静态公告类页面（网信办备案名单、商标公告目录、法院公告网首页、等保网政策）。凡是需要按主体检索的（工商、失信、执行、商标、专利、ICP），都有 JS 反爬、验证码或登录，**建议做“预填查询要素 + 打开官方页面 + 用户回贴结果再分析”的半自动流程**。如果要做真正的自动查询，只能走合规的商业数据 API 或官方授权的数据接口。

---

## 附：主要来源
- Vals：https://www.vals.ai/industry-reports/vlair-2-27-25 ；https://www.lawnext.com/2025/10/vals-ais-latest-benchmark-finds-legal-and-general-ai-now-outperform-lawyers-in-legal-research-accuracy.html
- Stanford/Yale：https://arxiv.org/abs/2405.20362
- Harvey：https://www.harvey.ai/blog/introducing-biglaw-bench ；https://www.harvey.ai/blog/biglaw-bench-sources
- CoCounsel：https://www.lawnext.com/2025/08/thomson-reuters-launches-cocounsel-legal-with-agentic-ai-and-deep-research-capabilities-along-with-a-new-and-final-version-of-westlaw.html
- Lexis Protégé：https://www.lexisnexis.com/community/pressroom/b/news/posts/lexis-with-protege-accelerates-frictionless-agentic-productivity-from-first-idea-to-review-ready-legal-work-product
- Ironclad：https://ironcladapp.com/resources/articles/jurist-redlining-playbooks
- Spellbook：https://www.artificiallawyer.com/2024/07/10/spellbook-launches-contract-benchmarks-to-show-whats-market/
- Legora：https://legora.com/product
- Luminance：https://www.luminance.com/press/luminance-raises-75-million-in-series-c-funding-round/
- Kira：https://www.legaltechnologyhub.com/vendors/kira-by-litera
- 通义法睿：https://help.aliyun.com/document_detail/2778916.html
- 元典：https://www.skills.sh/site/skills.volces.com/yuandian-law-search
- 幂律：https://www.36kr.com/p/1716361195336452 ；https://cloud.tencent.com/developer/news/4261553
- iCourt：https://news.pedaily.cn/20230721/63653.shtml
- 北大法宝：https://m.tech.china.com/articles/20260923/202609231961699.html
- LexEval：https://arxiv.org/html/2409.20288v4 ；LawBench：https://github.com/open-compass/LawBench ；LegalBench：https://arxiv.org/abs/2308.11462

**局限**：Harvey 帮助中心需要登录；Robin AI 的 playbook 页面已 404；秘塔、法宝新AI 没有找到一手产品文档。C 部分的验证码和登录情况，凡标“公开使用经验”或“未实测”的，都没有在本次探测中直接观察到。
