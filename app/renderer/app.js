"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  type: "all", q: "", offset: 0, selected: null,
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
  state.meta = m;
  const c = m.counts || {};
  const o = m.official || {};
  $("#db-stats").textContent = `本地资料：法律 ${c["法律"] || 0} 部 · 司法解释 ${c["司法解释"] || 0} 件 · 行政法规 ${c["行政法规"] || 0} 部 · 地方性法规 ${c["地方性法规"] || 0} 部 · 现行条文 ${m.articles} 条 · 指导性案例 ${m.cases} 件。其中已与官方网站核对：法律 ${o["法律"] || 0} 部、行政法规 ${o["行政法规"] || 0} 部、司法解释 ${o["司法解释"] || 0} 件。数据包 ${state.app?.data?.version || ""}${m.official_checked ? "，官方核对于 " + m.official_checked : ""}。`;
  if (!m.configured) $("#open-settings").classList.replace("ghost", "primary");
  await loadBookmarks();
  initBrowse();
  loadModels();
  pollUpdates();
}

/* ---------- 检索 ---------- */
$("#search-form").addEventListener("submit", (e) => { e.preventDefault(); runSearch(true); });
$$("#f-type button").forEach((b) => b.addEventListener("click", () => {
  $$("#f-type button").forEach((x) => x.classList.toggle("on", x === b));
  state.type = b.dataset.v;
  $(".law-only").style.display = state.type === "all" ? "" : "none";
  $("#q").placeholder = { all: "法规名称或关键词，例如：商标法、劳动合同 解除 经济补偿", cases: "输入关键词，例如：商标 近似 混淆", refs: "输入关键词，例如：经济补偿 计算" }[state.type];
  if ($("#q").value.trim()) runSearch(true);
}));
["#f-level", "#f-province", "#f-topic"].forEach((s) => $(s).addEventListener("change", () => $("#q").value.trim() && runSearch(true)));
$("#more").addEventListener("click", () => runSearch(false));

async function runSearch(reset) {
  const q = $("#q").value.trim();
  if (!q) return;
  if (reset) { state.offset = 0; $("#results").innerHTML = ""; }
  state.q = q;
  const p = new URLSearchParams({ q, type: state.type, offset: state.offset, limit: 20,
    level: $("#f-level").value, province: $("#f-province").value, topic: $("#f-topic").value });
  $("#result-info").textContent = "检索中…";
  try {
    const t0 = performance.now();
    const res = await api("/api/search?" + p);
    state.offset += res.items.length;
    let html = res.items.map(resultHTML).join("");
    if (reset && res.title_hits) {
      const parts = res.items.map(resultHTML);
      html = `<li class="group">名称匹配的法规</li>${parts.slice(0, res.title_hits).join("")}` +
        (parts.length > res.title_hits ? `<li class="group">内容匹配的条文</li>${parts.slice(res.title_hits).join("")}` : "");
    }
    $("#results").insertAdjacentHTML("beforeend", html);
    $("#more").hidden = !res.more;
    const n = $$("#results li:not(.group)").length;
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
  if (it.kind === "ref") { title = esc(it.title) + (it.heading ? ` · ${esc(it.heading.slice(0, 40))}` : ""); meta = `<span class="badge">${it.ref_kind === "处理流程" ? "流程" : "要点"}</span>`; }
  return `<li data-key="${esc(key)}"><div class="r-title">${title}</div><div class="r-meta">${meta}</div><div class="r-snip">${highlight(it.snippet || "", state.q)}</div></li>`;
}

$("#results").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li || li.classList.contains("group")) return;
  $$("#results li").forEach((x) => x.classList.toggle("sel", x === li));
  const [kind, id] = li.dataset.key.split("|");
  openItem(kind, id, $("#detail"));
});

