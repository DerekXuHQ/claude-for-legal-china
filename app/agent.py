"""AI 检索代理：在本地资料库里多轮检索，然后按固定结构给出参考意见。

支持两种接口：
- anthropic：Anthropic 官方 SDK。可改 base_url 和附加请求头，因此也能经 Portkey 等网关调用 Claude。
- openai：OpenAI 兼容接口（DeepSeek、Portkey 的 OpenAI 路由等），用 openai SDK。
"""
import json
from typing import Callable, Iterator

import search

MAX_STEPS = 14

SYSTEM_PROMPT = """你是一个中国大陆法律检索与分析工具，用户把你当作参考用的法律智囊。你的任务：理解问题，在本地资料库里多轮检索，给出清楚、具体、可追溯的参考意见。

## 工作方法
1. 先拆解问题：涉及哪些法律关系、哪个地区、哪个时间点、用户想解决什么。
2. 多轮检索：先找全国性法律和司法解释，再看行政法规和用户所在地区的地方性法规；需要时看法规目录、读原文条文；查找相关的最高法指导性案例；查找实务要点和处理流程。检索词换几种说法（例如「解除劳动合同」「辞退」「经济补偿」）。
3. 只依据检索到的资料下结论。资料库里没有、或你没有读到原文的规定，不要当作已确认的依据；确有必要提到时，明确写「资料库中未检索到，需另行核实」。
4. 注意效力和版本：区分现行有效、旧版本、尚未生效（例如商标法 2026 年修订版 2027-01-01 才施行，2026 年内仍适用 2019 年修正版）。上位法优先，特别规定优先，地方性法规只在对应地区适用。

## 引用格式（必须遵守）
每次引用资料，都在句末用双方括号写上检索结果里给出的编号，界面会把它变成可点击的链接：
- 条文：[[art:编号]]，例如 [[art:593cdcfe417d6650:第一条]]
- 法规整体：[[law:编号]]
- 指导性案例：[[case:编号]]，例如 [[case:GC279]]
- 实务要点或处理流程：[[ref:编号]]
编号必须原样复制工具返回的 id，不能编造。

## 回答结构（Markdown，按需省略空的部分）
## 结论摘要
用三五句话直接回答问题，给出你的判断。

## 适用的规定
逐条列出适用的条文：写明法规名称和条号、它说了什么、为什么适用于本案情形，附引用。

## 不适用或需要排除的规定
用户可能以为适用、但实际不适用或需要区分的规定，说明理由。

## 相关案例
相关的指导性案例及其裁判要点对本问题的意义。没有就写「未检索到直接相关的指导性案例」。

## 建议的处理流程
按步骤写出实际怎么做：先做什么、准备哪些材料、注意哪些期限和程序。

## 建议
你的具体建议和风险提示，包括对用户最有利的做法和需要避免的做法。

## 可以向律师确认的问题
三到五个值得拿去问执业律师的具体问题。

## 写作要求
- 用简洁的中文直接给出意见，不要寒暄，不要表演个性。
- 不需要反复声明「这不构成法律意见」「我不是律师」，界面已有统一提示。
- 用户没说地区时，先按全国性规定回答，并指出哪些地方会因地区不同而变化。
- 金额、期限、比例等数字以检索到的条文为准；条文没写的，不要自己编。"""

TOOLS = [
    {
        "name": "search_law",
        "description": "全文检索法律法规条文（法律、司法解释、行政法规、监察法规、地方性法规）。返回条文编号、法规名称、条号、效力状态和摘要。检索词用两个以上关键词效果更好，例如「劳动合同 解除 经济补偿」。",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "检索词，空格分隔多个关键词"},
                "level": {"type": "string", "enum": ["", "法律", "司法解释", "行政法规", "监察法规", "地方性法规"], "description": "效力层级，留空不限"},
                "province": {"type": "string", "description": "地区，例如「广东省」「上海市」；填「全国」只看全国性规定；留空不限"},
                "include_old": {"type": "boolean", "description": "是否包含旧版本和失效规定，默认 false"},
                "limit": {"type": "integer", "description": "返回条数，默认 10，最多 25"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "find_law_by_title",
        "description": "按名称查找法规，例如「劳动合同法」「商标法」。返回法规编号、效力状态和版本日期。",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "法规名称或名称中的关键词"},
                "include_old": {"type": "boolean", "description": "是否包含旧版本，默认 false"},
            },
            "required": ["title"],
        },
    },
    {
        "name": "law_outline",
        "description": "查看一部法规的目录：不填 chapter 返回各章及条号范围；填 chapter（章名中的关键词）返回该章每条的开头和条文编号。",
        "input_schema": {
            "type": "object",
            "properties": {
                "law_id": {"type": "string", "description": "法规编号（find_law_by_title 或 search_law 返回的 doc_id）"},
                "chapter": {"type": "string", "description": "章名关键词，可选"},
            },
            "required": ["law_id"],
        },
    },
    {
        "name": "read_articles",
        "description": "读取条文全文。一次最多 20 条。",
        "input_schema": {
            "type": "object",
            "properties": {"article_ids": {"type": "array", "items": {"type": "string"}, "description": "条文编号列表"}},
            "required": ["article_ids"],
        },
    },
    {
        "name": "search_cases",
        "description": "检索最高人民法院指导性案例，返回案例编号、标题、关键词和裁判要点摘要。",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "description": "默认 8"}},
            "required": ["query"],
        },
    },
    {
        "name": "read_case",
        "description": "读取指导性案例的关键词、裁判要点、相关法条、基本案情、裁判结果和裁判理由。",
        "input_schema": {
            "type": "object",
            "properties": {"case_id": {"type": "string"}},
            "required": ["case_id"],
        },
    },
    {
        "name": "search_guides",
        "description": "检索实务要点和处理流程（律师工作方法、审查清单、期限计算、文书结构等），用于写「建议的处理流程」。返回编号和摘要，需要细节时用 read_guide。",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "description": "默认 6"}},
            "required": ["query"],
        },
    },
    {
        "name": "read_guide",
        "description": "读取一段实务要点或处理流程的全文。",
        "input_schema": {
            "type": "object",
            "properties": {"guide_id": {"type": "string"}},
            "required": ["guide_id"],
        },
    },
]

