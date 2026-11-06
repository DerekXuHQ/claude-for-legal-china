// 自检：在真实的 App 网页视图里把主要功能走一遍，结果写进 /data/autotest.json（GitHub 构建和本机测试都读它）。
// 启动参数 -autotest YES 时运行。配置了 API key 时还会真问一个问题。
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const results = [];
const save = (done = false) => { try { writeFileSync("/data/autotest.json", JSON.stringify({ done, at: new Date().toISOString(), results }, null, 1)); } catch { /* 写不了就算了 */ } };
const H = () => ({ "Content-Type": "application/json", "X-App-Token": new URLSearchParams(location.hash.slice(1)).get("t") || "" });
const api = async (p, opts = {}) => { const r = await fetch(p, { headers: H(), ...opts }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 1500)}`); return j; };
const b64 = (s) => { const u = new TextEncoder().encode(s); let x = ""; for (const c of u) x += String.fromCharCode(c); return btoa(x); };

async function step(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Math.round(performance.now() - t0), detail: String(detail ?? "").slice(0, 300) });
  } catch (e) {
    // Safari 的 e.stack 不含错误信息，两样都记
    results.push({ name, ok: false, ms: Math.round(performance.now() - t0), detail: `${e?.name || "Error"}: ${e?.message || e}\n${String(e?.stack || "").slice(0, 400)}` });
  }
  save();
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

export async function autotest() {
  save();
  await step("资料库准备（首次下载并建索引）", async () => {
    for (let i = 0; i < 1800; i++) {
      const s = await api("/api/status");
      if (s.ready) return `完成：${s.phase}`;
      if (s.error) throw new Error(s.error);
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("30 分钟内没准备好");
  });
  await step("检索条文（FTS5 trigram）", async () => {
    const r = await api("/api/search?type=article&q=" + encodeURIComponent("劳动合同 解除 经济补偿"));
    const hit = r.items.find((x) => x.title === "中华人民共和国劳动合同法" && x.article === "第四十七条");
    must(hit, "没检索到劳动合同法第四十七条：" + r.items.slice(0, 3).map((x) => x.title + x.article).join("；"));
    return `${r.items.length} 条，含劳动合同法第四十七条`;
  });
  await step("检索案例", async () => { const r = await api("/api/search?type=case&q=" + encodeURIComponent("买卖合同 违约金")); must(r.items.length > 0, "没有结果"); return `${r.items.length} 个，首个：${r.items[0].title}`; });
  await step("法规浏览", async () => { const r = await api("/api/browse/laws"); const n = r.items?.length ?? r.length ?? 0; must(n > 100, "法规太少：" + n); return `${n} 部`; });
  await step("场景目录", async () => { const r = await api("/api/scenarios"); must(r.scenarios.length >= 90, "场景数 " + r.scenarios.length); return `${r.scenarios.length} 个场景`; });
  await step("Agent 目录", async () => {
    const r = await api("/api/agents");
    const t = r.agents.filter((a) => a.kind === "task").length, w = r.agents.filter((a) => a.kind === "watch").length;
    must(t >= 150 && w >= 11, `命名 ${t}，定时 ${w}`);
    return `命名 Agent ${t} 个，定时 Agent ${w} 个`;
  });
  await step("台账写入和读取（生僻字）", async () => {
    await api("/api/registers/contracts", { method: "POST", body: JSON.stringify({ data: { 对方: "上海龑辰科技有限公司", 合同名称: "自检合同", 到期日: "2027-01-15" } }) });
    const r = await api("/api/registers/contracts");
    must(r.rows.some((x) => x.对方 === "上海龑辰科技有限公司"), "读回来的不一致");
    return `合同台账 ${r.count} 条，生僻字「龑」正确`;
  });
  await step("实务画像保存", async () => {
    await api("/api/profiles/_company", { method: "POST", body: JSON.stringify({ text: "自检：上海喆远数据服务有限公司，员工 50 人。" }) });
    const r = await api("/api/profiles/_company");
    must(r.text.includes("喆远"), "读回来的不一致");
    return "公司基本情况已保存";
  });
  let matterId = "";
  await step("新建事项、上传文本（中文无乱码）", async () => {
    matterId = (await api("/api/matters", { method: "POST", body: "{}" })).id;
    const text = "第一条 甲方上海龑辰科技有限公司，乙方北京喆远数据服务有限公司。鑫淼犇骉，繁體字測試。";
    const r = await api("/api/upload", { method: "POST", body: JSON.stringify({ matter_id: matterId, name: "测试.txt", mime: "text/plain", data: b64(text) }) });
    must(r.preview && r.preview.includes("龑辰") && r.preview.includes("喆远") && r.preview.includes("繁體字測試"), "读出的文字不对：" + JSON.stringify(r).slice(0, 200));
    const m = await api("/api/matters/" + matterId);
    return `事项 ${m.files.length} 个文件；读出 ${r.chars} 字：${r.preview}`;
  });
  await step("导出 Word，再上传读回（docx 生成 + 解析）", async () => {
    const r = await fetch("/api/export", { method: "POST", headers: H(), body: JSON.stringify({ title: "自检", markdown: "# 法律意见\n\n上海龑辰科技有限公司应于 2026 年 11 月 13 日前提交答辩状。\n\n| 项目 | 金额 |\n|---|---|\n| 经济补偿 | 140,000 元 |" }) });
    must(r.ok, "导出失败 " + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    must(buf[0] === 0x50 && buf[1] === 0x4b, "不是 docx（zip）文件");
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const up = await api("/api/upload", { method: "POST", body: JSON.stringify({ matter_id: matterId, name: "自检.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: btoa(s) }) });
    must(up.preview && up.preview.includes("龑辰") && up.preview.includes("140,000"), "读回来的文字不对：" + JSON.stringify(up).slice(0, 200));
    return `docx ${buf.length} 字节，读回 ${up.chars} 字：${up.preview.slice(0, 60)}`;
  });
  await step("上传 PDF（pdf.js 在网页视图里解析）", async () => {
    // 手写一个最小的 PDF（Helvetica，ASCII 文字），测试 pdf.js 和它的 worker 能在 App 里跑
    const content = "BT /F1 18 Tf 72 720 Td (Contract No. 2026-1106 Penalty 500000) Tj ET";
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    let pdf = "%PDF-1.4\n"; const offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const r = await api("/api/upload", { method: "POST", body: JSON.stringify({ matter_id: matterId, name: "自检.pdf", mime: "application/pdf", data: btoa(pdf) }) });
    must(r.preview && r.preview.includes("Contract No. 2026-1106"), "读出的文字不对：" + JSON.stringify(r).slice(0, 200));
    return `读出：${r.preview}`;
  });
  await step("本机文字识别（Vision）", async () => {
    const c = document.createElement("canvas"); c.width = 900; c.height = 260;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 900, 260); g.fillStyle = "#000";
    g.font = '56px "PingFang SC", sans-serif'; g.fillText("劳动合同解除通知书", 40, 100); g.fillText("经济补偿十四万元整", 40, 200);
    const data = c.toDataURL("image/png").split(",")[1];
    const t = await globalThis.__iosNative.ocr({ data, mime: "image/png" });
    must(/劳动合同/.test(t) && /经济补偿/.test(t), "识别结果：" + t);
    return t.replace(/\n/g, " / ");
  });
  await step("网页环境（麦克风能否直接用）", async () => `isSecureContext=${window.isSecureContext}，mediaDevices=${!!navigator.mediaDevices?.getUserMedia}，AudioContext=${!!window.AudioContext}，Worker=${typeof Worker}`);
  await step("联网（原生网络通道）", async () => { const r = await fetch("https://www.gov.cn/"); return `HTTP ${r.status}，${(await r.text()).length} 字节`; });
  // 配置了 API key（本机测试）：真问一个问题
  let settings = {};
  try { if (existsSync("/data/settings.json")) settings = JSON.parse(readFileSync("/data/settings.json", "utf-8")); } catch { /* 没有 */ }
  if (settings.api_key && settings.model) {
    await step("AI 问答（流式）", async () => {
      const r = await fetch("/api/ask", { method: "POST", headers: H(), body: JSON.stringify({ matter_id: matterId, question: "上海员工工作 3 年，公司违法解除，月薪 1 万，赔偿金多少？简要回答。", depth: "low", skip_intake: true }) });
      const reader = r.body.getReader(); const dec = new TextDecoder(); let text = "", events = 0, buf = "";
      for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (!line.startsWith("data: ")) continue; events++; const ev = JSON.parse(line.slice(6)); if (ev.type === "text") text += ev.delta; if (ev.type === "text_reset") text = ""; if (ev.type === "error") throw new Error(ev.message); } }
      must(text.length > 50, "回答太短：" + text);
      return `${events} 个事件，回答 ${text.length} 字：${text.slice(0, 80)}`;
    });
    await step("命名 Agent（保密协议分流）", async () => {
      const r = await fetch("/api/ask", { method: "POST", headers: H(), body: JSON.stringify({ matter_id: matterId, agent: "commercial-legal:nda-triage", question: "对方发来一份保密协议，我方是接收方，保密期限永久，违约金 500 万。按现有信息直接分流。", depth: "low", skip_intake: true }) });
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "", text = "", route = "";
      for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf("\n\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (!line.startsWith("data: ")) continue; const ev = JSON.parse(line.slice(6)); if (ev.type === "route") route = ev.name; if (ev.type === "text") text += ev.delta; if (ev.type === "text_reset") text = ""; if (ev.type === "error") throw new Error(ev.message); } }
      must(route === "保密协议分流", "没有交给保密协议分流：" + route);
      must(text.length > 50, "回答太短");
      return `交给「${route}」，回答 ${text.length} 字`;
    });
    await step("定时 Agent（合同续约监控，立即运行）", async () => {
      const r = await api("/api/watchers/" + encodeURIComponent("watch:commercial-legal:renewal-watcher") + "/run", { method: "POST", body: "{}" });
      must(r.runId, "没有运行：" + JSON.stringify(r));
      const run = await api("/api/runs/" + r.runId);
      must(run.status === "done" && run.text.length > 20, "报告不完整：" + run.status);
      return `报告 ${run.text.length} 字；摘要：${run.summary}`;
    });
  }
  await uiTour();
  save(true);
  return results;
}

// 界面巡检：像用户一样点一遍主要页面，每一步截一张图（data/shots/），GitHub 构建把它们收进 Artifacts
import { call } from "./native.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const click = (s) => { const e = typeof s === "string" ? $(s) : s; if (!e) throw new Error("找不到：" + s); e.click(); };
async function shot(name) { await wait(700); await call("debug.snapshot", { name }); }
async function uiTour() {
  const W = window;
  for (let i = 0; i < 60 && typeof W.showView !== "function"; i++) await wait(500);
  const tour = [
    ["01-新事项", async () => { click('.tab[data-view="ask"]'); click("#new-matter"); }],
    ["02-事项抽屉", async () => { click('[data-toggle="ask-left"]'); }],
    ["03-选择劳动用工", async () => { document.body.click(); W.setCollapsed?.("ask-left", true); await wait(200); click('.pk-groups li[data-g="A"]'); }],
    ["04-选中Agent", async () => { click(".pk-card[data-agent]"); }],
    ["05-定时Agent", async () => { click('.tab[data-view="agents"]'); }],
    ["06-台账", async () => { click('#ag-areas li[data-k="_registers"]'); }],
    ["07-实务画像", async () => { click('#ag-areas li[data-k="_profiles"]'); }],
    ["08-商事合同Agent", async () => { click('#ag-areas li[data-k="commercial-legal"]'); }],
    ["09-技能说明", async () => { click('.ag-card [data-act="skill"]'); await wait(800); }],
    ["10-检索结果", async () => { $("#ag-dialog")?.close?.(); click('.tab[data-view="search"]'); $("#q").value = "劳动合同 解除"; $("#search-form").requestSubmit(); await wait(1200); }],
    ["11-条文全屏", async () => { click("#view-search .results li"); await wait(1000); }],
    ["12-返回", async () => { click(".ios-back"); }],
    ["13-浏览", async () => { click('.tab[data-view="browse"]'); await wait(1200); }],
    ["14-设置", async () => { click('.tab[data-view="settings"]'); await wait(600); }],
    ["14b-导出Word", async () => {
      // 打开有回答的事项，点回答下面的「导出 Word」，确认弹出了系统分享面板
      const list = await api("/api/matters");
      const m = list.find((x) => x.task) || list[0];
      if (!m) return;
      click('.tab[data-view="ask"]'); await W.openMatter(m.id); await wait(800);
      const btn = document.querySelector(".msg.ai [data-word]");
      if (!btn) return; // 没配置模型时事项里没有回答，跳过
      btn.click();
      let shown = "";
      for (let i = 0; i < 16 && !/Activity/.test(shown); i++) { await wait(500); shown = await call("debug.presented"); }
      if (!/Activity/.test(shown)) throw new Error("没有弹出分享面板：" + shown);
    }],
    ["15-深色模式", async () => { document.documentElement.dataset.theme = "dark"; click('.tab[data-view="ask"]'); click("#new-matter"); }],
  ];
  for (const [name, fn] of tour) {
    await step("界面：" + name, async () => { await fn(); await shot(name); return "已截图"; });
  }
  delete document.documentElement.dataset.theme;
}
