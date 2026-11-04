// 资料库检索工具和带工具的多轮回答循环。任务分流、追问、合同审查流程在 ask.mjs。
import * as search from "../search.mjs";
import { stream, complete } from "./models.mjs";
import { webSearch } from "./web.mjs";
import { expandQuery } from "./synonyms.mjs";

export const SYSTEM_PROMPT = `你是企业的法律顾问（中国大陆执业律师水平），服务对象是企业老板、HR、企业法务，也包括个人。用户要的是能直接拿去用的判断、依据、打法和下一步，不是泛泛的普法摘要；你写出来的东西要达到律所给客户的书面意见的水准。只处理中国大陆法律；涉及港澳台或境外法律时指出这一点，只就大陆法部分作答。

## 怎么工作
1. **先想清楚这是什么事。** 用户真正要解决的问题是什么（判断合法性、应对索赔、决定要不要起诉、改合同……）？涉及哪些法律关系、哪一方、哪个地区、哪个时间点（行为发生时适用的法律版本）？下面的「本次任务」给了这类事的专业做法，照着走。
2. **用资料库检索，按效力层级找依据：** 法律 → 司法解释 → 行政法规、部门规章 → 用户所在地的地方性法规 → 最高法指导性案例 → 办案指引。检索词换几种说法（例如「解除劳动合同」「辞退」「经济补偿」）。关键条文一定读原文（read_articles），不要只看检索摘要。
3. **只依据查到的原文下结论。** 资料库里没有、或你没读到原文的规定，不能当作已确认的依据；确有必要提到，写明「资料库中未检索到，需另行核实」。不要编造条号、金额、比例、期限。每个结论都要有条文真正支撑，不要把不相干的条文挂在结论后面。
4. **注意效力和版本：** 区分现行有效、旧版本、尚未生效（例如商标法 2026 年修订版 2027-01-01 才施行）。上位法优先，特别规定优先，新法优先；地方性法规只在对应地区适用。行为发生在新法施行前的，按当时的法律判断并说明。
5. **案例的效力：** 指导性案例带有 status「不再参照」的，不能作为裁判参照依据，最多作为背景说明并写明已不再参照。
6. **像律师一样把事情想全：** 用户没问但会直接影响结果的风险、期限、证据要求、程序要件、对方可能的抗辩，都要指出来。对方的主张合理的地方，直说。
7. **事实不清时：** 能根据常理合理假设的，写明假设并据此分析；结论取决于某个关键事实的，分情况给结论（「如果……则……；如果……则……」），并在最后列出需要补充的材料。

## 联网搜索
法律条文、司法解释、指导性案例一律以本地资料库为准，不从网上取条文。需要以下内容时用 web_search 联网：别人遇到类似事情是怎么处理的、实务经验和做法（知乎、小红书、豆瓣、公众号等）、网上报道的判决和行政处罚案例、监管动向和执法口径、行业惯例、企业公开信息。网上来的内容在正文里标明「网上资料」并附链接，只作参考，不当作法律依据；个人经验分享要说明只是个例。

## 你站在谁一边
你是用户这一方的助理，不是中立的普法员。合法是底线，不是目标：在法律边界内，按用户的目标（花多少钱、花多少时间、要不要保关系、会不会在公司里开先例）帮他把事办成。对方的要价不等于法律上能拿到的，要分开算；不要一上来就建议起诉，也不要一味退让，要比较了结的成本和打到底的成本，给出打法。不教伪造证据、不建议本身违法的施压手段，用户想这么做时说清后果并给合法的替代办法。

## 引用格式（必须遵守）
引用资料时，在句末用双方括号写上检索结果里给出的编号，界面会把它变成可点击的原文链接：
- 条文：[[art:编号]]，例如 [[art:593cdcfe417d6650:第一条]]
- 法规整体：[[law:编号]]
- 指导性案例：[[case:编号]]，例如 [[case:GC279]]
- 办案指引：[[ref:编号]]
编号必须原样复制工具返回的 id，不能编造。正文提到法条时写全称和条号，例如「《劳动合同法》第四十七条」。

## 输出约定（每个回答都必须遵守）

### 结论块（所有类型都放在最前面，不加标题前的寒暄）
**结论**：一两句话直接回答问题（能 / 不能；合法 / 有风险 / 违法；大概多少钱；最晚哪天）。
**把握**：依据明确 / 取决于事实（写明取决于哪一项）/ 有争议（写明争议在哪里）。不用百分比。
**最要紧的一件事**：现在最该做或最不能做的一件事，有期限的写日期。

### 共同要求
- 每个结论都要能对应到读过原文的条文，按「规定是什么 → 本案事实 → 所以怎样」写，不跳步。
- 「事实与假设」把三类信息分开写：据您所述的事实；我们的假设；会改变结论、还需要确认的事实。用户的定性（如「严重违纪」「对方违约」）当作待分析的问题，不当作事实。
- 金额、期限必须写出公式、每个输入值和它的来源（用户提供 / 假设 / 条文）；拿不准的写成区间并写明前提。
- 下一步写成「谁、在哪天之前、做什么、留下什么记录」。不写「建议协商」「视情况而定」「咨询专业律师」这类空话；确实需要律师的，写明是哪种情形、为什么。
- 用户没问、但会直接影响结果的风险，单列「你没问但要注意的」，最多三条。
- 引用格式见上；地方规定写明地区；行为发生在新法施行前的，写明适用哪一版。

### 结构 A：法律咨询与合法性判断（general、legality、P8、P11）
1. 结论块
2. 事实与假设
3. 分析：按争点分小标题（标题就是该争点的结论），每个争点：规定 → 本案事实 → 结论；需要排除的规定也写一句为什么不适用
4. 合规的做法 / 替代方案（P8：红黄绿，说明怎么改才能达到同样的商业目的）
5. 你没问但要注意的
6. 下一步（含期限）与需要准备的材料

### 结构 B：被动应对争议与监管（P1、P9）
1. 结论块（「最要紧的一件事」必须是期限）
2. 期限表：事项｜截止日｜起算依据｜不做的后果
3. 对方主张逐项拆解表：请求｜金额｜法律上能否成立｜我方抗辩点｜要用的证据｜评估（大概率支持 / 可能支持 / 大概率驳回，附理由）
4. 风险区间：最好 / 最可能 / 最坏，每档写金额、时间和前提；对方要价与法律上能拿到的分开写
5. 对方最可能的抗辩或主张及应对（有依据的才写）
6. 证据：已有｜缺少｜怎么合法补强｜谁在哪天前完成
7. 打法：和解方案（开价 / 目标 / 底线，话术要点，和解协议必备条款）或应诉准备
8. 事实与假设；需要补充的材料

### 结构 C：主动追讨与执行（P2、P3）
1. 结论块（值不值得追、大概能拿回多少、时效是否还在）
2. 权利是否成立与金额计算（附计算表）
3. 证据与补强
4. 对方偿付能力：需要用户去官方渠道查的项目清单
5. 路径与时间表：每一步的触发条件、时间、费用、对关系的影响
6. 对方最可能的抗辩及应对；禁区（不能用的施压方式）
7. 下一步与文书清单

### 结构 D：用工处置方案（P4）
1. 结论块（推荐路径、预计成本区间）
2. 事实与假设
3. 路径比较表：路径｜适用条件｜本案是否满足｜所需证据｜成本（0 / N / N+1 / 2N）｜风险｜所需时间
4. 推荐路径的证据搭建与操作时间轴（第几天、谁、做什么、留什么记录）
5. 金额测算表（公式和每个输入值）
6. 谈判方案；不能做的事
7. 文书清单

### 结构 E：期限与金额计算（P12）
1. 结论块（结果和截止日）
2. 输入值表：项目｜取值｜来源（用户提供 / 假设 / 条文编号）
3. 计算过程（逐步列出算式）
4. 敏感性：哪个输入值变了，结果怎么变
5. 需要核实的数据（如当地社平工资）

### 结构 F：文书（律师函、答辩状、通知书、协议，P6、P7、P13）
先审程序，再按提纲起草：
- 程序审查：主体是否适格、管辖是否正确、时效与期限、送达方式；有问题先指出，不照办。
- 律师函：事实（只写核实过的）→ 法律依据 → 要求事项（具体到金额、行为）→ 履行期限 → 逾期后果（只写法律允许、真能做到的）→ 保留权利。
- 答辩状：逐项回应对方每一项请求（认可 / 部分认可 / 不认可及理由）→ 对事实逐段表态（认可 / 否认 / 无法确认）→ 抗辩理由 → 证据清单。
- 通知书 / 协议：必备要素清单逐项打勾，送达与签收方式。
- 文末：使用前要补的信息（方括号标出）、要核对的事项。

### 合同与方案审查（P5、plan_review）
沿用 review.mjs 的结构（总体结论 → 必须修改 → 建议修改 → 可以接受但要留意 → 缺失条款 / 合规改造 → 谈判策略 → 签署前确认事项），最前面同样加结论块。

## 写完之前逐项核对（只依据本次读过的原文和用户给的事实）
1. 每个结论后面挂的条文，原文里真的有支撑这句话的内容吗？条号和内容对得上吗？只是相关、并不支持的，删掉或改写结论。
2. 这条规定在行为发生时有效吗？有没有更新的版本、配套司法解释或特别规定？用了一般规定的，为什么不适用特别规定？
3. 引用的地方规定是不是用户所在地区的？全国规定和地方规定数字不同时，写明以哪个为准、为什么。
4. 每个金额、期限：公式写了吗？每个输入值的来源写了吗？拿不准的，改成区间并写明前提。
5. 用户的说法里有没有被我当成事实的法律定性？关键事实是用户说的、还是我假设的？有没有分开写？
6. 结论会因为哪个未确认的事实而改变？写进「取决于事实」，并列入需要补充的材料。
7. 对方会怎么反驳？我有没有因为站在用户一边而漏掉对用户不利的条文或事实？
8. 程序上有没有硬伤：主体资格、管辖、时效、前置程序（例如劳动争议须先仲裁）、送达？
9. 下一步是不是能照着做：谁、哪天之前、做什么、留什么记录？
10. 有没有没读原文、只凭检索摘要或记忆写下的依据？有的话，要么现在去读，要么写明「资料库中未检索到，需另行核实」。

用简洁的中文书面语，不寒暄，不表演个性，不反复声明「不构成法律意见」（界面已有统一提示）。`;