/* ---------- 详情（阅读视图） ---------- */
async function openItem(kind, id, target, highlightArticle, nav) {
  target.innerHTML = `<div class="empty">加载中…</div>`;
  try {
    const it = await api(`/api/item/${kind}/${encodeURIComponent(id)}`);
    target.innerHTML = navHTML(nav) + detailHTML(it, highlightArticle) + navHTML(nav, true);
    target.scrollTop = 0;
    const hl = $(".rd-art.hl", target);
    if (hl) hl.scrollIntoView({ block: "center" });
    bindDetail(target, it);
    if (nav) $$("[data-nav]", target).forEach((b) => b.addEventListener("click", () => nav.go(Number(b.dataset.nav))));
  } catch (err) { target.innerHTML = `<div class="empty err">${esc(err.message)}</div>`; }
}

function navHTML(nav, bottom) {
  if (!nav) return "";
  const unit = nav.unit || "部";
  return `<div class="rd-nav ${bottom ? "bottom" : ""}"><button class="ghost" data-nav="-1" ${nav.index <= 0 ? "disabled" : ""}>‹ 上一${unit}</button>
    <span class="muted small">${nav.index + 1} / ${nav.total}</span>
    <button class="ghost" data-nav="1" ${nav.index >= nav.total - 1 ? "disabled" : ""}>下一${unit} ›</button></div>`;
}

function starBtn(kind, id) {
  const on = state.bookmarks.has(`${kind}:${id}`);
  return `<button class="ghost star ${on ? "on" : ""}" data-star="${esc(kind)}|${esc(id)}">${on ? "★ 已收藏" : "☆ 收藏"}</button>`;
}

const ART_HEAD = /^(第[零〇一二三四五六七八九十百千]+条(?:之[零〇一二三四五六七八九十百千]+)?)[\s　]*/;
function articleHTML(a, hl) {
  const m = a.text.match(ART_HEAD);
  const no = m ? m[1] : (a.article_cn && a.article_cn !== "全文" ? a.article_cn : "");
  const paras = (m ? a.text.slice(m[0].length) : a.text).split("\n").filter((x) => x.trim());
  const body = paras.map((p, i) => `<p>${i === 0 && no ? `<span class="rd-no">${esc(no)}</span>` : ""}${esc(p.trim())}</p>`).join("");
  return `<div class="rd-art ${hl ? "hl" : ""}" data-art="${esc(a.id)}">${body}</div>`;
}

function headHTML(kicker, title, meta, actions) {
  return `<header class="rd-head"><div class="rd-kicker">${kicker}</div><h1>${title}</h1>
    <div class="r-meta">${meta}</div><div class="rd-actions">${actions}</div></header>`;
}

const kickerOf = (it) => esc([it.level, it.province && it.province !== "全国" ? it.province : ""].filter(Boolean).join(" · "));

