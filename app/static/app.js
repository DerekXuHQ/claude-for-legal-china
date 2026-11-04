"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  type: "articles", q: "", offset: 0, selected: null,
  bookmarks: new Map(), // "kind:ref_id" -> bookmark
  conversationId: null, asking: false, savedFilter: "",
};

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/* ---------- 视图切换 ---------- */
$$(".tab").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
function showView(v) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
  if (v === "saved") renderSaved();
  if (v === "ask") $("#question").focus();
}

/* ---------- 初始化 ---------- */
async function init() {
  const m = await api("/api/meta");
  for (const l of m.levels) $("#f-level").insertAdjacentHTML("beforeend", `<option>${esc(l)}</option>`);
  for (const p of m.provinces) {
    $("#f-province").insertAdjacentHTML("beforeend", `<option>${esc(p)}</option>`);
    $("#ask-region").insertAdjacentHTML("beforeend", `<option>${esc(p)}</option>`);
  }
  for (const t of m.topics || []) $("#f-topic").insertAdjacentHTML("beforeend", `<option>${esc(t)}</option>`);
  const c = m.counts || {};
  $("#db-stats").textContent = `本地资料：法律 ${c["法律"] || 0} 部 · 司法解释 ${c["司法解释"] || 0} 件 · 行政法规 ${c["行政法规"] || 0} 部 · 地方性法规 ${c["地方性法规"] || 0} 部 · 现行条文 ${m.articles} 条 · 指导性案例 ${m.cases} 件 · 实务资料 ${m.refs} 段。数据集：${m.dataset || ""}；索引建于 ${m.built_at || ""}。`;
  if (!m.configured) $("#open-settings").classList.replace("ghost", "primary");
  await loadBookmarks();
}

/* ---------- 检索 ---------- */
$("#search-form").addEventListener("submit", (e) => { e.preventDefault(); runSearch(true); });
$$("#f-type button").forEach((b) => b.addEventListener("click", () => {
  $$("#f-type button").forEach((x) => x.classList.toggle("on", x === b));
  state.type = b.dataset.v;
  $(".law-only").style.display = ["articles", "laws"].includes(state.type) ? "" : "none";
  $("#q").placeholder = { articles: "输入关键词，例如：劳动合同 解除 经济补偿", laws: "输入法规名称，例如：商标法", cases: "输入关键词，例如：商标 近似 混淆", refs: "输入关键词，例如：经济补偿 计算" }[state.type];
  if ($("#q").value.trim()) runSearch(true);
}));
["#f-level", "#f-province", "#f-topic", "#f-all"].forEach((s) => $(s).addEventListener("change", () => $("#q").value.trim() && runSearch(true)));
$("#more").addEventListener("click", () => runSearch(false));

async function runSearch(reset) {
  const q = $("#q").value.trim();
  if (!q) return;
  if (reset) { state.offset = 0; $("#results").innerHTML = ""; }
  state.q = q;
  const p = new URLSearchParams({ q, type: state.type, offset: state.offset, limit: 20,
    level: $("#f-level").value, province: $("#f-province").value, topic: $("#f-topic").value, all: $("#f-all").checked ? "1" : "" });
  $("#result-info").textContent = "检索中…";
  try {
    const t0 = performance.now();
    const res = await api("/api/search?" + p);
    state.offset += res.items.length;
    $("#results").insertAdjacentHTML("beforeend", res.items.map(resultHTML).join(""));
    $("#more").hidden = !res.more;
    const n = $("#results").children.length;
    $("#result-info").textContent = n ? `${res.more ? "前 " : "共 "}${n} 条结果 · ${Math.round(performance.now() - t0)} ms` : "没有找到结果。可以换个说法，或减少关键词、放宽筛选。";
  } catch (err) { $("#result-info").textContent = "检索出错：" + err.message; }
}

function highlight(text, q) {
  let h = esc(text);
  for (const w of (q || "").split(/\s+/).filter((x) => x.length >= 1)) {
    h = h.split(esc(w)).join(`<mark>${esc(w)}</mark>`);
  }
  return h;
}