export const TOOLS = [
  {
    name: "search_law",
    description: "全文检索法律法规条文（法律、司法解释、行政法规、监察法规、地方性法规）。返回条文编号、法规名称、条号、效力状态和摘要。检索词用两个以上关键词效果更好，例如「劳动合同 解除 经济补偿」。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索词，空格分隔多个关键词" },
        level: { type: "string", enum: ["", "法律", "司法解释", "行政法规", "监察法规", "地方性法规"], description: "效力层级，留空不限" },
        province: { type: "string", description: "地区，例如「广东省」「上海市」；填「全国」只看全国性规定；留空不限" },
        include_old: { type: "boolean", description: "是否包含旧版本和失效规定，默认 false" },
        limit: { type: "integer", description: "返回条数，默认 10，最多 25" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_law_by_title",
    description: "按名称查找法规，例如「劳动合同法」「商标法」。返回法规编号、效力状态、版本日期、施行日期，以及是否已与官方全文核对。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "法规名称或名称中的关键词" },
        include_old: { type: "boolean", description: "是否包含旧版本，默认 false" },
      },
      required: ["title"],
    },
  },
  {
    name: "law_outline",
    description: "查看一部法规的目录：不填 chapter 返回各章及条号范围；填 chapter（章名中的关键词）返回该章每条的开头和条文编号。",
    input_schema: {
      type: "object",
      properties: {
        law_id: { type: "string", description: "法规编号（find_law_by_title 或 search_law 返回的 doc_id）" },
        chapter: { type: "string", description: "章名关键词，可选" },
      },
      required: ["law_id"],
    },
  },
  {
    name: "read_articles",
    description: "读取条文全文。一次最多 20 条。",
    input_schema: {
      type: "object",
      properties: { article_ids: { type: "array", items: { type: "string" }, description: "条文编号列表" } },
      required: ["article_ids"],
    },
  },
  {
    name: "compare_versions",
    description: "对比同一法规的两个版本，返回修改、新增、删除的条文。用于回答「新法改了什么」「哪个版本适用」。",
    input_schema: {
      type: "object",
      properties: {
        law_id: { type: "string", description: "一个版本的法规编号" },
        other_law_id: { type: "string", description: "另一个版本的法规编号（find_law_by_title 加 include_old 可查到）" },
      },
      required: ["law_id", "other_law_id"],
    },
  },
  {
    name: "web_search",
    description: "联网搜索实务经验、类似事情别人怎么处理、网上报道的判决和行政处罚案例、监管动向、行业惯例、企业公开信息（会搜知乎、小红书、新闻、法院和政府网站等）。不要用它查法律条文（条文用 search_law）。返回要点摘要和来源链接。",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "搜索内容，写成一句具体的话" }, purpose: { type: "string", description: "要用它来说明什么" } },
      required: ["query"],
    },
  },
  {
    name: "search_cases",
    description: "检索最高人民法院指导性案例，返回案例编号、标题、关键词和裁判要点摘要。",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", description: "默认 8" } },
      required: ["query"],
    },
  },
  {
    name: "read_case",
    description: "读取指导性案例的关键词、裁判要点、相关法条、基本案情、裁判结果和裁判理由。",
    input_schema: { type: "object", properties: { case_id: { type: "string" } }, required: ["case_id"] },
  },
  {
    name: "search_guides",
    description: "检索实务要点和处理流程（律师工作方法、审查清单、期限计算、文书结构等），用于写「建议的处理流程」。返回编号和摘要，需要细节时用 read_guide。",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", description: "默认 6" } },
      required: ["query"],
    },
  },
  {
    name: "read_guide",
    description: "读取一段实务要点或处理流程的全文。",
    input_schema: { type: "object", properties: { guide_id: { type: "string" } }, required: ["guide_id"] },
  },
];

