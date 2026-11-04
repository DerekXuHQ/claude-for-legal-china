# 并购尽调：标准列

收购方审查目标公司合同时的默认模式。从这里起步，再按交易增删列。这是起点，不是检查清单——真正决定看什么的，是交易文件中的陈述与保证条款和尽调需求清单。

`id` 和 `options` 的取值保持英文 snake_case，供归一化、汇总和下游脚本使用；`label` 和 `prompt` 用中文。

法条、期限和程序要求均为 `[模型知识 — 需验证]`，用于设计提问，不能直接写进尽调报告结论。写入报告前，按 `references/official-law-sources.md` 核对现行文本。

```yaml
schema:
  name: "并购尽调 — 标准"
  columns:
    - id: counterparty
      label: "合同相对方"
      type: verbatim
      prompt: "除目标公司外的合同当事人名称，按合同原文照录。"

    - id: agreement_type
      label: "合同类型"
      type: classify
      options: [msa, purchase_order, license_in, license_out, lease, services, supply, distribution, nda, joint_venture, shareholder_agreement, loan, guaranty, employment, other]
      prompt: "这是什么类型的合同？"

    - id: effective_date
      label: "生效日期"
      type: date
      prompt: "合同何时生效？是否附生效条件，或须经批准、登记、备案才生效？"

    - id: term
      label: "合同期限"
      type: duration
      prompt: "初始期限多长？"

    - id: auto_renewal
      label: "自动续期"
      type: classify
      options: [none, annual, fixed_period, evergreen]
      prompt: "合同是否自动续期？按什么周期？"

    - id: termination_for_convenience
      label: "任意解除权"
      type: classify
      options: [none, either_party, target_only, counterparty_only]
      prompt: "是否有一方或双方可以无理由解除合同？是哪一方？"

    - id: termination_notice
      label: "解除通知期"
      type: duration
      prompt: "解除合同需要提前多久通知？"

    - id: change_of_control
      label: "控制权变更"
      type: classify
      options: [silent, consent_required, consent_not_unreasonably_withheld, automatic_termination, notice_only, counterparty_right_to_terminate]
      prompt: "合同是否约定目标公司控制权变更（股权转让、实际控制人变化、合并分立）的后果？什么情形触发，触发后怎样？"

    - id: assignment
      label: "转让限制"
      type: classify
      options: [silent, consent_required, consent_not_unreasonably_withheld, freely_assignable, assignable_to_affiliates, non_assignable]
      prompt: "目标公司能否转让本合同的权利义务？有哪些限制？（资产收购中，合同权利义务一并转让一般须经对方同意。）"

    - id: exclusivity
      label: "排他 / 竞业限制"
      type: classify
      options: [none, exclusive_supplier, exclusive_customer, non_compete, non_solicit, territory_restriction, most_favored_nation]
      prompt: "合同是否限制任何一方从事竞争业务，或与第三方订立同类合同？"

    - id: preemptive_rights
      label: "优先购买权 / 优先认购权"
      type: classify
      options: [none, right_of_first_refusal, right_of_first_offer, preemptive_subscription, tag_along, drag_along, multiple]
      prompt: "合同（尤其是合资合同、股东协议、投资协议）是否约定优先购买权、优先认购权、随售权、领售权等？本次交易是否会触发？"

    - id: related_party
      label: "关联交易"
      type: classify
      options: [no, yes_disclosed_approved, yes_not_approved, unclear]
      prompt: "相对方是否为目标公司的股东、实际控制人、董事、监事、高级管理人员或其关联方？是否有内部决议或披露记录？"

    - id: guarantee_security
      label: "担保 / 增信安排"
      type: classify
      options: [none, target_provides_guarantee, target_provides_collateral, counterparty_provides, third_party_provides, multiple]
      prompt: "合同中是否包含保证、抵押、质押等担保，或差额补足、回购承诺等增信安排？目标公司是担保人的，是否有股东会或董事会决议？"

    - id: liability_cap
      label: "责任上限"
      type: currency
      prompt: "是否约定责任上限？金额或计算倍数是多少？"

    - id: liquidated_damages
      label: "违约金 / 赔偿"
      type: classify
      options: [none, liquidated_damages, mutual_indemnity, target_indemnifies, counterparty_indemnifies, ip_only, third_party_claims_only]
      prompt: "违约金如何约定（固定金额、比例、按日计算）？谁向谁承担赔偿责任、就什么事项？"

    - id: governing_law
      label: "适用法律"
      type: verbatim
      prompt: "合同约定适用哪一法域的法律？"

    - id: dispute_resolution
      label: "争议解决"
      type: classify
      options: [litigation, arbitration_domestic, arbitration_foreign, mediation_first, silent]
      prompt: "争议怎么解决？约定诉讼的，管辖法院是哪家；约定仲裁的，仲裁机构是哪家、仲裁地在哪里？约定境外仲裁的，合同是否具有涉外因素？"

    - id: most_favored_nation
      label: "最惠待遇 / 价格保护"
      type: classify
      options: [none, mfn_pricing, price_matching, benchmarking_right]
      prompt: "是否有最惠待遇条款或其他价格保护条款？"

    - id: minimum_commitments
      label: "最低采购 / 数量承诺"
      type: currency
      prompt: "是否有最低采购量、最低数量或最低金额承诺？"

    - id: ip_ownership
      label: "知识产权归属"
      type: classify
      options: [each_owns_own, target_owns_work_product, counterparty_owns_work_product, joint, license_only, silent]
      prompt: "合同项下产生或使用的知识产权归谁？"

    - id: data_personal_info
      label: "数据与个人信息"
      type: classify
      options: [none, entrusted_processing, joint_processing, provision_to_third_party, cross_border_transfer, important_data, multiple]
      prompt: "合同是否涉及处理个人信息或重要数据？是委托处理、共同处理还是向第三方提供？是否涉及数据出境？对应的合规安排（个人信息保护影响评估、出境安全评估、标准合同备案或认证）有没有提到？"

    - id: confidentiality_term
      label: "保密义务存续期"
      type: duration
      prompt: "合同终止后，保密义务继续有效多久？"

    - id: approvals_filings
      label: "审批 / 登记 / 备案"
      type: classify
      options: [none, required_obtained, required_not_obtained, required_unclear]
      prompt: "合同本身或其履行是否需要政府审批、登记或备案（如技术进出口合同登记、房屋租赁备案、特定行业许可）？是否已办理？"

    - id: audit_rights
      label: "审计 / 检查权"
      type: classify
      options: [none, counterparty_may_audit_target, target_may_audit_counterparty, mutual]
      prompt: "任何一方是否享有审计或检查权？"

    - id: notices
      label: "通知条款"
      type: verbatim
      prompt: "目标公司的通知地址和送达方式是什么？"
```