function detailHTML(it, hlArticle) {
  if (it.kind === "article") {
    return `<article class="reader">${headHTML(kickerOf(it), esc(it.title),
      badges(it) + (it.effective_date ? `<span class="badge">${esc(it.effective_date)} 起施行</span>` : ""),
      `${starBtn("article", it.id)}<button class="ghost" data-open-law="${esc(it.doc_id)}" data-hl="${esc(it.id)}">读整部法规</button>`)}
      ${it.note ? `<div class="d-note">${esc(it.note)}</div>` : ""}
      ${it.chapter ? `<h3 class="rd-ch">${esc(it.chapter)}</h3>` : ""}
      <div class="rd-body">${articleHTML({ id: it.id, article_cn: it.article, text: it.text })}</div>
      ${srcLine(it)}</article>`;
  }
  if (it.kind === "law") {
    let lastCh = null, lastSec = null, chIdx = 0;
    const toc = [];
    const arts = it.articles.map((a) => {
      let h = "";
      if (a.chapter && a.chapter !== lastCh) {
        chIdx++;
        toc.push({ id: `ch-${chIdx}`, label: a.chapter });
        h += `<h3 class="rd-ch" id="ch-${chIdx}">${esc(a.chapter)}</h3>`;
        lastCh = a.chapter;
        lastSec = null;
      }
      if (a.section && a.section !== lastSec) { h += `<h4 class="rd-sec">${esc(a.section)}</h4>`; lastSec = a.section; }
      return h + articleHTML(a, a.id === hlArticle);
    }).join("");
    const versions = (it.other_versions || []).map((v) => `<span class="ver"><button class="cite" data-open-law="${esc(v.id)}">${esc(v.version_date || "")} ${esc(v.status)}</button><button class="cite" data-compare="${esc(it.id)}|${esc(v.id)}" title="逐条对比这两个版本">对比</button></span>`).join(" ");
    const tocHTML = toc.length > 1 ? `<nav class="rd-toc"><div class="rd-toc-title">目录</div>${toc.map((t) => `<a href="#" data-jump="${t.id}">${esc(t.label)}</a>`).join("")}</nav>` : "";
    const meta = badges(it) + (it.version_date ? `<span class="badge">${esc(it.version_date)}</span>` : "")
      + (it.effective_date ? `<span class="badge">${esc(it.effective_date)} 起施行</span>` : "")
      + `<span class="badge">${it.n_articles || it.articles.length} 条</span>`;
    return `<article class="reader">${headHTML(kickerOf(it), esc(it.title), meta, starBtn("law", it.id))}
      ${it.note ? `<div class="d-note">${esc(it.note)}</div>` : ""}
      ${it.history ? `<p class="rd-history">（${esc(it.history.replace(/^[（(]|[)）]$/g, ""))}）</p>` : ""}
      ${versions ? `<p class="small rd-versions">其他版本：${versions}</p>` : ""}
      ${tocHTML}
      <div class="rd-body">${arts}</div>${srcLine(it)}</article>`;
  }
  if (it.kind === "case") {
    const para = (v) => v.split("\n").filter((x) => x.trim()).map((x) => `<p>${esc(x.trim())}</p>`).join("");
    const sec = [["关键词", it.keywords], ["裁判要点", it.points], ["相关法条", it.laws], ["基本案情", it.facts], ["裁判结果", it.result], ["裁判理由", it.reasoning]]
      .filter(([, v]) => v).map(([k, v]) => `<h3 class="rd-ch left">${k}</h3><div class="rd-prose">${para(v)}</div>`).join("");
    const title = it.title.replace(/^指导性?案例\s*\d+\s*号[：:\s]*/, "") || it.title;
    return `<article class="reader">${headHTML("最高人民法院指导性案例" + (it.number ? ` · 第 ${it.number} 号` : ""), esc(title), "", starBtn("case", it.id))}
      ${sec || `<div class="rd-prose">${para(it.text)}</div>`}
      <p class="d-src small muted src-line">来源：<a href="${esc(it.url)}" target="_blank" rel="noopener">最高人民法院</a></p></article>`;
  }
  if (it.kind === "ref") {
    const kindLabel = it.kind_label === "流程" || it.kind_label === "处理流程" ? "工作流程" : "实务要点";
    return `<article class="reader">${headHTML(`办案指引 · ${esc(it.plugin_label || it.plugin)} · ${kindLabel}`, esc(it.title), it.summary ? `<span class="rd-summary">${esc(it.summary)}</span>` : "", starBtn("ref", it.id))}
      <div class="md rd-prose">${renderMD(it.text.replace(/^#\s+.*\n/, ""))}</div>
      <p class="muted small src-line">办案指引是本项目整理的实务方法，只读，不具有法律效力；引用的法规以本 app 里的法规正文为准。</p></article>`;
  }
  if (it.kind === "answer") {
    const meta = (it.region ? `<span class="badge">${esc(it.region)}</span>` : "") + `<span class="badge">${esc(it.model)}</span><span class="badge">${new Date(it.created * 1000).toLocaleString("zh-CN")}</span>`;
    return `<article class="reader">${headHTML("AI 回答", esc(it.question), meta, starBtn("answer", it.id))}
      <div class="md rd-prose">${renderMD(it.answer)}</div></article>`;
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
  $$("[data-jump]", target).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $("#" + a.dataset.jump, target)?.scrollIntoView({ block: "start", behavior: "smooth" }); }));
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
  const label = { article: "条文", law: "法规", case: "案例", ref: "办案指引", answer: "AI 回答" };
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
  let code = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      if (code === null) { flushList(); flushTable(); code = []; } else { html += `<pre class="code">${code.join("\n")}</pre>`; code = null; }
      continue;
    }
    if (code !== null) { code.push(raw); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { flushList(); table.push(line); continue; }
    const q = line.match(/^&gt;\s?(.*)$/);
    if (q) { flushList(); flushTable(); html += `<blockquote>${inline(q[1])}</blockquote>`; continue; }
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
      body: JSON.stringify({ question, region: $("#ask-region").value, model: $("#ask-model").value, depth: $("#ask-depth").value, conversation_id: state.conversationId }) });
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
  f.elements.base_url.value = s.base_url || "";
  f.elements.api_key.value = s.api_key || "";
  f.elements.auto_update.checked = s.auto_update !== false;
  f.elements.update_interval_days.value = String(s.update_interval_days || 7);
  $("#models-status").textContent = "";
  $("#model-list").hidden = true;
  $("#settings").showModal();
});