function badges(it) {
  const out = [];
  if (it.level) out.push(`<span class="badge">${esc(it.level)}</span>`);
  if (it.province && it.province !== "全国") out.push(`<span class="badge">${esc(it.province)}</span>`);
  if (it.status) {
    const cls = it.status === "有效" ? "cur" : it.status === "尚未生效" ? "pending" : "old";
    out.push(`<span class="badge ${cls}">${esc(it.status === "有效" ? "现行有效" : it.status)}</span>`);
  }
  return out.join("");
}

function resultHTML(it) {
  const key = `${it.kind}|${it.id}`;
  let title = esc(it.title), meta = badges(it);
  if (it.kind === "article") title += `<span class="art">${esc(it.article)}</span>`;
  if (it.kind === "law") meta += it.version_date ? `<span class="badge">${esc(it.version_date)}</span>` : "";
  if (it.kind === "case") meta = it.keywords ? `<span class="badge">${esc(it.keywords.slice(0, 40))}</span>` : "";
  if (it.kind === "ref") { title = esc(it.title) + (it.heading ? ` · ${esc(it.heading.slice(0, 40))}` : ""); meta = `<span class="badge">${esc(it.ref_kind)}</span>`; }
  return `<li data-key="${esc(key)}"><div class="r-title">${title}</div><div class="r-meta">${meta}</div><div class="r-snip">${highlight(it.snippet || "", state.q)}</div></li>`;
}

$("#results").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  $$("#results li").forEach((x) => x.classList.toggle("sel", x === li));
  const [kind, id] = li.dataset.key.split("|");
  openItem(kind, id, $("#detail"));
});

/* ---------- 详情 ---------- */
async function openItem(kind, id, target, highlightArticle) {
  target.innerHTML = `<div class="empty">加载中…</div>`;
  try {
    const it = await api(`/api/item/${kind}/${encodeURIComponent(id)}`);
    target.innerHTML = detailHTML(it, highlightArticle);
    target.scrollTop = 0;
    const hl = $(".art-item.hl", target);
    if (hl) hl.scrollIntoView({ block: "center" });
    bindDetail(target, it);
  } catch (err) { target.innerHTML = `<div class="empty err">${esc(err.message)}</div>`; }
}

function starBtn(kind, id) {
  const on = state.bookmarks.has(`${kind}:${id}`);
  return `<button class="ghost star ${on ? "on" : ""}" data-star="${esc(kind)}|${esc(id)}">${on ? "★ 已收藏" : "☆ 收藏"}</button>`;
}