STEP_LABEL = {
    "search_law": "检索条文", "find_law_by_title": "查找法规", "law_outline": "查看目录", "read_articles": "阅读条文",
    "search_cases": "检索案例", "read_case": "阅读案例", "search_guides": "检索实务资料", "read_guide": "阅读实务资料",
}


def _str(v, default=""):
    return v if isinstance(v, str) else default


def _int(v, default, hi):
    return max(1, min(int(v), hi)) if isinstance(v, int) else default


def run_tool(name: str, args: dict) -> str:
    """执行工具并返回 JSON 文本。参数来自模型输出，逐项校验类型。"""
    if not isinstance(args, dict):
        raise ValueError("参数必须是对象")
    if name == "search_law":
        q = _str(args.get("query"))
        if not q:
            raise ValueError("query 不能为空")
        res = search.search_articles(q, level=_str(args.get("level")), province=_str(args.get("province")),
                                     current_only=not args.get("include_old", False), limit=_int(args.get("limit"), 10, 25))
        return json.dumps(res["items"], ensure_ascii=False)
    if name == "find_law_by_title":
        t = _str(args.get("title"))
        if not t:
            raise ValueError("title 不能为空")
        res = search.search_laws(t, current_only=not args.get("include_old", False), limit=12)
        return json.dumps([{k: i[k] for k in ("doc_id", "title", "level", "status", "province", "version_date", "n_articles")} for i in res["items"]], ensure_ascii=False)
    if name == "law_outline":
        o = search.outline(_str(args.get("law_id")), _str(args.get("chapter")))
        return json.dumps(o or {"error": "未找到该法规"}, ensure_ascii=False)
    if name == "read_articles":
        ids = args.get("article_ids")
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise ValueError("article_ids 必须是字符串列表")
        out = []
        for i in ids[:20]:
            a = search.get_article(i)
            out.append({k: a[k] for k in ("id", "title", "article", "chapter", "text", "level", "status", "province", "note")} if a else {"id": i, "error": "未找到"})
        return json.dumps(out, ensure_ascii=False)
    if name == "search_cases":
        q = _str(args.get("query"))
        res = search.search_cases(q, limit=_int(args.get("limit"), 8, 15))
        return json.dumps(res["items"], ensure_ascii=False)
    if name == "read_case":
        c = search.get_case(_str(args.get("case_id")))
        if not c:
            return json.dumps({"error": "未找到该案例"}, ensure_ascii=False)
        return json.dumps({k: c[k] for k in ("id", "title", "keywords", "points", "laws", "facts", "result", "reasoning", "url")}, ensure_ascii=False)
    if name == "search_guides":
        res = search.search_refs(_str(args.get("query")), limit=_int(args.get("limit"), 6, 12))
        return json.dumps(res["items"], ensure_ascii=False)
    if name == "read_guide":
        r = search.get_ref(_str(args.get("guide_id")))
        if not r:
            return json.dumps({"error": "未找到"}, ensure_ascii=False)
        return json.dumps({"id": r["id"], "title": r["title"], "heading": r["heading"], "text": r["text"][:12000]}, ensure_ascii=False)
    raise ValueError(f"未知工具：{name}")


def _step_text(name: str, args: dict) -> str:
    label = STEP_LABEL.get(name, name)
    detail = args.get("query") or args.get("title") or args.get("law_id") or args.get("case_id") or args.get("guide_id") or ""
    if name == "read_articles" and isinstance(args.get("article_ids"), list):
        detail = f"{len(args['article_ids'])} 条"
    if args.get("province"):
        detail += f"（{args['province']}）"
    return f"{label}：{detail}" if detail else label