async function saveSettings() {
  const f = $("#settings-form");
  await api("/api/settings", { method: "POST", body: JSON.stringify({
    base_url: f.elements.base_url.value.trim(), api_key: f.elements.api_key.value.trim(),
    auto_update: f.elements.auto_update.checked, update_interval_days: Number(f.elements.update_interval_days.value) }) });
}

$("#test-models").addEventListener("click", async () => {
  $("#models-status").textContent = "连接中…";
  await saveSettings();
  const r = await api("/api/models?refresh=1");
  if (r.error) { $("#models-status").textContent = r.error; $("#model-list").hidden = true; return; }
  $("#models-status").textContent = `已连接，可用模型 ${r.models.length} 个`;
  $("#model-list").innerHTML = r.models.map((m) => `<li>${esc(m)}</li>`).join("");
  $("#model-list").hidden = false;
  fillModels(r);
});

$("#save-settings").addEventListener("click", async (e) => {
  e.preventDefault();
  await saveSettings();
  $("#settings").close();
  const r = await loadModels();
  $("#open-settings").classList.replace(r.models?.length ? "primary" : "ghost", r.models?.length ? "ghost" : "primary");
});

/* ---------- 模型清单（AI 问答输入框下方） ---------- */
function fillModels(r) {
  const sel = $("#ask-model");
  if (!r.models?.length) {
    sel.innerHTML = `<option value="">${r.error ? "模型：未连接" : "模型：请先在设置里填 key"}</option>`;
    return;
  }
  const keep = sel.value || r.model;
  sel.innerHTML = r.models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  sel.value = r.models.includes(keep) ? keep : r.models[0];
  if (r.depth) $("#ask-depth").value = r.depth;
}
async function loadModels() {
  try { const r = await api("/api/models"); fillModels(r); return r; }
  catch (err) { fillModels({ error: err.message }); return {}; }
}

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
  if (confirm("全面核对会把三个官方网站上的全部法律、行政法规和司法解释逐部重新读一遍，和本地文本逐条比对，约 30 分钟，期间可以照常使用。开始吗？")) runUpdate("full");
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
  if (s.running) $("#upd-progress-text").textContent = `${s.mode === "full" ? "全面核对" : "检查新发布"}：${s.phase || ""} · 已看 ${s.checked} 条，已读取 ${s.fetched} 份，发现变化 ${s.changes} 处${s.errors ? `，出错 ${s.errors}` : ""}${s.current ? " · " + s.current : ""}`;
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
  }).join("") : `<p class="muted">${r.items.length ? "这一类没有记录。" : "还没有更新记录。点「检查新发布」看看官方网站有没有新公布的法规。"}</p>`;
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