function detailHTML(it, hlArticle) {
  if (it.kind === "article") {
    return `<div class="d-head"><div><h2>${esc(it.title)} <span style="color:var(--accent)">${esc(it.article)}</span></h2>
      <div class="r-meta">${badges(it)}${it.chapter ? `<span class="badge">${esc(it.chapter)}</span>` : ""}</div></div>
      <div class="d-actions">${starBtn("article", it.id)}<button class="ghost" data-open-law="${esc(it.doc_id)}" data-hl="${esc(it.id)}">看整部法规</button></div></div>
      ${it.note ? `<div class="d-note">${esc(it.note)}</div>` : ""}
      <div class="d-text">${esc(it.text)}</div>
      ${srcLine(it)}`;
  }
  if (it.kind === "law") {
    let lastCh = null;
    const arts = it.articles.map((a) => {
      let h = "";
      if (a.chapter && a.chapter !== lastCh) { h += `<div class="ch">${esc(a.chapter)}${a.section ? " · " + esc(a.section) : ""}</div>`; lastCh = a.chapter; }
      return h + `<div class="art-item ${a.id === hlArticle ? "hl" : ""}" data-art="${esc(a.id)}">${esc(a.text)}</div>`;
    }).join("");
    const versions = (it.other_versions || []).map((v) => `<button class="cite" data-open-law="${esc(v.id)}">${esc(v.version_date || "")} ${esc(v.status)}</button>`).join("");
    return `<div class="d-head"><div><h2>${esc(it.title)}</h2>
      <div class="r-meta">${badges(it)}${it.version_date ? `<span class="badge">${esc(it.version_date)}</span>` : ""}${it.issuer ? `<span class="badge">${esc(it.issuer)}</span>` : ""}</div></div>
      <div class="d-actions">${starBtn("law", it.id)}</div></div>
      ${it.note ? `<div class="d-note">${esc(it.note)}</div>` : ""}
      ${it.history ? `<p class="muted small">${esc(it.history)}</p>` : ""}
      ${versions ? `<p class="small">其他版本：${versions}</p>` : ""}
      <div class="art-list">${arts}</div>${srcLine(it)}`;
  }
  if (it.kind === "case") {
    const sec = [["关键词", it.keywords], ["裁判要点", it.points], ["相关法条", it.laws], ["基本案情", it.facts], ["裁判结果", it.result], ["裁判理由", it.reasoning]]
      .filter(([, v]) => v).map(([k, v]) => `<div class="d-section"><h4>${k}</h4><div class="d-text">${esc(v)}</div></div>`).join("");
    return `<div class="d-head"><div><h2>${esc(it.title)}</h2><div class="r-meta"><span class="badge">最高人民法院指导性案例</span></div></div>
      <div class="d-actions">${starBtn("case", it.id)}</div></div>${sec || `<div class="d-text">${esc(it.text)}</div>`}
      <p class="d-src small muted">来源：<a href="${esc(it.url)}" target="_blank" rel="noopener">最高人民法院</a></p>`;
  }
  if (it.kind === "ref") {
    return `<div class="d-head"><div><h2>${esc(it.title)}</h2><div class="r-meta"><span class="badge">${esc(it.kind_label || it.kind)}</span><span class="badge">${esc(it.plugin)}</span></div></div>
      <div class="d-actions">${starBtn("ref", it.id)}</div></div><div class="md">${renderMD(it.text)}</div>
      <p class="muted small">来源：本仓库 ${esc(it.path)}</p>`;
  }
  if (it.kind === "answer") {
    return `<div class="d-head"><div><h2>${esc(it.question)}</h2><div class="r-meta">${it.region ? `<span class="badge">${esc(it.region)}</span>` : ""}<span class="badge">${esc(it.model)}</span><span class="badge">${new Date(it.created * 1000).toLocaleString("zh-CN")}</span></div></div>
      <div class="d-actions">${starBtn("answer", it.id)}</div></div><div class="md">${renderMD(it.answer)}</div>`;
  }
  return `<pre>${esc(JSON.stringify(it, null, 2))}</pre>`;
}

function srcLine(it) {
  const src = it.source || "";
  return src ? `<p class="d-src small muted">来源：${it.source_url ? `<a href="${esc(it.source_url)}" target="_blank" rel="noopener">${esc(src)}</a>` : esc(src)}（数据集快照，引用前以官方文本为准）</p>` : "";
}

function bindDetail(target, it) {
  $$("[data-star]", target).forEach((b) => b.addEventListener("click", () => toggleBookmark(b, it)));
  $$("[data-open-law]", target).forEach((b) => b.addEventListener("click", () => openItem("law", b.dataset.openLaw, target, b.dataset.hl)));
  bindCites(target);
}

/* ---------- 收藏 ---------- */
async function loadBookmarks() {
  const list = await api("/api/bookmarks");
  state.bookmarks = new Map(list.map((b) => [`${b.kind}:${b.ref_id}`, b]));
  $("#saved-count").textContent = list.length ? list.length : "";
  return list;
}