## 按文件类型增加的列

上面的列针对一般商业合同。审查公司层面文件时，另建一张表，或在同一张表里增加以下列：

- **公司章程、股东协议、增资协议、出资证明：**
  - 各股东认缴出资额、实缴出资额、认缴出资期限。新《公司法》（2024 年 7 月 1 日施行）规定有限责任公司股东认缴出资额应自公司成立之日起五年内缴足；此前设立、出资期限超过五年的公司有过渡期调整要求 `[模型知识 — 需验证]`，以《公司法》第四十七条及国务院关于注册资本登记管理的配套规定现行文本为准。
  - 出资方式（货币、非货币财产）及评估作价、权属转移情况；是否存在出资不实、抽逃出资迹象。
  - 加速到期风险：公司不能清偿到期债务时，公司或已到期债权人可以要求未届出资期限的股东提前缴纳 `[模型知识 — 需验证]`。收购未届出资期限的股权时，受让人承担缴纳义务、转让人承担补充责任的规则也要一并考虑 `[模型知识 — 需验证]`。
  - 股权转让限制、优先购买权的行使程序和期限，章程是否另有约定。
  - 特殊股东权利（一票否决、回购、反稀释、优先清算）。
- **担保合同及对外担保台账：** 担保对象、金额、期限、担保方式；是否按章程履行内部决议程序；对股东或实际控制人提供担保的，是否经股东会决议且关联股东回避表决 `[模型知识 — 需验证]`。
- **资质证照：** 证照名称、编号、发证机关、有效期、许可范围；本次交易（股权变更、主体变更）是否需要事先审批、变更登记或重新申领。
- **劳动用工文件：** 劳动合同签订率、社会保险和住房公积金缴纳情况、劳务派遣比例、竞业限制协议及补偿金、员工持股计划或股权激励安排。
- **税务文件：** 主要税种及税率、税收优惠的依据和期限、欠税或处罚记录。
- **诉讼仲裁与执行：** 案号、案由、标的额、程序阶段、目标公司地位；对照中国裁判文书网、中国执行信息公开网（被执行人、失信被执行人、限制消费）以及国家企业信用信息公示系统核查。

