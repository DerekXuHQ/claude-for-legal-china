"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  type: "articles", q: "", offset: 0, selected: null,
  bookmarks: new Map(), // "kind:ref_id" -> bookmark
  conversationId: null, asking: false, savedFilter: "",
};

const TOKEN = new URLSearchParams(location.hash.slice(1)).get("t") || "";
const HEADERS = { "Content-Type": "application/json", "X-App-Token": TOKEN };
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: HEADERS, ...opts });
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
  if (v === "updates") { renderUpdates(); $("#upd-dot").hidden = true; }
}

/* ---------- 初始化 ---------- */
async function waitReady() {
  for (;;) {
    const st = await api("/api/status");
    if (st.ready) { $("#setup").hidden = true; return st; }
    $("#setup").hidden = false;
    $("#setup-bar").style.width = Math.round((st.progress || 0) * 100) + "%";
    $("#setup-phase").textContent = `${st.phase || "准备中"}… ${Math.round((st.progress || 0) * 100)}%`;
    if (st.error) { $("#setup-error").hidden = false; $("#setup-error").textContent = st.error; return null; }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function init() {
  const st = await waitReady();
  if (!st) return;
  state.app = st.app;
  const m = await api("/api/meta");
  for (const l of m.levels) $("#f-level").insertAdjacentHTML("beforeend", `<option>${esc(l)}</option>`);
  for (const p of m.provinces) {
    $("#f-province").insertAdjacentHTML("beforeend", `<option>${esc(p)}</option>`);
    $("#ask-region").insertAdjacentHTML("beforeend", `<option>${esc(p)}</option>`);
  }
  for (const t of m.topics || []) $("#f-topic").insertAdjacentHTML("beforeend", `<option>${esc(t)}</option>`);
  const c = m.counts || {};
  const o = m.official || {};
  $("#db-stats").textContent = `本地资料：法律 ${c["法律"] || 0} 部 · 司法解释 ${c["司法解释"] || 0} 件 · 行政法规 ${c["行政法规"] || 0} 部 · 地方性法规 ${c["地方性法规"] || 0} 部 · 现行条文 ${m.articles} 条 · 指导性案例 ${m.cases} 件 · 实务资料 ${m.refs} 段。其中已与官方网站核对：法律 ${o["法律"] || 0} 部、行政法规 ${o["行政法规"] || 0} 部、司法解释 ${o["司法解释"] || 0} 件。数据包 ${state.app?.data?.version || ""}${m.official_checked ? "，官方核对于 " + m.official_checked : ""}。`;
  if (!m.configured) $("#open-settings").classList.replace("ghost", "primary");
  await loadBookmarks();
  pollUpdates();
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
  if (it.official) out.push(`<span class="badge off" title="已与官方网站公布的全文核对">官方全文</span>`);
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
      <div class="r-meta">${badges(it)}${it.chapter ? `<span class="badge">${esc(it.chapter)}</span>` : ""}${it.effective_date ? `<span class="badge">${esc(it.effective_date)} 起施行</span>` : ""}</div></div>
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
    const versions = (it.other_versions || []).map((v) => `<span class="ver"><button class="cite" data-open-law="${esc(v.id)}">${esc(v.version_date || "")} ${esc(v.status)}</button><button class="cite" data-compare="${esc(it.id)}|${esc(v.id)}" title="逐条对比这两个版本">对比</button></span>`).join(" ");
    return `<div class="d-head"><div><h2>${esc(it.title)}</h2>
      <div class="r-meta">${badges(it)}${it.version_date ? `<span class="badge">${esc(it.version_date)}</span>` : ""}${it.effective_date ? `<span class="badge">${esc(it.effective_date)} 起施行</span>` : ""}${it.issuer ? `<span class="badge">${esc(it.issuer)}</span>` : ""}</div></div>
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
  if (!src) return "";
  const link = it.source_url ? `<a href="${esc(it.source_url)}" target="_blank" rel="noopener">${esc(src)}</a>` : esc(src);
  const note = it.official
    ? `已与官方网站公布的全文核对${it.checked_at ? "（" + esc(it.checked_at) + "）" : ""}。`
    : "国家法律法规数据库文本，经 CC0 数据集快照（2026-08-26）获取；尚未与官方网站逐条核对，引用前以官方文本为准。";
  return `<p class="d-src small muted src-line">来源：${link}。${note}</p>`;
}

function bindDetail(target, it) {
  $$("[data-star]", target).forEach((b) => b.addEventListener("click", () => toggleBookmark(b, it)));
  $$("[data-open-law]", target).forEach((b) => b.addEventListener("click", () => openItem("law", b.dataset.openLaw, target, b.dataset.hl)));
  $$("[data-compare]", target).forEach((b) => b.addEventListener("click", () => { const [a, c] = b.dataset.compare.split("|"); openCompare(a, c, target); }));
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
    const res = await fetch("/api/ask", { method: "POST", headers: HEADERS,
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
  f.elements.auto_update.checked = s.auto_update !== false;
  f.elements.update_interval_days.value = String(s.update_interval_days || 7);
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
    model: f.elements.model.value.trim(), effort: f.elements.effort.value, extra_headers: headers,
    auto_update: f.elements.auto_update.checked, update_interval_days: Number(f.elements.update_interval_days.value) }) });
  $("#settings").close();
  $("#open-settings").classList.replace("primary", "ghost");
});

/* ---------- 版本对比 ---------- */
function charDiff(a, b) {
  // 简单的逐字对比（最长公共子序列），条文一般不长
  const A = [...a], B = [...b];
  if (A.length * B.length > 4e6) return { old: esc(a), new: esc(b) };
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, o = "", n = "";
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { o += esc(A[i]); n += esc(B[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { o += `<del>${esc(A[i++])}</del>`; }
    else { n += `<ins>${esc(B[j++])}</ins>`; }
  }
  while (i < A.length) o += `<del>${esc(A[i++])}</del>`;
  while (j < B.length) n += `<ins>${esc(B[j++])}</ins>`;
  return { old: o, new: n };
}

function diffHTML(d, oldLabel, newLabel) {
  const parts = [];
  parts.push(`<p class="small muted">旧版 ${d.old_count} 条，新版 ${d.new_count} 条：未改动 ${d.unchanged} 条${d.renumbered ? `（其中 ${d.renumbered} 条只是条号变了）` : ""}，修改 ${d.modified.length} 条，新增 ${d.added.length} 条，删除 ${d.removed.length} 条。</p>`);
  for (const m of d.modified) {
    const c = charDiff(m.old, m.new);
    parts.push(`<div class="diff-item"><h4>修改：${esc(m.old_cn)}${m.old_cn !== m.new_cn ? " → " + esc(m.new_cn) : ""}</h4><div class="diff-cols"><div class="diff-old"><b>${esc(oldLabel)}</b>\n${c.old}</div><div class="diff-new"><b>${esc(newLabel)}</b>\n${c.new}</div></div></div>`);
  }
  for (const m of d.added) parts.push(`<div class="diff-item"><h4>新增：${esc(m.new_cn)}</h4><div class="diff-new d-text">${esc(m.new)}</div></div>`);
  for (const m of d.removed) parts.push(`<div class="diff-item"><h4>删除：${esc(m.old_cn)}</h4><div class="diff-old d-text">${esc(m.old)}</div></div>`);
  return parts.join("");
}

async function openCompare(a, b, target) {
  target.innerHTML = `<div class="empty">对比中…</div>`;
  try {
    const r = await api(`/api/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    target.innerHTML = `<div class="d-head"><div><h2>${esc(r.new.title)}：版本对比</h2>
      <div class="r-meta"><span class="badge">旧版 ${esc(r.old.version_date)}</span><span class="badge">新版 ${esc(r.new.version_date)}</span></div></div>
      <div class="d-actions"><button class="ghost" data-open-law="${esc(r.new.id)}">看新版全文</button><button class="ghost" data-open-law="${esc(r.old.id)}">看旧版全文</button></div></div>
      ${diffHTML(r.diff, "旧版 " + r.old.version_date, "新版 " + r.new.version_date)}`;
    target.scrollTop = 0;
    $$("[data-open-law]", target).forEach((x) => x.addEventListener("click", () => openItem("law", x.dataset.openLaw, target)));
  } catch (err) { target.innerHTML = `<div class="empty err">${esc(err.message)}</div>`; }
}

/* ---------- 法规更新 ---------- */
const ACTION = {
  new_version: ["新版本", "new"], new: ["新增", "new"], text_corrected: ["文本更正", "pending"], promoted: ["开始施行", "cur"],
  case_new: ["新案例", "new"], error: ["出错", "old"], unparsed: ["未解析", "old"], blocked: ["网站拒绝访问", "old"],
};
const SOURCE = { npc: "中国人大网", moj: "国家行政法规库", court: "最高人民法院", cases: "指导性案例", local: "本地" };
state.updFilter = "";

$$("#upd-filter button").forEach((b) => b.addEventListener("click", () => {
  $$("#upd-filter button").forEach((x) => x.classList.toggle("on", x === b));
  state.updFilter = b.dataset.v; renderUpdates();
}));
$("#upd-run").addEventListener("click", () => runUpdate("incremental"));
$("#upd-full").addEventListener("click", () => {
  if (confirm("全面核对会逐部重新读取三个官方网站上的法律、行政法规和司法解释，约 30 分钟，期间可以正常使用。开始吗？")) runUpdate("full");
});
$("#upd-stop").addEventListener("click", () => api("/api/updates/stop", { method: "POST", body: "{}" }));

async function runUpdate(mode) {
  const r = await api("/api/updates/run", { method: "POST", body: JSON.stringify({ mode }) });
  if (!r.ok) alert(r.error || "无法开始");
  pollUpdates(true);
}

let pollTimer = null, wasRunning = false;
async function pollUpdates(force) {
  clearTimeout(pollTimer);
  try {
    const s = await api("/api/updates/status");
    showProgress(s);
    if (wasRunning && !s.running) {
      if ($("#view-updates").classList.contains("active")) renderUpdates();
      else if (s.last_result?.changes) $("#upd-dot").hidden = false;
    }
    wasRunning = s.running;
    pollTimer = setTimeout(pollUpdates, s.running ? 1500 : 30000);
  } catch { pollTimer = setTimeout(pollUpdates, 30000); }
}

function showProgress(s) {
  $("#upd-progress").hidden = !s.running;
  $("#upd-run").disabled = $("#upd-full").disabled = !!s.running;
  $("#upd-stop").hidden = !s.running;
  if (s.running) $("#upd-progress-text").textContent = `${s.mode === "full" ? "全面核对" : "检查更新"}：${s.phase || ""} · 已看 ${s.checked} 条，已读取 ${s.fetched} 份，发现变化 ${s.changes} 处${s.errors ? `，出错 ${s.errors}` : ""}${s.current ? " · " + s.current : ""}`;
}

async function renderUpdates() {
  const r = await api("/api/updates");
  showProgress(r.running);
  const last = r.last_check ? new Date(r.last_check).toLocaleString("zh-CN") : "还没有检查过";
  $("#upd-info").textContent = `上次检查：${last}。已核对一致 ${r.confirmed} 部。${state.app?.data?.official_checked ? `安装包数据已于 ${state.app.data.official_checked} 全面核对。` : ""}`;
  const items = r.items.filter((x) => !state.updFilter || x.action === state.updFilter);
  $("#upd-list").innerHTML = items.length ? items.map((x) => {
    const [label, cls] = ACTION[x.action] || [x.action, ""];
    return `<li data-upd="${x.id}"><div class="r-title">${esc(x.title)}</div>
      <div class="r-meta"><span class="badge ${cls}">${esc(label)}</span><span class="badge">${esc(SOURCE[x.source] || x.source)}</span><span class="badge">${esc(new Date(x.at).toLocaleDateString("zh-CN"))}</span></div>
      <div class="r-snip">${esc(x.summary)}</div></li>`;
  }).join("") : `<p class="muted">${r.items.length ? "这一类没有记录。" : "还没有更新记录。点「立即检查」看看官方网站有没有新公布的法规。"}</p>`;
}

$("#upd-list").addEventListener("click", async (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  $$("#upd-list li").forEach((x) => x.classList.toggle("sel", x === li));
  const target = $("#upd-detail");
  const x = await api(`/api/updates/${li.dataset.upd}`);
  if (x.action === "case_new" && x.doc_id) return openItem("case", x.doc_id, target);
  if (x.action === "new_version" && x.compare_to) return openCompare(x.doc_id, x.compare_to, target);
  if (x.action === "text_corrected" && x.diff) {
    target.innerHTML = `<div class="d-head"><div><h2>${esc(x.title)}</h2><div class="r-meta"><span class="badge pending">文本更正</span></div></div>
      <div class="d-actions"><button class="ghost" data-open-law="${esc(x.doc_id)}">看全文</button></div></div>
      <p class="small">本地文本与官方网站公布的全文有出入，已改用官方全文。左边是原来的文本，右边是官方全文：</p>
      ${diffHTML(x.diff, "原文本", "官方全文")}
      <p class="small muted src-line">官方页面：<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a></p>`;
    $$("[data-open-law]", target).forEach((b) => b.addEventListener("click", () => openItem("law", b.dataset.openLaw, target)));
    return;
  }
  if (x.doc_id && x.action !== "error") return openItem("law", x.doc_id, target);
  target.innerHTML = `<div class="d-head"><div><h2>${esc(x.title)}</h2></div></div><p>${esc(x.summary)}</p>${x.url ? `<p class="small"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a></p>` : ""}`;
});

init().catch((err) => { $("#db-stats").textContent = "初始化失败：" + err.message; });