def _user_text(question: str, region: str) -> str:
    return f"[用户所在或关注的地区：{region}]\n\n{question}" if region else question


# ---------------- Anthropic ----------------

def run_anthropic(settings: dict, history: list, question: str, region: str, emit: Callable[[dict], None]) -> list:
    import anthropic

    kwargs = {"api_key": settings["api_key"]} if settings.get("api_key") else {}
    # 留空时显式用官方地址，避免被环境变量 ANTHROPIC_BASE_URL 意外改写
    kwargs["base_url"] = settings.get("base_url") or "https://api.anthropic.com"
    if settings.get("extra_headers"):
        kwargs["default_headers"] = settings["extra_headers"]
    client = anthropic.Anthropic(**kwargs)
    model = settings.get("model") or "claude-opus-5-5"
    # 服务端拒答回退只在直连 Anthropic 且使用支持该功能的模型时开启
    use_fallback = settings.get("fallback", True) and not settings.get("base_url") and model in (
        "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5")
    tools = [{**t, "eager_input_streaming": True} for t in TOOLS]
    messages = list(history) + [{"role": "user", "content": _user_text(question, region)}]
    params = dict(model=model, max_tokens=64000, system=SYSTEM_PROMPT, tools=tools, messages=messages,
                  cache_control={"type": "ephemeral"}, output_config={"effort": settings.get("effort") or "medium"})
    json_retries = 0
    for _ in range(MAX_STEPS):
        try:
            if use_fallback:
                stream_ctx = client.beta.messages.stream(**params, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            else:
                stream_ctx = client.messages.stream(**params)
            with stream_ctx as stream:
                for event in stream:
                    if event.type == "text":
                        emit({"type": "text", "delta": event.text})
                response = stream.get_final_message()
            json_retries = 0
        except ValueError:
            # 工具参数 JSON 完全无法解析：重发本轮（有上限）
            json_retries += 1
            if json_retries > 2:
                raise
            continue
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "pause_turn":
            continue
        if response.stop_reason == "refusal":
            emit({"type": "error", "message": "模型拒绝回答这个问题。可以换一种问法再试。"})
            return messages
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            return messages
        if response.stop_reason == "max_tokens":
            emit({"type": "error", "message": "输出被截断，请缩小问题范围后重试。"})
            return messages
        results = []
        for block in tool_uses:
            emit({"type": "step", "text": _step_text(block.name, block.input if isinstance(block.input, dict) else {})})
            try:
                content, is_error = run_tool(block.name, block.input), False
            except Exception as e:  # 参数有误时把错误交回模型，让它修正后重试
                content, is_error = json.dumps({"error": str(e)}, ensure_ascii=False), True
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": content, "is_error": is_error})
        messages.append({"role": "user", "content": results})
        emit({"type": "text_reset"})
    emit({"type": "error", "message": "检索步骤过多，已停止。可以把问题拆小一点再问。"})
    return messages


# ---------------- OpenAI 兼容 ----------------

def run_openai(settings: dict, history: list, question: str, region: str, emit: Callable[[dict], None]) -> list:
    from openai import OpenAI

    client = OpenAI(api_key=settings.get("api_key") or "none", base_url=settings.get("base_url") or None,
                    default_headers=settings.get("extra_headers") or None)
    tools = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in TOOLS]
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + list(history) + [{"role": "user", "content": _user_text(question, region)}]
    for _ in range(MAX_STEPS):
        resp = client.chat.completions.create(model=settings.get("model"), messages=messages, tools=tools)
        msg = resp.choices[0].message
        calls = msg.tool_calls or []
        messages.append({"role": "assistant", "content": msg.content or "",
                         **({"tool_calls": [c.model_dump() for c in calls]} if calls else {})})
        if not calls:
            emit({"type": "text", "delta": msg.content or ""})
            return messages[1:]
        for c in calls:
            try:
                args = json.loads(c.function.arguments or "{}")
            except json.JSONDecodeError:
                args = None
            emit({"type": "step", "text": _step_text(c.function.name, args if isinstance(args, dict) else {})})
            try:
                content = run_tool(c.function.name, args)
            except Exception as e:
                content = json.dumps({"error": str(e)}, ensure_ascii=False)
            messages.append({"role": "tool", "tool_call_id": c.id, "content": content})
    emit({"type": "error", "message": "检索步骤过多，已停止。可以把问题拆小一点再问。"})
    return messages[1:]


def ask(settings: dict, history: list, question: str, region: str, emit: Callable[[dict], None]) -> list:
    if settings.get("provider") == "openai":
        return run_openai(settings, history, question, region, emit)
    return run_anthropic(settings, history, question, region, emit)