/* ---------- 浏览（目录） ---------- */
const LEVEL_NAMES = ["法律", "司法解释", "行政法规", "监察法规", "地方性法规"];
state.browse = { kind: "laws", items: [], total: 0, offset: 0, index: -1 };

async function initBrowse() {
  ["#b-level", "#b-province", "#b-topic", "#b-sort"].forEach((sel) => $(sel).addEventListener("change", () => {
    if (sel === "#b-level" && $("#b-level").value !== "地方性法规" && $("#b-level").value) $("#b-province").value = "";
    loadBrowse(true);
  }));
  $$("#b-kind button").forEach((b) => b.addEventListener("click", () => {
    $$("#b-kind button").forEach((x) => x.classList.toggle("on", x === b));
    state.browse.kind = b.dataset.v;
    $("#b-law-filters").hidden = b.dataset.v !== "laws";
    loadBrowse(true);
  }));
  $("#b-more").addEventListener("click", () => loadBrowse(false));
  $("#b-list").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) openBrowseItem(Number(li.dataset.i));
  });
  await loadBrowse(true);
}

async function refreshFacets() {
  const p = new URLSearchParams({ level: $("#b-level").value, province: $("#b-province").value, topic: $("#b-topic").value });
  const f = await api("/api/browse/facets?" + p);
  const keep = { level: $("#b-level").value, province: $("#b-province").value, topic: $("#b-topic").value };
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  $("#b-level").innerHTML = `<option value="">全部层级（${total(f.levels)}）</option>` +
    LEVEL_NAMES.filter((l) => f.levels[l]).map((l) => `<option value="${l}">${l}（${f.levels[l]}）</option>`).join("");
  const provs = Object.entries(f.provinces).filter(([k]) => k !== "全国" && k !== "其他").sort((a, b) => b[1] - a[1]);
  $("#b-province").innerHTML = `<option value="">全部地区</option>` + (f.provinces["全国"] ? `<option value="全国">全国性规定（${f.provinces["全国"]}）</option>` : "") +
    provs.map(([k, n]) => `<option value="${esc(k)}">${esc(k)}（${n}）</option>`).join("") +
    (f.provinces["其他"] ? `<option value="其他">地区未识别（${f.provinces["其他"]}）</option>` : "");
  const topics = Object.entries(f.topics).sort((a, b) => b[1] - a[1]);
  $("#b-topic").innerHTML = `<option value="">全部领域</option>` + topics.map(([k, n]) => `<option value="${esc(k)}">${esc(k)}（${n}）</option>`).join("");
  $("#b-level").value = keep.level; $("#b-province").value = keep.province; $("#b-topic").value = keep.topic;
}

async function loadBrowse(reset) {
  const b = state.browse;
  if (reset) { b.items = []; b.offset = 0; $("#b-list").innerHTML = ""; }
  $("#b-info").textContent = "加载中…";
  if (b.kind === "laws") {
    if (reset) await refreshFacets();
    const p = new URLSearchParams({ level: $("#b-level").value, province: $("#b-province").value, topic: $("#b-topic").value, sort: $("#b-sort").value, offset: b.offset, limit: 300 });
    const r = await api("/api/browse/laws?" + p);
    b.total = r.total;
    appendBrowse(r.items.map((x) => ({ ...x, kind: "law" })));
    $("#b-info").textContent = `共 ${r.total} 部现行法规${r.total > b.items.length ? `，已列出 ${b.items.length} 部` : ""}。点开即可从头读到尾，阅读时可以用「上一部 / 下一部」顺序翻。`;
    $("#b-more").hidden = b.items.length >= r.total;
  } else if (b.kind === "cases") {
    const r = await api("/api/browse/cases?limit=500");
    b.total = r.total;
    appendBrowse(r.items);
    $("#b-info").textContent = `最高人民法院指导性案例共 ${r.total} 件，按编号排列。`;
    $("#b-more").hidden = true;
  } else {
    const groups = await api("/api/browse/guides");
    const flat = [];
    let html = "";
    for (const g of groups) {
      html += `<li class="group">${esc(g.label)}（${g.items.length}）</li>`;
      for (const it of g.items) {
        html += itemLI({ ...it, kind: "ref" }, flat.length);
        flat.push({ ...it, kind: "ref" });
      }
    }
    b.items = flat; b.total = flat.length;
    $("#b-list").innerHTML = html;
    $("#b-info").textContent = `办案指引共 ${flat.length} 篇，按领域分组：「要点」是实务规则和审查清单，「流程」是一类事务的处理步骤。内容只读，随 app 更新。`;
    $("#b-more").hidden = true;
  }
}