const STEP_LABEL = {
  search_law: "检索条文", web_search: "联网搜索", find_law_by_title: "查找法规", law_outline: "查看目录", read_articles: "阅读条文", compare_versions: "对比版本",
  search_cases: "检索案例", read_case: "阅读案例", search_guides: "检索实务资料", read_guide: "阅读实务资料",
};

const str = (v, d = "") => (typeof v === "string" ? v : d);
const int = (v, d, hi) => (Number.isInteger(v) ? Math.max(1, Math.min(v, hi)) : d);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

/** 执行工具。参数来自模型输出，逐项校验类型；出错时抛异常，由调用方作为错误结果交回模型。 */
export function runTool(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("参数必须是对象");
  const J = (v) => JSON.stringify(v);
  switch (name) {
    case "search_law": {
      const q = str(args.query);
      if (!q) throw new Error("query 不能为空");
      const opts = { level: str(args.level), province: str(args.province), current_only: args.include_old !== true, limit: int(args.limit, 10, 25) };
      let items = search.searchArticles(q, opts).items;
      const extra = expandQuery(q);
      if (extra && items.length < Math.min(opts.limit, 6)) {
        const seen = new Set(items.map((i) => i.id));
        items = items.concat(search.searchArticles(extra, opts).items.filter((i) => !seen.has(i.id))).slice(0, opts.limit);
        return J({ note: `原词命中较少，已按法律用语「${extra}」补充检索`, items });
      }
      return J(items);
    }
    case "find_law_by_title": {
      const t = str(args.title);
      if (!t) throw new Error("title 不能为空");
      const items = search.searchLaws(t, { current_only: args.include_old !== true, limit: 12 }).items;
      return J(items.map((i) => ({ ...pick(i, ["doc_id", "title", "level", "status", "province", "version_date", "n_articles"]), official_text: i.official })));
    }
    case "law_outline":
      return J(search.outline(str(args.law_id), str(args.chapter)) || { error: "未找到该法规" });
    case "read_articles": {
      const ids = args.article_ids;
      if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string")) throw new Error("article_ids 必须是字符串列表");
      return J(ids.slice(0, 20).map((i) => {
        const a = search.getArticle(i);
        return a ? { ...pick(a, ["id", "title", "article", "chapter", "text", "level", "status", "province", "effective_date", "note"]), official_text: a.official } : { id: i, error: "未找到" };
      }));
    }
    case "compare_versions": {
      const r = search.compareVersions(str(args.law_id), str(args.other_law_id));
      if (!r) return J({ error: "未找到其中一个版本" });
      const cut = (s) => (s || "").slice(0, 400);
      const d = r.diff;
      return J({
        new: r.new, old: r.old, unchanged: d.unchanged, renumbered: d.renumbered,
        modified: d.modified.slice(0, 40).map((m) => ({ old_cn: m.old_cn, new_cn: m.new_cn, new_id: m.new_id, old: cut(m.old), new: cut(m.new) })),
        added: d.added.slice(0, 30).map((m) => ({ new_cn: m.new_cn, new_id: m.new_id, new: cut(m.new) })),
        removed: d.removed.slice(0, 30).map((m) => ({ old_cn: m.old_cn, old_id: m.old_id, old: cut(m.old) })),
      });
    }
    case "search_cases":
      return J(search.searchCases(str(args.query), { limit: int(args.limit, 8, 15) }).items);
    case "read_case": {
      const c = search.getCase(str(args.case_id));
      return J(c ? { ...pick(c, ["id", "title", "keywords", "points", "laws", "facts", "result", "reasoning", "url"]), ...(c.note ? { status: c.note } : {}) } : { error: "未找到该案例" });
    }
    case "search_guides":
      return J(search.searchRefs(str(args.query), { limit: int(args.limit, 6, 12) }).items);
    case "read_guide": {
      const r = search.getRef(str(args.guide_id));
      return J(r ? { id: r.id, title: r.title, heading: r.heading, text: r.text.slice(0, 12000) } : { error: "未找到" });
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

function stepText(name, args) {
  const label = STEP_LABEL[name] || name;
  args = args && typeof args === "object" ? args : {};
  let detail = str(args.query) || str(args.title) || str(args.law_id) || str(args.case_id) || str(args.guide_id);
  if (name === "read_articles" && Array.isArray(args.article_ids)) detail = `${args.article_ids.length} 条`;
  if (typeof args.province === "string" && args.province) detail += `（${args.province}）`;
  return detail ? `${label}：${detail}` : label;
}

export { stepText };

/** 工作过程里每一步展开后显示的内容：查了什么、读了哪些、用了哪些来源 */
function stepDetail(name, content) {
  let j;
  try { j = JSON.parse(content); } catch { return ""; }
  const items = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : null;
  const lawLine = (i) => `《${i.title}》${i.article || ""}${i.status && i.status !== "现行有效" ? `（${i.status}）` : ""}`;
  if (j?.error) return `出错：${j.error}`;
  switch (name) {
    case "search_law": return items?.length ? (j.note ? j.note + "\n" : "") + "命中：" + items.slice(0, 8).map(lawLine).join("；") : "没有命中";
    case "read_articles": return items?.length ? "读了原文：" + items.map((i) => (i.error ? `${i.id}（未找到）` : lawLine(i))).join("；") : "";
    case "find_law_by_title": return items?.length ? "找到：" + items.slice(0, 6).map((i) => `《${i.title}》${i.version_date ? i.version_date + " " : ""}${i.status || ""}`).join("；") : "没有找到";
    case "search_cases": case "search_guides": return items?.length ? "命中：" + items.slice(0, 6).map((i) => i.title).join("；") : "没有命中";
    case "read_case": case "read_guide": return j?.title ? `读了：${j.title}${j.status ? `（${j.status}）` : ""}` : "";
    case "law_outline": return j?.title ? `目录：《${j.title}》` : "";
    case "compare_versions": return j?.new ? `对比：${j.new.version_date || ""} 与 ${j.old?.version_date || ""}，修改 ${j.modified?.length ?? 0} 条` : "";
    default: return "";
  }
}

const TOOL_DEFS = () => TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

// 分析深度：检索轮数和推理强度
export const DEPTH = {
  low: { steps: 8, effort: "low", note: "\n\n## 本次要求\n快速作答：检索两到四次即可，回答精简，只写最关键的规定、结论和下一步。" },
  medium: { steps: 16, effort: "medium", note: "" },
  high: { steps: 26, effort: "high", note: "\n\n## 本次要求\n深入分析：多换几种检索词，逐条读原文、核对版本和施行日期，覆盖例外情形、地方差异和相关案例，回答写完整。" },
};

/**
 * 带工具的多轮检索与回答。stream 为 true 时把文字增量推给 emit。
 * @returns {Promise<{messages: object[], text: string}>}
 */
export async function runAgent(settings, { model, effort, system, messages, steps = 16, emit = () => {}, signal, stream: doStream = true, label = "" }) {
  const msgs = [{ role: "system", content: system }, ...messages];
  const tools = TOOL_DEFS();
  const ledger = new Set(); // 本次实际读过原文的条文编号
  for (let step = 0; step < steps; step++) {
    let turn;
    if (doStream) {
      turn = await stream(settings, { model, messages: msgs, effort, tools, signal, onText: (delta) => emit({ type: "text", delta }), onReset: () => emit({ type: "text_reset" }) });
    } else {
      const r = await complete(settings, { model, messages: msgs, effort, tools, signal });
      const m = r.choices?.[0]?.message || {};
      turn = { content: m.content || "", calls: m.tool_calls || [] };
    }
    msgs.push({ role: "assistant", content: turn.content || "", ...(turn.calls.length ? { tool_calls: turn.calls } : {}) });
    if (!turn.calls.length) return { messages: msgs.slice(1), text: turn.content || "", ledger };
    // 调工具前模型写下的想法：作为「思路」记进工作过程
    if (turn.content && turn.content.trim()) emit({ type: "step", kind: "think", text: (label ? label + " · " : "") + "思路", detail: turn.content.trim().slice(0, 1500) });
    for (const c of turn.calls) {
      let args = null;
      try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* 交给 runTool 报错 */ }
      const name = c.function.name;
      const text = (label ? label + " · " : "") + stepText(name, args);
      let content, detail = "", kind = "local";
      if (name === "web_search") {
        kind = "web";
        emit({ type: "live", text }); // 只在界面上显示「正在联网」，不记进工作过程
        try {
          const r = await webSearch(settings, { model, query: str(args?.query), purpose: str(args?.purpose), signal });
          content = JSON.stringify({ summary: r.summary, sources: r.sources });
          detail = { queries: r.queries, sources: r.sources, summary: r.summary.slice(0, 600) };
        } catch (e) {
          if (signal?.aborted) throw e;
          content = JSON.stringify({ error: `联网搜索失败：${String(e.message || e).slice(0, 200)}` });
          detail = `联网搜索失败：${String(e.message || e).slice(0, 200)}`;
        }
      } else {
        try { content = runTool(name, args); } catch (e) { content = JSON.stringify({ error: String(e.message || e) }); }
        detail = stepDetail(name, content);
        if (name === "read_articles") { try { for (const a of JSON.parse(content)) if (a.id && !a.error) ledger.add(a.id); } catch { /* 忽略 */ } }
      }
      emit({ type: "step", kind, text, detail });
      msgs.push({ role: "tool", tool_call_id: c.id, content });
    }
    if (doStream) emit({ type: "text_reset" });
  }
  // 步数用完：要求直接根据已有资料作答
  msgs.push({ role: "user", content: "检索次数已到上限。请不要再调用工具，直接根据已经查到的资料给出完整回答；没查到的部分明确说明。" });
  const r = doStream
    ? await stream(settings, { model, messages: msgs, effort, signal, onText: (delta) => emit({ type: "text", delta }), onReset: () => emit({ type: "text_reset" }) })
    : { content: (await complete(settings, { model, messages: msgs, effort, signal })).choices?.[0]?.message?.content || "" };
  msgs.push({ role: "assistant", content: r.content || "" });
  return { messages: msgs.slice(1), text: r.content || "", ledger };
}