function bookmarkInfo(it) {
  if (it.kind === "article") return { title: `${it.title} ${it.article}`, subtitle: it.level, snippet: it.text.slice(0, 120) };
  if (it.kind === "law") return { title: it.title, subtitle: it.level, snippet: it.history ? it.history.slice(0, 120) : "" };
  if (it.kind === "case") return { title: it.title, subtitle: "指导性案例", snippet: (it.points || "").slice(0, 120) };
  if (it.kind === "ref") return { title: it.title, subtitle: it.heading, snippet: it.text.slice(0, 120) };
  if (it.kind === "answer") return { title: it.question, subtitle: "AI 回答", snippet: it.answer.replace(/\[\[[^\]]+\]\]|[#*]/g, "").slice(0, 120) };
  return { title: it.id };
}

async function toggleBookmark(btn, it) {
  const [kind, id] = btn.dataset.star.split("|");
  const key = `${kind}:${id}`;
  if (state.bookmarks.has(key)) {
    await api(`/api/bookmarks/${state.bookmarks.get(key).id}`, { method: "DELETE" });
  } else {
    const note = kind === "answer" ? "" : (prompt("给这条收藏加个备注（可留空）：") ?? "");
    await api("/api/bookmarks", { method: "POST", body: JSON.stringify({ kind, ref_id: id, note, ...bookmarkInfo(it) }) });
  }
  await loadBookmarks();
  $$(`[data-star="${CSS.escape(btn.dataset.star)}"]`).forEach((b) => {
    const on = state.bookmarks.has(key);
    b.classList.toggle("on", on); b.textContent = on ? "★ 已收藏" : "☆ 收藏";
  });
  if ($("#view-saved").classList.contains("active")) renderSaved();
}

$$("#saved-filter button").forEach((b) => b.addEventListener("click", () => {
  $$("#saved-filter button").forEach((x) => x.classList.toggle("on", x === b));
  state.savedFilter = b.dataset.v; renderSaved();
}));

async function renderSaved() {
  const list = (await loadBookmarks()).filter((b) => !state.savedFilter || b.kind === state.savedFilter);
  const label = { article: "条文", law: "法规", case: "案例", ref: "实务资料", answer: "AI 回答" };
  $("#saved-list").innerHTML = list.length ? list.map((b) => `<li data-kind="${esc(b.kind)}" data-id="${esc(b.ref_id)}">
    <div class="r-title">${esc(b.title)}</div>
    <div class="r-meta"><span class="badge">${label[b.kind] || b.kind}</span>${b.subtitle ? `<span class="badge">${esc(b.subtitle)}</span>` : ""}<span class="badge">${new Date(b.created * 1000).toLocaleDateString("zh-CN")}</span></div>
    ${b.note ? `<div class="d-note">${esc(b.note)}</div>` : ""}<div class="r-snip">${esc(b.snippet)}</div></li>`).join("")
    : `<p class="muted">还没有收藏。在检索结果或 AI 回答里点「☆ 收藏」。</p>`;
}
$("#saved-list").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  $$("#saved-list li").forEach((x) => x.classList.toggle("sel", x === li));
  openItem(li.dataset.kind, li.dataset.id, $("#saved-detail"));
});