## 交易层面的事项（不宜放进合同网格）

以下事项取决于整个交易和各方情况，不是逐份合同能答出来的。在尽调问题清单或备忘录中单独处理，可配合 `/corporate-legal:due-diligence-checklist`、`/corporate-legal:diligence-issue-extraction` 和 `/corporate-legal:diligence-evidence-matrix`：

- **经营者集中申报：** 是否构成控制权取得、是否达到申报标准。申报标准由国务院规定并会调整，营业额门槛不要写死；需要时按国务院现行《关于经营者集中申报标准的规定》核对，并标 〔待核〕。未达标准但可能具有排除、限制竞争效果的，市场监管总局仍可要求申报 `[模型知识 — 需验证]`。
- **外商投资准入：** 收购方为外国投资者的，对照现行《外商投资准入特别管理措施（负面清单）》（及自贸试验区版本）判断是否属于禁止或限制领域、是否有持股比例要求；是否触发外商投资安全审查。负面清单每年可能修订，以发布机关最新版本为准 〔待核〕。
- **国有资产转让程序：** 卖方或目标公司为国有企业、国有控股或实际控制企业的，审查资产评估及备案或核准、产权交易机构公开挂牌、履行出资人审批等程序 `[模型知识 — 需验证]`。
- **数据与网络安全审查：** 目标公司为关键信息基础设施运营者、或处理大量个人信息的，交易是否涉及网络安全审查或数据出境安排的变化。
- **上市公司：** 目标公司或交易一方为上市公司的，交易是否触发证监会和交易所的信息披露、重大资产重组、权益变动报告或要约收购义务，以及停复牌和内幕信息知情人登记要求。具体比例和期限以证监会及相关交易所现行规则为准 〔待核〕。

## 按交易类型常见的补充列

- **科技 / 知识产权密集型目标公司：** 源代码托管、开源许可限制、数据权利、模型训练数据来源及授权、API 接入、算法备案
- **医药 / 医疗器械：** 药品或医疗器械注册证、生产 / 经营许可证、GMP / GSP 符合性、临床试验协议及伦理审查、MAH（上市许可持有人）安排
- **政府采购 / 国有企业客户：** 合同主体变更是否需要采购人同意、分包和转包限制、保密资质或涉密要求、投标时的资格承诺
- **不动产：** 产权证书、土地性质和用途、租赁备案、续租选择权、租金调整、抵押和查封情况、转租限制
- **金融类受监管主体：** 金融监管总局、证监会或人民银行的持牌要求，股东资格审查，变更股东或实际控制人的事先审批要求

## 时间紧时的快速首轮

时间紧、只做首轮筛查的，以下 6 列能回答交易初期大部分问题：counterparty、effective_date、term、change_of_control、assignment、termination_for_convenience。先跑这几列，等交易团队排好优先级再扩展模式。
