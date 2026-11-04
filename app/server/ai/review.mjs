// 合同审查 / 方案合规审查：多轮流程。
// ① 画像与缺失条款 → ② 分段逐条审查（可检索资料库，并行）→ ③ 另一家族模型对抗式复核 → ④ 依据核对 → ⑤ 汇总成审查意见。
import { completeJSON, stream, parseJSON } from "./models.mjs";
import { runAgent, SYSTEM_PROMPT } from "./agent.mjs";
import { getTask, contractChecklists } from "./tasks.mjs";
import { splitClauses } from "./docs.mjs";
import { getArticle } from "../search.mjs";

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + "……" : s || "");
const RISK_ORDER = { 高: 0, 中: 1, 低: 2 };

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const ISSUE_FORMAT = `每个问题一个对象：
{"ref": "条款编号或位置，例如「第8条」「付款条款」", "quote": "原文中有问题的句子（照抄，60字以内）", "category": "合法性与效力 / 权利义务失衡 / 可执行性 / 商业风险 / 表述歧义 / 缺失约定 / 关系与实操", "risk": "高 / 中 / 低", "issue": "问题是什么，对我方有什么后果（具体）", "suggest": "首选修改：可以直接替换进合同的条款文字", "fallback": "后备方案：对方不接受首选时可以退让到的文字（没有就空）", "negotiate": "跟对方谈时可以怎么说（一句话）", "basis": [{"law": "法规全称", "article": "第X条", "id": "检索工具返回的条文编号，没有就空"}]}`;

/**
 * @param {object} p
 * @param {"contract_review"|"plan_review"} p.kind
 */
