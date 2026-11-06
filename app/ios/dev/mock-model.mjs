// 测试用的模型服务（OpenAI 兼容接口）：不用真的 API key 就能把 App 的问答链路完整走一遍。
// - 非流式请求（分流、追问、核对引用）：返回一段能满足各处 JSON 解析的内容
// - 流式请求带工具：第一轮调用 search_law，拿到结果后第二轮逐字流式输出回答
// 用法：node ios/dev/mock-model.mjs [端口]，接口地址填 http://127.0.0.1:端口/v1
import http from "node:http";

const PORT = Number(process.argv[2] || 8791);
const ANSWER = "**结论**：员工在本单位工作满 3 年、月工资 1 万元，公司违法解除的，赔偿金为 6 万元（1 万元 × 3 × 2）。\n\n依据：《中华人民共和国劳动合同法》第八十七条规定违法解除按经济补偿标准的二倍支付赔偿金；第四十七条规定经济补偿按工作年限每满一年支付一个月工资。\n\n〔自检：这段回答来自测试用的模型服务〕";
const JSON_REPLY = JSON.stringify({ task: "general", also: [], region: "", summary: "测试问题", urgent: false, questions: [], assumptions: [], results: [] });
let calls = 0;

function sse(res, chunks) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  let i = 0;
  const tick = () => {
    if (i < chunks.length) { res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`); setTimeout(tick, 15); }
    else { res.write("data: [DONE]\n\n"); res.end(); }
  };
  tick();
}
const chunk = (delta, finish = null) => ({ id: "c1", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }] });

http.createServer((req, res) => {
  const bufs = [];
  req.on("data", (c) => bufs.push(c));
  req.on("end", () => {
    calls++;
    const url = req.url.replace(/^\/v1/, "");
    if (url.startsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
    }
    if (!url.startsWith("/chat/completions")) { res.writeHead(404); return res.end("{}"); }
    let body = {};
    try { body = JSON.parse(Buffer.concat(bufs).toString("utf-8")); } catch { /* 空 */ }
    const usedTool = (body.messages || []).some((m) => m.role === "tool");
    console.log(`[mock-model] #${calls} stream=${!!body.stream} tools=${(body.tools || []).length} usedTool=${usedTool}`);
    if (!body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: "mock", choices: [{ index: 0, message: { role: "assistant", content: JSON_REPLY }, finish_reason: "stop" }] }));
    }
    if ((body.tools || []).some((t) => t.function?.name === "search_law") && !usedTool) {
      return sse(res, [
        chunk({ role: "assistant", content: "" }),
        chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_law", arguments: "" } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ query: "违法解除 赔偿金 经济补偿" }) } }] }),
        chunk({}, "tool_calls"),
      ]);
    }
    // 流式但不带工具：是要 JSON 的调用（分流、追问、核对引用）
    if (!(body.tools || []).length) return sse(res, [chunk({ role: "assistant", content: "" }), chunk({ content: JSON_REPLY }), chunk({}, "stop")]);
    const parts = ANSWER.match(/.{1,6}/gs);
    sse(res, [chunk({ role: "assistant", content: "" }), ...parts.map((p) => chunk({ content: p })), chunk({}, "stop")]);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`[mock-model] http://127.0.0.1:${PORT}/v1`));