/* ---------- Markdown 与引用 ---------- */
const CITE_LABEL = { art: "条文", law: "法规", case: "案例", ref: "资料" };
function inline(s) {
  return s
    .replace(/\[\[(art|law|case|ref):([^\]]+?)\]\]/g, (_, k, id) => {
      const short = k === "art" ? (id.split(":").pop()) : k === "case" ? id.replace(/^GC/, "指导案例") : CITE_LABEL[k];
      return `<button class="cite" data-cite="${k}|${id}" title="${CITE_LABEL[k]} ${id}">${short}</button>`;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
function renderMD(md) {
  const lines = esc(md || "").split("\n");
  let html = "", list = null, table = [];
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
    html += "<table>" + rows.map((r, i) => "<tr>" + r.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => i === 0 ? `<th>${inline(c.trim())}</th>` : `<td>${inline(c.trim())}</td>`).join("") + "</tr>").join("") + "</table>";
    table = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) { flushList(); table.push(line); continue; }
    flushTable();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushList(); const lv = Math.min(4, Math.max(2, m[1].length)); html += `<h${lv}>${inline(m[2])}</h${lv}>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (list !== "ul") { flushList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.、]\s+(.*)$/))) { if (list !== "ol") { flushList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) { flushList(); }
    else if (/^-{3,}$/.test(line.trim())) { flushList(); html += "<hr>"; }
    else { flushList(); html += `<p>${inline(line)}</p>`; }
  }
  flushList(); flushTable();
  return html;
}
function bindCites(root) {
  $$("[data-cite]", root).forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = "1";
    b.addEventListener("click", () => {
      const [k, id] = b.dataset.cite.split("|");
      const kind = { art: "article", law: "law", case: "case", ref: "ref" }[k];
      const pane = root.closest(".view").querySelector(".pane-right");
      openItem(kind, id, pane);
    });
  });
}

/* ---------- AI 问答 ---------- */
$$(".ex").forEach((b) => b.addEventListener("click", () => { $("#question").value = b.textContent; $("#question").focus(); }));
$("#question").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#ask-form").requestSubmit(); }
});
$("#new-chat").addEventListener("click", () => {
  if (state.conversationId) api(`/api/conversation/${state.conversationId}`, { method: "DELETE" }).catch(() => {});
  state.conversationId = null;
  $("#chat-log").innerHTML = "";
  $("#question").focus();
});
$("#ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = $("#question").value.trim();
  if (!question || state.asking) return;
  state.asking = true; $("#ask-btn").disabled = true; $("#question").value = "";
  $(".chat-intro")?.remove();
  const log = $("#chat-log");
  log.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(question)}</div>`);
  const box = document.createElement("div");
  box.className = "msg ai";
  box.innerHTML = `<div class="steps running"><div>理解问题</div></div><div class="md"></div><div class="msg-actions"></div>`;
  log.appendChild(box);
  log.scrollTop = log.scrollHeight;
  let text = "", answerId = null;
  try {
    const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, region: $("#ask-region").value, conversation_id: state.conversationId }) });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!chunk.startsWith("data: ")) continue;
        const ev = JSON.parse(chunk.slice(6));
        if (ev.type === "step") $(".steps", box).insertAdjacentHTML("beforeend", `<div>${esc(ev.text)}</div>`);
        else if (ev.type === "text") { text += ev.delta; $(".md", box).innerHTML = renderMD(text); }
        else if (ev.type === "text_reset") { text = ""; $(".md", box).innerHTML = ""; }
        else if (ev.type === "error") $(".md", box).insertAdjacentHTML("beforeend", `<p class="err">${esc(ev.message)}</p>`);
        else if (ev.type === "done") { answerId = ev.answer_id; state.conversationId = ev.conversation_id; }
        const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
        if (nearBottom) log.scrollTop = log.scrollHeight;
      }
    }
  } catch (err) {
    $(".md", box).insertAdjacentHTML("beforeend", `<p class="err">连接出错：${esc(err.message)}</p>`);
  }
  $(".steps", box).classList.remove("running");
  const steps = $$(".steps div", box);
  if (steps.length > 1) { steps[0].remove(); $(".steps", box).insertAdjacentHTML("afterbegin", `<div>共检索 ${steps.length - 1} 次</div>`); }
  bindCites(box);
  if (answerId) {
    const acts = $(".msg-actions", box);
    acts.innerHTML = starBtn("answer", answerId) + `<button class="ghost" data-copy>复制</button>`;
    const it = { kind: "answer", id: answerId, question, answer: text };
    $("[data-star]", acts).addEventListener("click", (ev) => toggleBookmark(ev.currentTarget, it));
    $("[data-copy]", acts).addEventListener("click", () => navigator.clipboard.writeText(text.replace(/\[\[(art|law|case|ref):[^\]]+\]\]/g, "")));
  }
  state.asking = false; $("#ask-btn").disabled = false; $("#question").focus();
});

/* ---------- 设置 ---------- */
$("#open-settings").addEventListener("click", async () => {
  const s = await api("/api/settings");
  const f = $("#settings-form");
  for (const k of ["provider", "base_url", "api_key", "model", "effort"]) f.elements[k].value = s[k] ?? "";
  f.elements.extra_headers.value = s.extra_headers && Object.keys(s.extra_headers).length ? JSON.stringify(s.extra_headers, null, 2) : "";
  $("#settings").showModal();
});
$("#save-settings").addEventListener("click", async (e) => {
  e.preventDefault();
  const f = $("#settings-form");
  let headers = {};
  if (f.elements.extra_headers.value.trim()) {
    try { headers = JSON.parse(f.elements.extra_headers.value); } catch { alert("附加请求头不是有效的 JSON"); return; }
  }
  await api("/api/settings", { method: "POST", body: JSON.stringify({
    provider: f.elements.provider.value, base_url: f.elements.base_url.value.trim(), api_key: f.elements.api_key.value.trim(),
    model: f.elements.model.value.trim(), effort: f.elements.effort.value, extra_headers: headers }) });
  $("#settings").close();
  $("#open-settings").classList.replace("primary", "ghost");
});

init().catch((err) => { $("#db-stats").textContent = "初始化失败：" + err.message; });