export async function runReview(settings, { kind, doc, question, region, facts, mainModel, reviewModel, emit, signal, db, verify }) {
  const isPlan = kind === "plan_review";
  const unit = isPlan ? "环节" : "条款";
  const task = getTask(kind);
  const checklists = isPlan ? "" : contractChecklists();
  const ctx = [
    `## 用户的要求\n${question}`,
    region ? `## 地区\n${region}` : "",
    facts ? `## 用户补充的情况\n${facts}` : "",
  ].filter(Boolean).join("\n\n");

  // ① 画像
  emit({ type: "stage", text: isPlan ? "梳理方案的业务环节" : "识别合同类型、双方和我方身份" });
  const profile = await completeJSON(settings, {
    model: mainModel, effort: "low", signal,
    system: `你是资深${isPlan ? "合规律师" : "合同审查律师"}。先给这份${isPlan ? "方案" : "合同"}做画像。只输出 JSON。
${isPlan ? "" : `\n参考：各类合同的必备条款清单\n${clip(checklists, 12000)}\n`}
输出：
{"type": "${isPlan ? "方案类型（如抽奖营销、预付卡会员、分销返利）" : "合同类型"}", "parties": "${isPlan ? "涉及的主体（经营者、用户、合作方）" : "甲方、乙方是谁"}", "our_side": "我方是哪一方（按用户的话判断，判断不了写「未知」）", "background": "交易或业务背景一句话", "key_terms": ["关键${isPlan ? "规则" : "商业条款"}，如金额、期限、付款、交付"], "governing": "适用法律与争议解决方式", "missing": [${isPlan ? "\"方案没写清、但监管上必须明确的事项\"" : "\"按该类型必备条款清单，合同里缺失或明显不完整的条款\""}], "focus": ["这份文件最值得重点审查的方面"]}`,
    user: `${ctx}\n\n## 文件全文\n${clip(doc, 60000)}`,
  });
  emit({ type: "stage", text: `${profile.type || ""}${profile.our_side && profile.our_side !== "未知" ? " · 我方：" + profile.our_side : ""}` });

  // ①b 依据清单：先把审查要用的现行条文查出来，各段共用（并行审查时不再各自检索，快，也统一）
  emit({ type: "stage", text: "查审查要用的法条" });
  let pack = [];
  try {
    const { text } = await runAgent(settings, {
      model: mainModel, effort: "low", steps: 8, stream: false, signal, label: "依据",
      emit: (ev) => ev.type === "step" && emit(ev),
      system: `${SYSTEM_PROMPT}\n\n## 你现在做的事\n为审查下面这份${isPlan ? "方案" : "合同"}准备一份法律依据清单：找出审查中会用到的现行条文，读原文确认。${isPlan ? "例如：广告、有奖销售、价格、预付式消费、个人信息、消费者权益、反不正当竞争、电子商务等。" : "通常包括：格式条款的提示说明义务与无效情形、免责条款无效（人身损害、故意或重大过失）、违约金调整与定金、合同解除与终止后的结算、管辖与仲裁、以及与这类合同相关的特别规定（例如个人信息委托处理、租赁、建设工程、买卖的检验期、技术合同等）。"}只用检索工具返回的编号。只输出 JSON：{"provisions":[{"id":"条文编号","point":"这条用来审查什么（十五字以内）"}]}，15 到 30 条。`,
      messages: [{ role: "user", content: `${ctx}\n\n## 文件画像\n${JSON.stringify(profile)}\n\n## 文件内容（节选）\n${clip(doc, 20000)}` }],
    });
    const seen = new Set();
    for (const x of parseJSON(text).provisions || []) {
      const a = x && typeof x.id === "string" && !seen.has(x.id) ? getArticle(x.id) : null;
      if (a) { seen.add(x.id); pack.push({ id: a.id, title: a.title, article: a.article, point: String(x.point || ""), text: a.text.slice(0, 500) }); }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    emit({ type: "stage", text: `查法条出错，继续审查：${String(err.message || err).slice(0, 80)}` });
  }
  const packIds = new Set(pack.map((x) => x.id));
  const packText = pack.length ? pack.map((x) => `[${x.id}] 《${x.title}》${x.article}（${x.point}）：${x.text}`).join("\n") : "（没有查到依据条文；依据只写你确定的法规名称和条号）";
  emit({ type: "stage", text: `找到 ${pack.length} 条审查依据` });

  // ② 分段逐条审查（并行，不再调用工具）
  const chunks = splitClauses(doc);
  emit({ type: "stage", text: `逐${unit}审查（共 ${chunks.length} 段，并行）` });
  const reviewSystem = `${SYSTEM_PROMPT}

## 本次任务：${task.name}
${task.body}

## 这份文件的画像
${JSON.stringify(profile, null, 1)}

## 审查依据（已查实的现行条文，引用时 id 原样照抄）
${packText}

## 你现在做的事
你在逐段审查这份${isPlan ? "方案" : "合同"}的其中一段。按顺序检查每${unit === "条款" ? "条" : "个环节"}：合法性与效力 → 权利义务是否平衡（站在我方立场）→ 能否执行（约定是否明确、可证明、可操作）→ 商业风险 → 表述歧义；也要考虑双方关系和实际执行中的人情、沟通成本。
${isPlan ? "" : `逐条对照这些常见陷阱：单方变更价格或服务内容；「不属于格式条款」之类声明（对方模板仍可能是格式条款，要看提示说明义务）；免除对方故意或重大过失责任、人身损害责任的约定（无效）；把对方的责任转嫁给我方；责任上限过低或只约束我方；违约金与定金叠加或过高；预付、验收和付款节点；自动续约与提前终止费用；数据、个人信息与保密；知识产权归属；管辖与仲裁约定是否明确有效。`}
依据优先从上面的清单里选，写清 id；清单里没有的，只写你有把握的法规全称和条号。没问题的${unit}不要写。只输出 JSON：{"issues": [ ... ]}
${ISSUE_FORMAT}`;
  const perChunk = await pool(chunks, 5, async (chunk, i) => {
    try {
      const j = await completeJSON(settings, {
        model: mainModel, effort: "medium", signal, system: reviewSystem,
        user: `${ctx}\n\n## 本段内容（第 ${i + 1}/${chunks.length} 段）\n${chunk}`,
      });
      emit({ type: "step", text: `第 ${i + 1}/${chunks.length} 段：发现 ${(j.issues || []).length} 个问题` });
      return Array.isArray(j.issues) ? j.issues : [];
    } catch (err) {
      if (signal?.aborted) throw err;
      emit({ type: "stage", text: `第 ${i + 1} 段审查出错，已跳过：${String(err.message || err).slice(0, 80)}` });
      return [];
    }
  });
  let issues = perChunk.flat().filter((x) => x && x.issue);
  for (const m of profile.missing || []) issues.push({ ref: "缺失", quote: "", category: "缺失约定", risk: "中", issue: m, suggest: "", fallback: "", negotiate: "", basis: [] });

  // ③ 对抗式复核（另一家族模型）
  emit({ type: "stage", text: `复核：${reviewModel} 逐条挑错，并通读全文找遗漏` });
  let review = { verdicts: [], missed: [] };
  try {
    review = await completeJSON(settings, {
      model: reviewModel, effort: "medium", signal,
      system: `你是一位严格的资深律师，负责复核同事写的${isPlan ? "方案合规审查" : "合同审查"}意见。站在我方（${profile.our_side || "未知"}）立场，逐条判断：
- 问题是否真的成立（有没有误读原文、夸大风险、套错法条）；
- 风险等级是否合适；
- 修改文字是否可以直接用、是否改过头（把正常商业安排改成对方不可能接受的）；
然后通读全文，找出同事**漏掉**的重要问题。只依据中国大陆现行法律；依据优先用下面清单里的条文（写 id），拿不准的不要写条号。\n\n审查依据清单：\n${packText}\n\n只输出 JSON：
{"verdicts": [{"n": 问题序号, "keep": true/false, "risk": "高/中/低", "note": "你的修正意见（可空）", "suggest": "更好的修改文字（可空）"}], "missed": [ ${ISSUE_FORMAT.replace("每个问题一个对象：\n", "")} ]}`,
      user: `${ctx}\n\n## 文件画像\n${JSON.stringify(profile)}\n\n## 同事的审查意见（按序号）\n${issues.map((x, n) => `${n}. [${x.risk}] ${x.ref}｜${x.quote}｜${x.issue}｜修改：${x.suggest}`).join("\n")}\n\n## 文件全文\n${clip(doc, 60000)}`,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    emit({ type: "stage", text: `复核出错，按初审意见继续：${String(err.message || err).slice(0, 80)}` });
  }
  const byN = new Map((review.verdicts || []).map((v) => [Number(v.n), v]));
  issues = issues.map((x, n) => {
    const v = byN.get(n);
    if (!v) return x;
    return { ...x, keep: v.keep !== false, risk: v.risk || x.risk, reviewNote: v.note || "", suggest: v.suggest || x.suggest };
  }).filter((x) => x.keep !== false);
  for (const m of review.missed || []) if (m && m.issue) issues.push({ ...m, reviewNote: "复核时补充" });
  const dropped = (review.verdicts || []).filter((v) => v.keep === false).length;
  issues.sort((a, b) => (RISK_ORDER[a.risk] ?? 3) - (RISK_ORDER[b.risk] ?? 3));

  // ④ 依据核对
  let badBasis = 0;
  for (const x of issues) {
    x.basis = (Array.isArray(x.basis) ? x.basis : []).filter((b) => {
      if (b && typeof b.id === "string" && packIds.has(b.id)) {
        const a = pack.find((x) => x.id === b.id);
        Object.assign(b, { law: a.title, article: a.article, link: a.id });
        return true;
      }
      if (!b || !b.law) return false;
      const ref = `《${String(b.law).replace(/[《》]/g, "")}》${b.article || ""}`;
      const v = verify(db, ref);
      if (v.linked) { b.link = v.text.match(/\[\[art:([^\]]+)\]\]/)?.[1] || ""; return true; }
      badBasis++;
      return false;
    });
  }
  emit({ type: "stage", text: `复核去掉 ${dropped} 条、补充 ${(review.missed || []).length} 条；依据核对去掉 ${badBasis} 处资料库对不上的引用` });

  // ⑤ 汇总
  emit({ type: "stage", text: "写审查意见" });
  emit({ type: "text_reset" });
  const table = issues.map((x, n) => `${n + 1}. [${x.risk}] ${x.ref}｜原文：${x.quote || "—"}｜问题：${x.issue}｜首选修改：${x.suggest || "—"}｜后备：${x.fallback || "—"}｜谈判：${x.negotiate || "—"}｜依据：${(x.basis || []).map((b) => `《${String(b.law).replace(/[《》]/g, "")}》${b.article}${b.link ? `[[art:${b.link}]]` : ""}`).join("；") || "—"}${x.reviewNote ? "｜复核：" + x.reviewNote : ""}`).join("\n");
  const { content } = await stream(settings, {
    model: mainModel, effort: "medium", signal, onText: (delta) => emit({ type: "text", delta }),
    messages: [{
      role: "system",
      content: `${SYSTEM_PROMPT}\n\n## 本次任务：${task.name}\n${task.body}\n\n## 你现在做的事\n根据已经完成的逐${unit}审查和复核结果，写出最终的审查意见。下面给了文件全文、审查发现和已核对的依据清单。引用原文时照抄全文里的句子；引用法条用 [[art:编号]]，编号只能来自依据清单或审查发现。不要再增加没有依据的新问题，不要声称没有拿到原文。`,
    }, {
      role: "user",
      content: `${ctx}\n\n## 文件画像\n${JSON.stringify(profile, null, 1)}\n\n## 文件全文\n${clip(doc, 40000)}\n\n## 依据清单\n${packText}\n\n## 审查发现（已复核、按风险排序）\n${table}\n\n请按以下结构输出：
## 总体结论
（这份${isPlan ? "方案能不能做" : "合同能不能签"}、整体风险高低、必须先改的几处，三五句话）
## 必须修改（高风险）
## 建议修改（中风险）
## 可以接受但要留意（低风险）
${isPlan ? "## 合规改造建议\n（怎么改方案才能做）" : "## 缺失的条款\n## 谈判策略\n（先谈什么、哪些可以让、哪些必须坚持）"}
## 签署前还要确认的事项

每个问题写清：位置、原文、问题与后果、修改后的文字（首选；有后备的写后备）、依据。高中风险用表格或编号列表都可以，修改文字要能直接粘进${isPlan ? "方案" : "合同"}。`,
    }],
  });
  return { text: content, issues, profile };
}