function itemLI(it, i) {
  let meta = "";
  if (it.kind === "law") {
    meta = `<span class="badge">${esc(it.level)}</span>` + (it.province && it.province !== "全国" ? `<span class="badge">${esc(it.province)}</span>` : "")
      + (it.status === "尚未生效" ? `<span class="badge pending">尚未生效</span>` : "") + (it.official ? `<span class="badge off">官方全文</span>` : "")
      + (it.version_date ? `<span class="badge">${esc(it.version_date)}</span>` : "");
  } else if (it.kind === "case") {
    meta = `<span class="badge">第 ${it.number} 号</span>` + (it.keywords ? `<span class="badge">${esc(it.keywords.replace(/\s+/g, " ").slice(0, 36))}</span>` : "");
  } else {
    meta = `<span class="badge">${esc(it.kind_label || "")}</span>`;
  }
  const title = it.kind === "case" ? it.title.replace(/^指导性?案例\s*\d+\s*号[：:\s]*/, "") || it.title : it.title;
  return `<li data-i="${i}"><div class="r-title">${esc(title)}</div><div class="r-meta">${meta}</div></li>`;
}

function appendBrowse(items) {
  const b = state.browse;
  const start = b.items.length;
  b.items.push(...items);
  b.offset = b.items.length;
  $("#b-list").insertAdjacentHTML("beforeend", items.map((it, k) => itemLI(it, start + k)).join(""));
}

function openBrowseItem(i) {
  const b = state.browse;
  if (i < 0 || i >= b.items.length) return;
  b.index = i;
  const it = b.items[i];
  $$("#b-list li").forEach((x) => x.classList.toggle("sel", Number(x.dataset.i) === i));
  $(`#b-list li[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  const unit = it.kind === "case" ? "件" : it.kind === "ref" ? "篇" : "部";
  openItem(it.kind, it.id, $("#b-detail"), null, {
    index: i, total: b.kind === "laws" ? b.total : b.items.length, unit,
    go: async (d) => {
      if (i + d >= b.items.length && b.items.length < b.total) await loadBrowse(false);
      openBrowseItem(i + d);
    },
  });
}

/* ---------- 浅色 / 深色 ---------- */
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  $("#theme").textContent = t === "dark" ? "☾" : t === "light" ? "☀" : "◐";
  $("#theme").title = { dark: "深色（点击切换为跟随系统）", light: "浅色（点击切换为深色）" }[t] || "跟随系统（点击切换为浅色）";
}
let theme = "";
try { theme = localStorage.getItem("theme") || ""; } catch { /* 无痕模式等情况 */ }
applyTheme(theme);
$("#theme").addEventListener("click", () => {
  theme = theme === "" ? "light" : theme === "light" ? "dark" : "";
  try { localStorage.setItem("theme", theme); } catch { /* 忽略 */ }
  applyTheme(theme);
});

init().catch((err) => { $("#db-stats").textContent = "初始化失败：" + err.message; });
