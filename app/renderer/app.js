"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (name, cls = "") => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
let toastTimer = null;
function toast(msg, ms = 4500) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

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
  document.body.dataset.view = v;
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
  if (v === "saved") renderSaved();
  // 第一次进法律助理：打开最近的事项；之后切回来保持原样（包括还没发消息的新事项页）
  if (v === "ask") { $("#question").focus(); if (!state.matter && !state.askOpened) { state.askOpened = true; loadMatters().then((l) => { if (state.matter || state.newMatterShown) return; l[0] ? openMatter(l[0].id) : renderMatter(null); }); } }
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
  renderRegionOptions();
  for (const t of m.topics || []) $("#f-topic").insertAdjacentHTML("beforeend", `<option>${esc(t)}</option>`);
  state.meta = m;
  const c = m.counts || {};
  const o = m.official || {};
  $("#db-stats").textContent = `本地资料：法律 ${c["法律"] || 0} 部 · 司法解释 ${c["司法解释"] || 0} 件 · 行政法规 ${c["行政法规"] || 0} 部 · 地方性法规 ${c["地方性法规"] || 0} 部 · 现行条文 ${m.articles} 条 · 指导性案例 ${m.cases} 件。其中已与官方网站核对：法律 ${o["法律"] || 0} 部、行政法规 ${o["行政法规"] || 0} 部、司法解释 ${o["司法解释"] || 0} 件。数据包 ${state.app?.data?.version || ""}${m.official_checked ? "，官方核对于 " + m.official_checked : ""}。`;
  $("#open-settings").classList.toggle("attn", !m.configured);
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
  if (it.kind === "case") meta = (it.note ? `<span class="badge old">不再参照</span>` : "") + (it.keywords ? `<span class="badge">${esc(it.keywords.slice(0, 40))}</span>` : "");
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
  return `<div class="rd-nav ${bottom ? "bottom" : ""}"><button class="ghost" data-nav="-1" ${nav.index <= 0 ? "disabled" : ""}>${ic("chevron-left")}上一${unit}</button>
    <span class="muted small">${nav.index + 1} / ${nav.total}</span>
    <button class="ghost" data-nav="1" ${nav.index >= nav.total - 1 ? "disabled" : ""}>下一${unit}${ic("chevron-right")}</button></div>`;
}

const starInner = (on) => `${ic(on ? "bookmark-fill" : "bookmark")}<span>${on ? "已收藏" : "收藏"}</span>`;
function starBtn(kind, id) {
  const on = state.bookmarks.has(`${kind}:${id}`);
  return `<button class="ghost star ${on ? "on" : ""}" data-star="${esc(kind)}|${esc(id)}">${starInner(on)}</button>`;
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
      `${starBtn("article", it.id)}<button class="ghost" data-open-law="${esc(it.doc_id)}" data-hl="${esc(it.id)}">${ic("book-open")}读整部法规</button>`)}
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
      ${it.note ? `<div class="d-note">${esc(it.note)}</div>` : ""}
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
    return `<article class="reader">${headHTML("法律助理产出", esc(it.question), meta, starBtn("answer", it.id))}
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
  if (it.kind === "answer") return { title: it.question, subtitle: "助理产出", snippet: it.answer.replace(/\[\[[^\]]+\]\]|[#*]/g, "").slice(0, 120) };
  return { title: it.id };
}

async function toggleBookmark(btn, it) {
  const [kind, id] = btn.dataset.star.split("|");
  const key = `${kind}:${id}`;
  if (state.bookmarks.has(key)) {
    await api(`/api/bookmarks/${state.bookmarks.get(key).id}`, { method: "DELETE" });
  } else {
    // 桌面版不支持 prompt()：先直接收藏，备注在「收藏」页里写
    await api("/api/bookmarks", { method: "POST", body: JSON.stringify({ kind, ref_id: id, note: "", ...bookmarkInfo(it) }) });
  }
  await loadBookmarks();
  $$(`[data-star="${CSS.escape(btn.dataset.star)}"]`).forEach((b) => {
    const on = state.bookmarks.has(key);
    b.classList.toggle("on", on);
    if (b.classList.contains("icon-btn")) { b.innerHTML = ic(on ? "bookmark-fill" : "bookmark"); b.title = on ? "取消收藏" : "收藏"; }
    else b.innerHTML = starInner(on);
  });
  if ($("#view-saved").classList.contains("active")) renderSaved();
}

$$("#saved-filter button").forEach((b) => b.addEventListener("click", () => {
  $$("#saved-filter button").forEach((x) => x.classList.toggle("on", x === b));
  state.savedFilter = b.dataset.v; renderSaved();
}));

async function renderSaved() {
  const list = (await loadBookmarks()).filter((b) => !state.savedFilter || b.kind === state.savedFilter);
  const label = { article: "条文", law: "法规", case: "案例", ref: "办案指引", answer: "助理产出" };
  $("#saved-list").innerHTML = list.length ? list.map((b) => `<li data-kind="${esc(b.kind)}" data-id="${esc(b.ref_id)}">
    <div class="r-title">${esc(b.title)}</div>
    <div class="r-meta"><span class="badge">${label[b.kind] || b.kind}</span>${b.subtitle && b.subtitle !== label[b.kind] ? `<span class="badge">${esc(b.subtitle)}</span>` : ""}<span class="badge">${new Date(b.created * 1000).toLocaleDateString("zh-CN")}</span></div>
    <div class="r-snip">${esc(b.snippet)}</div>
    <input class="bm-note" data-note="${esc(b.kind)}|${esc(b.ref_id)}" value="${esc(b.note || "")}" placeholder="写个备注（回车保存）"></li>`).join("")
    : `<p class="muted">还没有收藏。在阅读页或助理的回答下面点「收藏」。</p>`;
}
$("#saved-list").addEventListener("change", async (e) => {
  const inp = e.target.closest(".bm-note");
  if (!inp) return;
  const [kind, ref_id] = inp.dataset.note.split("|");
  await api("/api/bookmarks", { method: "POST", body: JSON.stringify({ kind, ref_id, note: inp.value.trim() }) });
  await loadBookmarks();
});
$("#saved-list").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest(".bm-note")) e.target.blur(); });
$("#saved-list").addEventListener("click", (e) => {
  if (e.target.closest(".bm-note")) return;
  const li = e.target.closest("li");
  if (!li) return;
  $$("#saved-list li").forEach((x) => x.classList.toggle("sel", x === li));
  openItem(li.dataset.kind, li.dataset.id, $("#saved-detail"));
});

/* ---------- Markdown 与引用 ---------- */
const CITE_LABEL = { art: "条文", law: "法规", case: "案例", ref: "资料" };
const CITE_ICON = { art: "book-open", law: "book-open", case: "gavel", ref: "file-text" };
function inline(s) {
  return s
    // 正文已经写了「第X条」时直接把这几个字变成链接，不再重复一个同名标签
    .replace(/(第[零〇一二三四五六七八九十百千]+条(?:之[零〇一二三四五六七八九十百千]+)?)\[\[art:([^\]]+?)\]\]/g, (all, label, id) =>
      id.split(":").pop() === label ? `<button class="cite-inline" data-cite="art|${id}" title="点开看原文：${id}">${label}</button>` : all)
    .replace(/\[\[(art|law|case|ref):([^\]]+?)\]\]/g, (_, k, id) => {
      const short = k === "art" ? (id.split(":").pop()) : k === "case" ? id.replace(/^GC/, "指导案例") : CITE_LABEL[k];
      return `<button class="cite" data-cite="${k}|${id}" title="点开看原文：${CITE_LABEL[k]} ${id}">${ic(CITE_ICON[k])}${short}</button>`;
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
    html += `<div class="table-wrap"><table>` + rows.map((r, i) => "<tr>" + r.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => i === 0 ? `<th>${inline(c.trim())}</th>` : `<td>${inline(c.trim())}</td>`).join("") + "</tr>").join("") + "</table></div>";
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
      if (pane.dataset.pane) setCollapsed(pane.dataset.pane, false);
      openItem(kind, id, pane);
    });
  });
}

/* ---------- 法律助理 ---------- */
state.matter = null;      // 当前事项
state.pendingFiles = [];  // 已上传、还没随消息发出的文件

// 首屏 12 个最常见的事（依据 docs/scenarios-research.md §5）；scenario 为空的交给助理按内容分到具体场景
const STARTERS = [
  { icon: "users", title: "员工离职要高额补偿", desc: "先看该不该给、给多少，再定怎么谈、要不要硬扛", scenario: "employee_claims_compensation", prompt: "员工离职（或被辞退）后要求补偿，情况是：" },
  { icon: "gavel", title: "收到劳动仲裁", desc: "答辩期限、每一项请求怎么应对、要不要调解", scenario: "labor_arbitration_respondent", prompt: "我们收到了劳动仲裁申请书（已上传）。", upload: true },
  { icon: "user-x", title: "想让一个员工走", desc: "能力不行或违纪，怎样合法、成本最低", scenario: "terminate_underperformer", prompt: "有个员工我想让他走，情况是：" },
  { icon: "file-search", title: "审一份合同", desc: "采购、销售、服务、租赁、经销……告诉我哪些必须改", scenario: "", prompt: "请帮我审查这份合同。我方是：", upload: true },
  { icon: "file-text", title: "把对方模板改成对我有利", desc: "逐条修改并写好给对方的修改理由", scenario: "redraft_counterparty_template", prompt: "这是对方发来的合同模板，请改成对我方有利的版本。我方是：", upload: true },
  { icon: "coins", title: "客户欠款不付", desc: "先发函、先保全还是直接起诉", scenario: "receivable_collection", prompt: "客户欠我们款项一直不付，情况是：" },
  { icon: "receipt", title: "顾客或家长要退费", desc: "会员卡、预付卡、学费，按规定该退多少", scenario: "", prompt: "顾客要求退费，情况是：" },
  { icon: "megaphone", title: "广告文案、促销合不合规", desc: "改成合规版本", scenario: "ad_copy_review", prompt: "请看看这段广告文案或促销活动有没有违法风险：" },
  { icon: "landmark", title: "收到监管通知或罚单", desc: "市场监管、税务、劳动监察：期限内该做什么", scenario: "", prompt: "我们收到了监管部门的通知（已上传）。", upload: true },
];
state.scenario = "";   // 新事项里选定的场景
let scenarioCat = null;
async function loadScenarioCat() { if (!scenarioCat) scenarioCat = await api("/api/scenarios").catch(() => ({ groups: [], scenarios: [], pipelines: {} })); return scenarioCat; }
function setScenario(id) {
  state.scenario = id || "";
  $$(".pk-card[data-sc]").forEach((r) => r.classList.toggle("on", r.dataset.sc === state.scenario));
  const q = $("#question");
  if (q.dataset.defaultPh == null) q.dataset.defaultPh = q.placeholder;
  const sc = scenarioCat?.scenarios.find((x) => x.id === id);
  const pill = $("#scenario-pill");
  pill.hidden = !sc;
  if (sc) {
    pill.innerHTML = `场景：<b>${esc(sc.name)}</b> · ${esc(scenarioCat.pipelines[sc.pipeline] || "")}<button type="button" title="取消，让助理自己判断">${ic("x")}</button>`;
    pill.querySelector("button").onclick = () => setScenario("");
    q.placeholder = sc.examples[0] ? `例如：${sc.examples[0]}` : q.dataset.defaultPh;
  } else q.placeholder = q.dataset.defaultPh;
}
// 新事项页的选择器：左边「常用 + 15 个领域」，右边是鼠标所在领域的全部场景。悬停就切换，点一下就开工。
function renderPicker(box) {
  const cat = scenarioCat;
  const groups = [{ key: "_common", name: "常用", count: STARTERS.length }, ...cat.groups.map((g) => ({ key: g.key, name: g.name.split(" / ")[0], count: cat.scenarios.filter((x) => x.group === g.key).length }))];
  let cur = state.scGroup && groups.some((g) => g.key === state.scGroup) ? state.scGroup : "_common";
  box.innerHTML = `<ul class="pk-groups">${groups.map((g) => `<li data-g="${esc(g.key)}" class="${g.key === cur ? "on" : ""}"><span>${esc(g.name)}</span><em>${g.count}</em></li>`).join("")}</ul><div class="pk-items"></div>`;
  const items = $(".pk-items", box);
  // 每种流程一个图标和短名，让人一眼看出点进去会做什么
  const PIPE = { P1: ["gavel", "应对争议"], P2: ["coins", "追讨维权"], P3: ["scale", "执行回款"], P4: ["users", "用工方案"], P5: ["file-search", "合同审查"], P6: ["file-text", "改写文本"], P7: ["pen", "从零起草"], P8: ["shield-check", "合规判断"], P9: ["landmark", "监管应对"], P10: ["alert", "刑事应急"], P11: ["book-open", "规定解读"], P12: ["list", "期限计算"], P13: ["flag", "制度搭建"] };
  const card = ({ attrs, icon, title, sub, tag, on, tip }) => `<button type="button" class="pk-card ${on ? "on" : ""}" ${attrs} title="${esc(tip || "")}">
      <span class="pk-ic">${ic(icon)}</span><span class="pk-body"><b>${esc(title)}</b><span>${tag ? `<em class="pk-tag">${esc(tag)}</em>` : ""}${esc(sub)}</span></span></button>`;
  const drawItems = () => {
    const g = groups.find((x) => x.key === cur);
    if (cur === "_common") {
      items.innerHTML = `<div class="pk-note">最常用的 ${STARTERS.length} 件事。其他事务按左边的领域找，或者直接在下面描述。</div>`
        + STARTERS.map((st, i) => card({ attrs: `data-starter="${i}"`, icon: st.icon, title: st.title, sub: st.desc, on: st.scenario && st.scenario === state.scenario, tip: st.desc })).join("");
    } else {
      const list = cat.scenarios.filter((x) => x.group === cur);
      items.innerHTML = `<div class="pk-note">${esc(g.name)}：${list.length} 个预设流程。点卡片直接开工；你的事不在这里，也可以直接在下面描述。</div>`
        + list.map((x) => {
          const [icon, tag] = PIPE[x.pipeline] || ["message", ""];
          return card({ attrs: `data-sc="${esc(x.id)}"`, icon, title: x.name.replace(/（[^）]*）$/, ""), sub: x.examples[0] ? `适合：“${x.examples[0]}”` : "", tag, on: x.id === state.scenario,
            tip: `${x.name}\n流程：${cat.pipelines[x.pipeline] || ""}\n常见说法：${x.examples.join("；")}` });
        }).join("");
    }
    items.scrollTop = 0;
  };
  const select = (key) => {
    if (key === cur) return;
    cur = state.scGroup = key;
    $$(".pk-groups li", box).forEach((li) => li.classList.toggle("on", li.dataset.g === cur));
    drawItems();
  };
  $$(".pk-groups li", box).forEach((li) => {
    li.addEventListener("mouseenter", () => select(li.dataset.g));
    li.addEventListener("click", () => select(li.dataset.g));
  });
  items.addEventListener("click", (e) => {
    const b = e.target.closest(".pk-card");
    if (!b) return;
    $$(".pk-card", items).forEach((x) => x.classList.toggle("on", x === b));
    if (b.dataset.starter !== undefined) {
      const st = STARTERS[Number(b.dataset.starter)];
      setScenario(st.scenario);
      $("#question").value = st.prompt;
      composerChanged();
      $("#question").focus();
      if (st.upload) $("#file-input").click();
      return;
    }
    const sc = cat.scenarios.find((x) => x.id === b.dataset.sc);
    setScenario(sc.id);
    $("#question").focus();
    if (sc.needsDoc) $("#file-input").click();
  });
  drawItems();
}

async function loadMatters() {
  const list = await api("/api/matters");
  $("#matter-list").innerHTML = list.length ? list.map((m) => `<li data-id="${esc(m.id)}" class="${state.matter?.id === m.id ? "sel" : ""}">
      <div class="m-title">${esc(m.title)}</div>
      <div class="m-meta">${m.task ? `<span>${esc(m.task)}</span>` : ""}<span>${new Date(m.updated * 1000).toLocaleDateString("zh-CN")}</span>${m.files ? `<span>${ic("paperclip")}${m.files}</span>` : ""}</div>
      <button class="icon-btn m-del" data-del="${esc(m.id)}" title="删除这个事项">${ic("trash")}</button></li>`).join("")
    : `<li class="m-empty">还没有事项。点「新事项」开始。</li>`;
  return list;
}

$("#matter-list").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    if (!confirm("删除这个事项？对话记录和上传的文件都会删除，不能恢复。")) return;
    await api(`/api/matters/${del.dataset.del}`, { method: "DELETE" });
    if (state.matter?.id === del.dataset.del) { state.matter = null; renderMatter(null); }
    loadMatters();
    return;
  }
  const li = e.target.closest("li[data-id]");
  if (li) openMatter(li.dataset.id);
});

// 新事项：先只显示起始页，第一次发送或上传时才真正建事项（不留下一堆空的「新事项」）
$("#new-matter").addEventListener("click", () => {
  state.askOpened = true;
  state.newMatterShown = true; // 正在异步打开的「最近事项」不要再盖掉新事项页
  state.matter = null;
  state.pendingFiles = [];
  renderChips();
  setScenario("");
  renderMatter({ title: "新事项", task: "", files: [], display: [] });
  loadMatters();
  $("#question").focus();
});

async function ensureMatter() {
  if (state.matter) return state.matter.id;
  const { id } = await api("/api/matters", { method: "POST", body: "{}" });
  const keep = state.scenario; // 先选了场景、第一次上传或发送时才建事项：场景保留
  await openMatter(id);
  if (keep) setScenario(keep);
  return id;
}

async function openMatter(id) {
  const m = await api(`/api/matters/${id}`);
  state.matter = m;
  state.pendingFiles = [];
  setScenario("");
  renderChips();
  renderMatter(m);
  loadMatters();
}

$("#matter-title").addEventListener("change", async () => {
  if (!state.matter) return;
  await api(`/api/matters/${state.matter.id}/rename`, { method: "POST", body: JSON.stringify({ title: $("#matter-title").value }) });
  loadMatters();
});

const ASK_DETAIL_EMPTY = `<div class="empty"><p>助理引用的法条、案例和指引，点开会在这里显示原文，可以收藏。</p></div>`;
function renderMatter(m) {
  const log = $("#chat-log");
  // 换了事项：右侧原文栏回到空白，不留上一个事项点开的条文
  if ((m?.id || "") !== (state.renderedMatterId || "")) {
    $("#ask-detail").innerHTML = ASK_DETAIL_EMPTY;
    if (typeof setCollapsed === "function") setCollapsed("ask-right", true); // 没有原文可看时收起，给对话留出宽度
  }
  state.renderedMatterId = m?.id || "";
  $("#matter-head").hidden = !m;
  if (!m || !m.display.length) {
    if (m) { $("#matter-title").value = m.title; $("#matter-task").textContent = m.task || ""; $("#matter-files").textContent = m.files.length ? `已上传 ${m.files.length} 个文件` : ""; }
    log.innerHTML = `<div class="chat-intro">
      <div class="intro-head"><h2>今天要处理什么事？</h2>
        <p>什么事都可以直接在下面的输入框里描述，助理会自己判断该用哪种办法。下面是常见事务的<b>预设流程</b>：每个都专门设计过要问清哪些事实、查哪些规定、怎么打、交付什么。找到你的事就点一下，直接开工；没找到也没关系，直接描述就行。</p></div>
      <div id="picker" class="picker"></div>
    </div>`;
    loadScenarioCat().then(() => { const box = $("#picker"); if (box) renderPicker(box); });
    log.scrollTop = 0;
    return;
  }
  $("#matter-title").value = m.title;
  $("#matter-task").textContent = m.task || "待分类";
  $("#matter-files").textContent = m.files.length ? `已上传 ${m.files.length} 个文件` : "";
  log.innerHTML = "";
  m.display.forEach((d, i) => log.appendChild(entryEl(d, i === m.display.length - 1)));
  bindCites(log);
  log.scrollTop = log.scrollHeight;
}

const FILE_ICON = { image: "image", audio: "headphones", video: "video" };
const fileIcon = (f) => ic(FILE_ICON[f.kind] || "file-text");
function fileChip(f) {
  return `<span class="chip" title="${esc(f.name)}">${fileIcon(f)}<span class="nm">${esc(f.name)}</span></span>`;
}

function entryEl(d, isLast) {
  const el = document.createElement("div");
  if (d.role === "user") {
    el.className = "msg user";
    const answers = d.intake_answers ? Object.values(d.intake_answers).filter(Boolean) : [];
    el.innerHTML = userHTML(d.text, d.files) + (answers.length ? `<div class="bubble">补充：${esc(answers.join("；"))}</div>` : "") + (d.skip_intake ? `<div class="u-note">先按现有信息分析</div>` : "");
    return el;
  }
  el.className = "msg ai";
  const unv = d.citations?.unverified || [];
  el.innerHTML = `${aiHead(d.task)}
    ${d.steps?.length ? stepsHTML(d.steps) : ""}
    <div class="md">${renderMD(d.text || "")}</div>
    ${d.intake ? intakeHTML(d.intake, isLast && !d.intake.answered) : ""}
    ${d.citations && d.citations.checked ? `<div class="cite-line ${unv.length ? "warn" : "ok"}">${ic(unv.length ? "alert" : "circle-check")}<span>引用核对：正文提到法条 ${d.citations.checked} 处，${d.citations.linked} 处已对上资料库原文${unv.length ? `；${unv.length} 处资料库未核实：${esc(unv.join("、"))}` : ""}</span></div>` : ""}
    ${d.error ? `<p class="err">${esc(/connection|fetch failed|terminated|timeout/i.test(d.error) ? "连接 AI 接口失败：网络或网关暂时断开。点「重试」再试一次，已经填的内容不用重写。" : d.error)}</p>${isLast && d.error !== "已停止" ? `<button type="button" class="ghost retry-btn">${ic("refresh")}重试</button>` : ""}` : ""}
    <div class="msg-actions"></div>`;
  if (d.intake && isLast && !d.intake.answered) bindIntake(el, d.intake);
  // 上次出错的事项：重试 = 把出错前最后一次的提问或追问回答再发一次
  $(".retry-btn", el)?.addEventListener("click", (e) => {
    e.currentTarget.remove();
    const disp = state.matter?.display || [];
    const prevIntake = [...disp].reverse().find((x) => x.role === "assistant" && x.intake && x.intake.answered);
    const lastUser = [...disp].reverse().find((x) => x.role === "user" && x.text);
    const lastUserIdx = lastUser ? disp.lastIndexOf(lastUser) : -1;
    const intakeIdx = prevIntake ? disp.lastIndexOf(prevIntake) : -1;
    if (intakeIdx > lastUserIdx && prevIntake.intake.answered !== "skipped") send({ intake_answers: prevIntake.intake.answered });
    else if (intakeIdx > lastUserIdx) send({ skip_intake: true });
    else if (lastUser) send({ retry_question: lastUser.text });
  });
  if (d.text && !d.intake) addActions(el, d);
  return el;
}

function userHTML(text, files) {
  return (text ? `<div class="bubble">${esc(text)}</div>` : "") + (files?.length ? `<div class="chips">${files.map(fileChip).join("")}</div>` : "");
}
function aiHead(task) {
  return `<div class="ai-head"><span class="ai-avatar">${ic("scale")}</span><span class="ai-name">法律助理</span><span class="task-chip" ${task ? "" : "hidden"}>${esc(task || "")}</span></div>`;
}
function stepsHTML(steps) {
  return `<details class="steps"><summary>${ic("list")}<span>工作过程 · ${steps.length} 步</span>${ic("chevron-down", "chev")}</summary><div class="steps-list">${steps.map((s) => `<div>${esc(s)}</div>`).join("")}</div></details>`;
}

function intakeHTML(intake, active) {
  const qs = intake.questions || [];
  if (!active) return intakeDoneHTML(intake, intake.answered);
  return `<form class="intake">
    <div class="intake-title">${ic("message")}先确认几件事（会影响结论）</div>
    ${qs.map((q) => `<label class="iq"><span>${esc(q.question)}${q.required ? " <b class='req'>*</b>" : ""}${q.why ? `<em>${esc(q.why)}</em>` : ""}</span>
      ${q.options?.length ? `<div class="opts">${q.options.map((o) => `<button type="button" class="opt" data-key="${esc(q.key)}" data-val="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
      <input name="${esc(q.key)}" placeholder="${q.options?.length ? "选一个，或直接填写" : "填写"}"></label>`).join("")}
    <div class="intake-actions"><button type="submit" class="primary">${ic("arrow-up")}提交，继续分析</button><button type="button" class="ghost" data-skip>先按现有信息分析</button></div>
    ${intake.assumptions?.length ? `<div class="small muted">跳过的话，助理会假设：${esc(intake.assumptions.join("；"))}</div>` : ""}
  </form>`;
}

// 回答过的追问：留在对话里，看得到当时答了什么（跳过的显示采用的假设）
function intakeDoneHTML(intake, answered) {
  const qs = intake.questions || [];
  if (!answered || answered === "skipped") {
    return `<details class="intake done"><summary class="small muted">${ic("circle-check")}跳过了 ${qs.length} 个问题，按现有信息分析</summary>
      ${intake.assumptions?.length ? `<div class="small muted">采用的假设：${esc(intake.assumptions.join("；"))}</div>` : ""}</details>`;
  }
  const rows = qs.map((q) => `<li><span>${esc(q.question)}</span><b>${esc(answered[q.key] || "（未填）")}</b></li>`).join("");
  return `<details class="intake done"><summary class="small muted">${ic("circle-check")}已回答助理的 ${qs.length} 个问题</summary><ul class="iq-done">${rows}</ul></details>`;
}

function bindIntake(el, intake) {
  const form = $("form.intake", el);
  if (!form) return;
  $$(".opt", form).forEach((b) => b.addEventListener("click", () => {
    form.elements[b.dataset.key].value = b.dataset.val;
    $$(`.opt[data-key="${CSS.escape(b.dataset.key)}"]`, form).forEach((x) => x.classList.toggle("on", x === b));
  }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const answers = {};
    for (const q of intake.questions) answers[q.key] = form.elements[q.key].value.trim();
    intake.answered = answers;
    form.outerHTML = intakeDoneHTML(intake, answers);
    send({ intake_answers: answers });
  });
  $("[data-skip]", form).addEventListener("click", () => {
    intake.answered = "skipped";
    form.outerHTML = intakeDoneHTML(intake, "skipped");
    send({ skip_intake: true });
  });
}

function addActions(el, d) {
  const acts = $(".msg-actions", el);
  acts.insertAdjacentHTML("beforeend", `<button class="icon-btn" data-copy title="复制">${ic("copy")}</button>`);
  if (d.answer_id) {
    const on = state.bookmarks.has(`answer:${d.answer_id}`);
    acts.insertAdjacentHTML("beforeend", `<button class="icon-btn ${on ? "on" : ""}" data-star="answer|${esc(d.answer_id)}" title="${on ? "取消收藏" : "收藏"}">${ic(on ? "bookmark-fill" : "bookmark")}</button>`);
    const it = { kind: "answer", id: d.answer_id, question: state.matter?.title || "", answer: d.text };
    $("[data-star]", acts).addEventListener("click", (ev) => toggleBookmark(ev.currentTarget, it));
  }
  acts.insertAdjacentHTML("beforeend", `<button class="icon-btn" data-word title="导出 Word">${ic("file-down")}</button>`);
  $("[data-copy]", acts).addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    const text = plainText(d.text);
    let ok = await navigator.clipboard.writeText(text).then(() => true, () => false);
    if (!ok) { // 剪贴板接口不可用时用老办法
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      ok = document.execCommand("copy"); ta.remove();
    }
    if (!ok) { toast("复制失败，可以选中文字后按 ⌘C / Ctrl+C"); return; }
    toast("已复制");
    b.innerHTML = ic("check"); b.title = "已复制";
    setTimeout(() => { b.innerHTML = ic("copy"); b.title = "复制"; }, 1500);
  });
  $("[data-word]", acts).addEventListener("click", () => exportWord(d));
}

const plainText = (t) => String(t || "").replace(/\[\[(art|law|case|ref):[^\]]+\]\]/g, "");

async function exportWord(d) {
  const title = (state.matter?.title || "法律助理产出") + (d.task ? `（${d.task}）` : "");
  const res = await fetch("/api/export", { method: "POST", headers: HEADERS, body: JSON.stringify({ title, markdown: d.text }) });
  if (!res.ok) { alert("导出失败"); return; }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]/g, "")}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* 上传 */
$("#attach-btn").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  const matterId = await ensureMatter();
  for (const f of files) {
    const chip = { name: f.name, status: "reading" };
    state.pendingFiles.push(chip);
    renderChips();
    try {
      const media = /^(audio|video)\//.test(f.type) || /\.(mp3|m4a|wav|aac|ogg|webm|mp4|mov|flac|opus)$/i.test(f.name);
      const data = media ? await audioFileToWav16k(f).catch(() => { throw new Error("读不出这个文件里的声音（可以先导出成 m4a、mp3 或 wav 再上传）"); }) : await new Promise((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",")[1] || "");
        r.onerror = () => bad(r.error);
        r.readAsDataURL(f);
      });
      const res = await api("/api/upload", { method: "POST", body: JSON.stringify({ matter_id: matterId, name: f.name, mime: media ? (f.type || "audio/wav") : f.type, data, model: $("#ask-model").value }) });
      Object.assign(chip, res, { status: "ok" });
    } catch (err) {
      Object.assign(chip, { status: "error", error: err.message });
    }
    renderChips();
  }
});

function renderChips() {
  $("#attach-chips").innerHTML = state.pendingFiles.map((f, i) => {
    const st = f.status === "reading" ? `<em>识别中…</em>` : f.status === "error" ? `<em class="err" title="${esc(f.error)}">失败：${esc(f.error.slice(0, 40))}</em>` : `<em>${f.chars ? f.chars + " 字" : ""}</em>`;
    return `<span class="chip ${f.status}" title="${esc(f.name)}">${fileIcon(f)}<span class="nm">${esc(f.name)}</span>${st}<button type="button" data-rm="${i}" title="移除">${ic("x")}</button></span>`;
  }).join("");
  $$("[data-rm]", $("#attach-chips")).forEach((b) => b.addEventListener("click", () => { state.pendingFiles.splice(Number(b.dataset.rm), 1); renderChips(); }));
  composerChanged();
}

/* 听写（照搬 CopyDeck）：按话筒开始，说的话边说边写进输入框光标处；再按一次结束，字留在框里不自动发送；Esc 取消并恢复原样。
   麦克风 24kHz → AudioWorklet 每 200ms 一块 PCM16 → 本地服务转给网关的实时转写（gpt-live-transcribe）。 */
const dict = { s: null };
const MIC_ICON = ic("mic");
function dictButton(state) {
  const b = $("#mic-btn");
  b.classList.toggle("rec", state === "recording" || state === "finishing");
  b.classList.toggle("connecting", state === "connecting");
  b.disabled = state === "finishing";
  b.innerHTML = state === "recording" ? `<span class="dict-wave"><i></i><i></i><i></i><i></i></span><span class="dict-label">正在听</span>`
    : state === "finishing" ? `<span class="dict-label">收尾中</span>` : state === "connecting" ? `<span class="dict-label">准备中</span>` : MIC_ICON;
  b.title = state === "recording" ? "正在听，点一下结束；Esc 取消" : "语音输入（听写）";
  const q = $("#question");
  q.classList.toggle("dictating", state !== "idle");
  if (state === "recording") { q.dataset.ph ??= q.placeholder; q.placeholder = "正在听…说完再点一下话筒结束，Esc 取消"; }
  else if (state === "idle" && q.dataset.ph != null) { q.placeholder = q.dataset.ph; delete q.dataset.ph; }
}
// 识别出的整段文字写进输入框：只替换这次听写写进去的那部分（流式结果改口也不会重复）
function dictWrite(s, text) {
  const q = $("#question");
  if (q.value !== s.written) { const c = q.selectionEnd ?? q.value.length; s.before = q.value.slice(0, c); s.after = q.value.slice(c); s.consumed = s.text.length; }
  const piece = text.length > s.consumed ? text.slice(s.consumed) : "";
  s.text = text;
  const value = s.before + piece + s.after;
  if (value === q.value) return;
  q.value = s.written = value;
  const at = s.before.length + piece.length;
  if (document.activeElement === q) q.setSelectionRange(at, at);
  composerChanged();
  if (!s.after) q.scrollTop = q.scrollHeight;
}
function dictStopCapture(s) {
  cancelAnimationFrame(s.raf);
  clearTimeout(s.timer);
  s.stream?.getTracks().forEach((t) => t.stop());
  s.source?.disconnect(); s.node?.disconnect(); s.ctx?.close().catch(() => {});
}
function dictEnd(s) { dictStopCapture(s); if (dict.s === s) dict.s = null; dictButton("idle"); }
function dictFail(s, err) {
  if (s.cancelled) return;
  s.cancelled = true;
  if (s.id) api(`/api/dictation/${s.id}/cancel`, { method: "POST" }).catch(() => {});
  dictEnd(s);
  const msg = err?.name === "NotAllowedError" ? "请在系统设置里允许「中国法律检索」使用麦克风。" : err?.message || String(err);
  toast("听写失败：" + msg);
}
async function dictStart() {
  const q = $("#question");
  const s = dict.s = { before: q.value.slice(0, q.selectionStart ?? q.value.length), after: q.value.slice(q.selectionEnd ?? q.value.length), original: q.value, consumed: 0, text: "", written: q.value, queue: Promise.resolve() };
  dictButton("connecting");
  try {
    const perm = await api("/api/mic-permission", { method: "POST", body: "{}" });
    if (!perm.ok) { s.cancelled = true; dictEnd(s); toast(perm.message); return; }
    if (s.cancelled) return;
    const [conn, stream] = await Promise.all([
      api("/api/dictation/start", { method: "POST", body: "{}" }),
      navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }),
    ]);
    s.id = conn.id; s.stream = stream;
    if (s.cancelled) { dictStopCapture(s); api(`/api/dictation/${s.id}/cancel`, { method: "POST" }).catch(() => {}); return; }
    s.ctx = new AudioContext({ sampleRate: 24000 });
    await s.ctx.audioWorklet.addModule("dictation-worklet.js");
    s.node = new AudioWorkletNode(s.ctx, "dictation-capture");
    s.source = s.ctx.createMediaStreamSource(stream);
    s.analyser = s.ctx.createAnalyser(); s.analyser.fftSize = 512; s.source.connect(s.analyser);
    const broken = (err) => { if (!s.cancelled && !s.ending) dictFail(s, err); };
    const push = (r) => { if (!s.cancelled && r?.text != null) dictWrite(s, r.text); };
    s.node.port.onmessage = (e) => {
      if (e.data === "flushed") { s.flushDone?.(); return; }
      if (s.cancelled) return;
      if (e.data === "boundary") { s.queue = s.queue.then(() => api(`/api/dictation/${s.id}/boundary`, { method: "POST" })).then(push); s.queue.catch(broken); return; }
      const bytes = new Uint8Array(e.data);
      let raw = "";
      for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const audio = btoa(raw);
      s.queue = s.queue.then(() => api(`/api/dictation/${s.id}/append`, { method: "POST", body: JSON.stringify({ audio }) })).then(push);
      s.queue.catch(broken);
    };
    s.source.connect(s.node); s.node.connect(s.ctx.destination);
    await s.ctx.resume();
    if (s.cancelled) { dictStopCapture(s); return; }
    dictButton("recording");
    const buf = new Float32Array(s.analyser.fftSize);
    const tick = () => { if (dict.s !== s || s.cancelled) return; s.analyser.getFloatTimeDomainData(buf); let p = 0; for (const x of buf) p += x * x; $("#mic-btn").style.setProperty("--lv", Math.min(1, Math.sqrt(p / buf.length) * 8).toFixed(2)); s.raf = requestAnimationFrame(tick); };
    tick();
    q.focus();
    s.timer = setTimeout(() => { toast("听写最长 3 分钟，已经帮你结束了。"); dictStop(); }, 180000);
  } catch (err) { dictFail(s, err); }
}
async function dictStop() {
  const s = dict.s;
  if (!s || s.cancelled || s.ending) return;
  if (!s.node) { dictCancel(); return; }
  s.ending = true; dictButton("finishing"); clearTimeout(s.timer);
  try {
    await new Promise((ok, bad) => { const t = setTimeout(() => bad(new Error("音频收尾超时")), 2000); s.flushDone = () => { clearTimeout(t); ok(); }; s.node.port.postMessage("flush"); });
    dictStopCapture(s);
    await s.queue;
    const r = await api(`/api/dictation/${s.id}/finish`, { method: "POST" });
    if (!s.cancelled) dictWrite(s, r.text || "");
    if (!r.text && !s.text) toast("没有听到说话。");
  } catch (err) { if (!s.cancelled) toast("听写失败：" + err.message); }
  finally { s.cancelled = true; dictEnd(s); $("#question").focus(); }
}
function dictCancel() {
  const s = dict.s;
  if (!s) return;
  s.cancelled = true;
  if (s.id) api(`/api/dictation/${s.id}/cancel`, { method: "POST" }).catch(() => {});
  $("#question").value = s.original;
  dictEnd(s);
  composerChanged();
}
$("#mic-btn").addEventListener("mousedown", (e) => e.preventDefault()); // 不抢输入框光标
$("#mic-btn").addEventListener("click", () => { if (dict.s) { dict.s.node ? dictStop() : dictCancel(); } else dictStart(); });
window.addEventListener("keydown", (e) => { if (dict.s && e.key === "Escape" && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); dictCancel(); } }, true);

/* 上传的录音、视频：在本机解码成 16kHz 单声道 WAV（视频只取音轨）再送去转写 */
async function audioFileToWav16k(file) {
  const ctx = new AudioContext();
  let decoded;
  try { decoded = await ctx.decodeAudioData(await file.arrayBuffer()); } finally { ctx.close().catch(() => {}); }
  const frames = Math.ceil(decoded.duration * 16000);
  const off = new OfflineAudioContext(1, frames, 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, x) => [...x].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVEfmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true); }
  const bytes = new Uint8Array(out.buffer);
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}

/* 发送 */
$("#question").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  const mod = KEYS.isMac() ? e.metaKey : e.ctrlKey;
  const go = KEYS.sendKey() === "mod-enter" ? mod : !e.shiftKey && !mod;
  if (go) { e.preventDefault(); $("#ask-form").requestSubmit(); }
});
$("#ask-form").addEventListener("submit", (e) => { e.preventDefault(); send({}); });
$("#stop-btn").addEventListener("click", () => state.matter && api(`/api/matters/${state.matter.id}/stop`, { method: "POST", body: "{}" }));

async function send({ intake_answers, skip_intake, retry_question }) {
  if (state.asking) return;
  const question = retry_question ?? (intake_answers || skip_intake ? "" : $("#question").value.trim());
  state.lastSend = { intake_answers, skip_intake, retry_question: question };
  const ready = state.pendingFiles.filter((f) => f.status === "ok");
  if (state.pendingFiles.some((f) => f.status === "reading")) { toast("文件还在识别中，请稍等。"); return; }
  if (!question && !ready.length && !intake_answers && !skip_intake) return;
  const matterId = await ensureMatter();
  state.asking = true;
  $("#ask-btn").hidden = true; $("#stop-btn").hidden = false;
  if (!intake_answers && !skip_intake) { $("#question").value = ""; composerChanged(); }
  const fileIds = ready.map((f) => f.id);
  state.pendingFiles = [];
  renderChips();
  $(".chat-intro")?.remove();
  $$("form.intake").forEach((f) => f.remove());
  const log = $("#chat-log");
  if (question || fileIds.length) log.insertAdjacentHTML("beforeend", `<div class="msg user">${userHTML(question, ready)}</div>`);
  const box = document.createElement("div");
  box.className = "msg ai";
  box.innerHTML = `${aiHead("")}<div class="steps running">${ic("loader", "spin")}<span class="live">理解问题</span></div><div class="md"></div>`;
  log.appendChild(box);
  log.scrollTop = log.scrollHeight;
  let text = "";
  try {
    const res = await fetch("/api/ask", { method: "POST", headers: HEADERS, body: JSON.stringify({
      matter_id: matterId, question, file_ids: fileIds, intake_answers, skip_intake, scenario: state.scenario,
      region: $("#ask-region").value, model: $("#ask-model").value, depth: $("#ask-depth").value }) });
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
        if (ev.type === "step" || ev.type === "stage") $(".steps .live", box).textContent = ev.text;
        else if (ev.type === "route") { const c = $(".task-chip", box); c.hidden = false; c.textContent = ev.name; }
        else if (ev.type === "text") { text += ev.delta; $(".md", box).innerHTML = renderMD(text); }
        else if (ev.type === "text_reset") { text = ""; $(".md", box).innerHTML = ""; }
        else if (ev.type === "error") {
          $(".md", box).insertAdjacentHTML("beforeend", `<p class="err">${esc(ev.message)}</p><button type="button" class="ghost retry-btn">${ic("refresh")}重试</button>`);
          const again = { ...state.lastSend };
          $(".retry-btn", box).addEventListener("click", (e2) => { e2.currentTarget.remove(); send(again); });
        }
        const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 200;
        if (nearBottom) log.scrollTop = log.scrollHeight;
      }
    }
  } catch (err) {
    $(".md", box).insertAdjacentHTML("beforeend", `<p class="err">连接出错：${esc(err.message)}</p>`);
  }
  state.asking = false;
  $("#ask-btn").hidden = false; $("#stop-btn").hidden = true;
  composerChanged();
  await openMatter(matterId);
}

/* ---------- 设置 ---------- */
$("#open-settings").addEventListener("click", async () => {
  const s = await api("/api/settings");
  const f = $("#settings-form");
  f.elements.base_url.value = s.base_url || "";
  f.elements.api_key.value = s.api_key || "";
  f.elements.auto_update.checked = s.auto_update !== false;
  f.elements.update_interval_days.value = String(s.update_interval_days || 7);
  state.settingsModels = { review: s.review_model || "auto", transcribe: s.transcribe_model || "gpt-live-transcribe" };
  fillModelSelects(state.modelList || []);
  $("#models-status").textContent = "";
  $("#model-list").hidden = true;
  $("#settings").showModal();
});

async function saveSettings() {
  const f = $("#settings-form");
  await api("/api/settings", { method: "POST", body: JSON.stringify({
    base_url: f.elements.base_url.value.trim(), api_key: f.elements.api_key.value.trim(),
    review_model: f.elements.review_model.value, transcribe_model: f.elements.transcribe_model.value,
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
  $("#open-settings").classList.toggle("attn", !r.models?.length);
});

/* ---------- 模型清单（AI 问答输入框下方） ---------- */
function fillModelSelects(models) {
  const f = $("#settings-form");
  const cur = state.settingsModels || { review: "auto", transcribe: "gpt-live-transcribe" };
  f.elements.review_model.innerHTML = `<option value="auto">自动选择另一家族的强模型</option>` + models.map((m) => `<option>${esc(m)}</option>`).join("");
  f.elements.review_model.value = models.includes(cur.review) ? cur.review : "auto";
  const tr = models.filter((m) => /transcri|whisper|audio|speech|asr/i.test(m));
  const opts = [...new Set(["gpt-live-transcribe", ...tr])];
  f.elements.transcribe_model.innerHTML = opts.map((m) => `<option>${esc(m)}</option>`).join("");
  f.elements.transcribe_model.value = opts.includes(cur.transcribe) ? cur.transcribe : "gpt-live-transcribe";
}

function fillModels(r) {
  state.modelList = r.models || [];
  const sel = $("#ask-model");
  if (!r.models?.length) {
    sel.innerHTML = `<option value="">${r.error ? "未连接" : "请先在设置里填 key"}</option>`;
    renderModelPicker();
    return;
  }
  // 只列能对话的模型（去掉图片生成、语音、测试用的）
  const chat = r.models.filter((m) => !/image|transcri|tts|embed|whisper|mock|loadtest|codex-auto-review/i.test(m));
  const keep = sel.value || r.model;
  sel.innerHTML = chat.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  sel.value = chat.includes(keep) ? keep : (chat.includes("gpt-6-luna") ? "gpt-6-luna" : chat[0]);
  if (r.depth) $("#ask-depth").value = r.depth;
  renderModelPicker();
}
async function loadModels() {
  try { const r = await api("/api/models"); fillModels(r); return r; }
  catch (err) { fillModels({ error: err.message }); return {}; }
}

/* ---------- 输入框：自动增高、地区、模型与思考深度 ---------- */
function composerChanged() {
  const q = $("#question");
  q.style.height = "auto";
  q.style.height = Math.min(q.scrollHeight, 190) + "px";
  $("#ask-btn").disabled = !(q.value.trim() || state.pendingFiles.some((f) => f.status === "ok"));
}
$("#question").addEventListener("input", composerChanged);

function openPop(pop, btn) {
  closePops();
  if (!pop.classList.contains("wide")) pop.style.left = btn.offsetLeft + "px";
  pop.hidden = false;
  btn.classList.add("open");
  const s = $(".pop-search", pop);
  s.value = "";
  filterPop(pop, "");
  s.focus();
  $(".pop-list li.on", pop)?.scrollIntoView({ block: "nearest" });
}
function closePops() {
  $$(".popover").forEach((p) => { p.hidden = true; });
  $$(".pill.open").forEach((b) => b.classList.remove("open"));
}
function filterPop(pop, q) {
  const raw = q.trim();
  q = raw.toLowerCase();
  $$(".pop-list li", pop).forEach((li) => {
    if (li.dataset.custom) return;
    if (li.classList.contains("grp")) li.hidden = !!q;
    else if (li.classList.contains("city")) li.hidden = !q || !li.textContent.toLowerCase().includes(q);
    else if (li.dataset.v !== undefined) li.hidden = !!q && !li.textContent.toLowerCase().includes(q) && !li.dataset.v.toLowerCase().includes(q);
  });
  // 列表里没有的城市、区县：可以直接用输入的名字
  const custom = $("li[data-custom]", pop);
  if (custom) {
    custom.hidden = !raw || [...$$(".pop-list li[data-v]", pop)].some((li) => !li.hidden && !li.dataset.custom && $("span", li).textContent.startsWith(raw));
    custom.dataset.v = raw;
    $("span", custom).textContent = `用「${raw}」作为地区`;
  }
}
document.addEventListener("mousedown", (e) => { if (!e.target.closest?.(".popover, .pill")) closePops(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePops(); });
$$(".pop-search").forEach((inp) => {
  inp.addEventListener("input", () => filterPop(inp.closest(".popover"), inp.value));
  inp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    $$(".pop-list li[data-v]", inp.closest(".popover")).find((li) => !li.hidden)?.click();
  });
});
const togglePop = (pop, btn) => (pop.hidden ? openPop(pop, btn) : closePops());
$("#region-btn").addEventListener("click", () => togglePop($("#region-pop"), $("#region-btn")));
$("#model-btn").addEventListener("click", () => togglePop($("#model-pop"), $("#model-btn")));

// 地区：直辖市排前面，其余按拼音
const REGION_FIRST = ["北京市", "上海市", "天津市", "重庆市"];
// 常用城市（地方规定常常细到市，如深圳经济特区、各设区的市）：值写成「省 + 市」
const CITIES = { 广东省: "广州 深圳 珠海 汕头 佛山 东莞 中山 惠州 江门 湛江", 浙江省: "杭州 宁波 温州 绍兴 嘉兴 金华 台州 湖州", 江苏省: "南京 苏州 无锡 常州 南通 徐州 扬州", 山东省: "济南 青岛 烟台 潍坊 临沂 淄博", 福建省: "福州 厦门 泉州 漳州", 四川省: "成都 绵阳 宜宾", 湖北省: "武汉 宜昌 襄阳", 湖南省: "长沙 株洲 湘潭", 河南省: "郑州 洛阳", 河北省: "石家庄 唐山 保定", 辽宁省: "沈阳 大连", 吉林省: "长春", 黑龙江省: "哈尔滨", 陕西省: "西安", 山西省: "太原", 安徽省: "合肥 芜湖", 江西省: "南昌", 广西壮族自治区: "南宁 桂林", 海南省: "海口 三亚", 贵州省: "贵阳", 云南省: "昆明", 甘肃省: "兰州", 青海省: "西宁", 宁夏回族自治区: "银川", 新疆维吾尔自治区: "乌鲁木齐", 西藏自治区: "拉萨", 内蒙古自治区: "呼和浩特 包头" };
const PROVINCE_RE = /^(北京市|上海市|天津市|重庆市|.+省|.+自治区)$/;
function setRegion(v) {
  const sel = $("#ask-region");
  if (v && ![...sel.options].some((o) => o.value === v)) sel.insertAdjacentHTML("beforeend", `<option>${esc(v)}</option>`);
  sel.value = v;
}
function renderRegionOptions() {
  const sel = $("#ask-region");
  const all = [...sel.options].map((o) => o.value).filter((v) => v && PROVINCE_RE.test(v));
  const sorted = [...REGION_FIRST.filter((r) => all.includes(r)), ...all.filter((r) => !REGION_FIRST.includes(r)).sort((a, b) => a.localeCompare(b, "zh-CN"))];
  const cur = sel.value;
  $("#region-options").innerHTML = `<li data-v="" class="${cur ? "" : "on"}"><span>不指定地区</span>${ic("check", "ck")}</li>`
    + sorted.map((r) => `<li data-v="${esc(r)}" class="${r === cur ? "on" : ""}"><span>${esc(r)}</span>${ic("check", "ck")}</li>`
      + (CITIES[r] || "").split(" ").filter(Boolean).map((c) => `<li data-v="${esc(r + c + "市")}" class="city ${r + c + "市" === cur ? "on" : ""}"><span>${esc(c)}市</span><em class="muted small">${esc(r)}</em>${ic("check", "ck")}</li>`).join("")).join("")
    + `<li data-v="" data-custom="1" class="custom" hidden><span></span></li>`;
  $("#region-label").textContent = (cur || "地区").replace(/^.+?(省|自治区)(.+)$/, "$2");
  $("#region-btn").classList.toggle("set", !!cur);
}
$("#region-options").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-v]");
  if (!li) return;
  setRegion(li.dataset.v);
  renderRegionOptions();
  closePops();
  $("#question").focus();
});

// 模型：按厂商分组；思考深度用滑块
const DEPTHS = ["low", "medium", "high"];
const DEPTH_LABEL = { low: "快速", medium: "标准", high: "深入" };
function modelFamily(m) {
  const s = m.toLowerCase();
  if (s.startsWith("claude")) return "Claude";
  if (/^(gpt|o\d|openai\/)/.test(s)) return "OpenAI";
  if (s.includes("deepseek")) return "DeepSeek";
  if (s.includes("grok") || s.startsWith("xai/")) return "xAI";
  if (s.includes("kimi") || s.startsWith("moonshot/")) return "Kimi";
  if (s.includes("glm") || s.startsWith("zai/")) return "智谱 GLM";
  if (s.includes("qwen")) return "通义千问";
  if (s.includes("gemini")) return "Gemini";
  return "其他";
}
const shortModel = (m) => m.replace(/^[\w-]+\//, "");
function renderModelPicker() {
  const sel = $("#ask-model");
  const models = [...sel.options].map((o) => o.value).filter(Boolean);
  const cur = sel.value;
  const groups = new Map();
  for (const m of models) {
    const f = modelFamily(m);
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(m);
  }
  $("#model-options").innerHTML = models.length
    ? [...groups].map(([g, ms]) => `<li class="grp">${esc(g)}</li>` + ms.map((m) => `<li data-v="${esc(m)}" class="${m === cur ? "on" : ""}" title="${esc(m)}"><span>${esc(shortModel(m))}</span>${ic("check", "ck")}</li>`).join("")).join("")
    : `<li class="none">${esc(sel.options[0]?.textContent || "没有可用模型")}。点右上角的设置连接接口。</li>`;
  const depth = DEPTHS.includes($("#ask-depth").value) ? $("#ask-depth").value : "medium";
  $("#depth-range").value = DEPTHS.indexOf(depth);
  $("#depth-label").textContent = DEPTH_LABEL[depth];
  $("#model-label").textContent = cur ? `${shortModel(cur)} · ${DEPTH_LABEL[depth]}` : (sel.options[0]?.textContent || "模型");
  $("#model-btn").title = `模型：${cur || "未选择"}；思考深度：${DEPTH_LABEL[depth]}`;
}
$("#model-options").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-v]");
  if (!li) return;
  $("#ask-model").value = li.dataset.v;
  renderModelPicker();
  closePops();
  $("#question").focus();
});
$("#depth-range").addEventListener("input", (e) => {
  $("#ask-depth").value = DEPTHS[Number(e.target.value)];
  renderModelPicker();
});

/* ---------- 可调面板：拖动分隔条改宽度，法律助理两侧可以收起 ---------- */
const PANE_MIN = 180;
const MAIN_MIN = 380;
const paneEl = (key) => $(`[data-pane="${key}"]`);
const canCollapse = (key) => $$(`[data-toggle="${key}"]`).length > 0;
function store(k, v) { try { if (v === "" || v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 忽略 */ } }
function recall(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } }

function setCollapsed(key, on) {
  const el = paneEl(key);
  if (!el || (on && !canCollapse(key))) return;
  el.classList.toggle("collapsed", on);
  $$(`.gutter[data-for="${key}"]`).forEach((g) => g.classList.toggle("hidden", on));
  $$(`[data-toggle="${key}"]`).forEach((b) => b.classList.toggle("on", !on));
  store(`pane:${key}:collapsed`, on ? "1" : "0");
}

function initPanes() {
  // 浏览、检索、收藏、法规更新：左栏和阅读区之间加分隔条
  $$(".split").forEach((sp) => {
    const left = $(".pane-left", sp);
    const key = sp.closest(".view").id.replace("view-", "") + "-left";
    left.dataset.pane = key;
    const g = document.createElement("div");
    g.className = "gutter";
    g.dataset.for = key;
    left.after(g);
  });
  $$(".gutter").forEach((g) => {
    g.title = canCollapse(g.dataset.for) ? "拖动调整宽度，双击收起" : "拖动调整宽度，双击恢复默认";
    g.addEventListener("pointerdown", startDrag);
    g.addEventListener("dblclick", () => {
      const key = g.dataset.for;
      if (canCollapse(key)) setCollapsed(key, true);
      else { paneEl(key).style.removeProperty("--w"); store(`pane:${key}:w`, ""); }
    });
  });
  $$("[data-pane]").forEach((el) => {
    const key = el.dataset.pane;
    const w = recall(`pane:${key}:w`);
    if (w) el.style.setProperty("--w", w);
    // 原文面板默认收起，点开引用时自动展开
    const saved = recall(`pane:${key}:collapsed`);
    setCollapsed(key, saved ? saved === "1" : el.dataset.defaultCollapsed === "1");
  });
  $$("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
    const key = b.dataset.toggle;
    setCollapsed(key, !paneEl(key).classList.contains("collapsed"));
  }));
}

function startDrag(e) {
  const g = e.currentTarget;
  const key = g.dataset.for;
  const pane = paneEl(key);
  const box = pane.parentElement;
  const rightSide = g.nextElementSibling === pane;
  const startX = e.clientX;
  const startW = pane.getBoundingClientRect().width;
  // 其他固定宽度的栏占掉的空间
  const others = $$(":scope > [data-pane]", box).filter((x) => x !== pane && !x.classList.contains("collapsed")).reduce((a, x) => a + x.getBoundingClientRect().width, 0);
  const max = Math.max(PANE_MIN, box.clientWidth - others - MAIN_MIN);
  g.setPointerCapture(e.pointerId);
  g.classList.add("dragging");
  document.body.classList.add("resizing");
  let w = startW;
  const move = (ev) => {
    const raw = startW + (rightSide ? startX - ev.clientX : ev.clientX - startX);
    if (raw < PANE_MIN * 0.55 && canCollapse(key)) { setCollapsed(key, true); end(); return; }
    w = Math.round(Math.min(max, Math.max(PANE_MIN, raw)));
    pane.style.setProperty("--w", w + "px");
  };
  const end = () => {
    g.removeEventListener("pointermove", move);
    g.removeEventListener("pointerup", end);
    g.removeEventListener("pointercancel", end);
    g.classList.remove("dragging");
    document.body.classList.remove("resizing");
    if (!pane.classList.contains("collapsed")) store(`pane:${key}:w`, w + "px");
  };
  g.addEventListener("pointermove", move);
  g.addEventListener("pointerup", end);
  g.addEventListener("pointercancel", end);
}

initPanes();
renderRegionOptions();
renderModelPicker();
composerChanged();

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
    meta = `<span class="badge">第 ${it.number} 号</span>` + (it.note ? `<span class="badge old">不再参照</span>` : "") + (it.keywords ? `<span class="badge">${esc(it.keywords.replace(/\s+/g, " ").slice(0, 36))}</span>` : "");
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
  $("#theme").innerHTML = ic(t === "dark" ? "moon" : t === "light" ? "sun" : "monitor");
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

/* ---------- 在线更新 ---------- */
const mb = (n) => (n / 1e6 >= 1 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
function renderAppUpdate(u) {
  state.appUpdate = u;
  const btn = $("#app-update-btn");
  btn.hidden = !["available", "downloading", "installing", "staged", "shell"].includes(u.status);
  btn.textContent = u.status === "staged" ? "重启以完成更新" : u.status === "downloading" ? `更新下载中 ${u.percent || 0}%` : "有新版本";
  $("#au-version").textContent = `版本 ${u.installed?.version || ""}（更新 ${u.installed?.sequence || 0}）· 法规数据 ${u.installed?.data || ""}${u.status === "current" ? " · 已是最新" : u.status === "error" ? " · " + u.message : ""}`;
  const body = $("#au-body"), action = $("#au-action"), bar = $("#au-bar");
  bar.hidden = !["downloading", "installing"].includes(u.status);
  $("i", bar).style.width = (u.percent || 0) + "%";
  action.disabled = ["downloading", "installing"].includes(u.status);
  if (u.status === "available") {
    body.innerHTML = `<p>新版本：更新 ${u.sequence}（${esc(u.version)}）</p>${u.notes ? `<pre>${esc(u.notes)}</pre>` : ""}<p class="muted">需要下载：${esc((u.parts || []).join("、"))}，共 ${mb(u.bytes || 0)}。不用重新安装，下载完重启即可。</p>`;
    action.textContent = "下载并更新";
  } else if (u.status === "downloading" || u.status === "installing") {
    body.innerHTML = `<p>${u.status === "installing" ? "正在安装…" : `正在下载${u.current ? "：" + esc(u.current) : ""}…`}</p>`;
    action.textContent = "下载中…";
  } else if (u.status === "staged") {
    body.innerHTML = `<p>更新已下载并通过签名校验，重启后生效。</p>${u.notes ? `<pre>${esc(u.notes)}</pre>` : ""}<p class="muted">新版本第一次启动如果出问题，会自动退回现在的版本。</p>`;
    action.textContent = "立即重启";
  } else if (u.status === "shell") {
    body.innerHTML = `<p>新版本 ${esc(u.version)} 需要重新下载安装包（这次更新改动了程序外壳）。</p>${u.notes ? `<pre>${esc(u.notes)}</pre>` : ""}`;
    action.textContent = "去下载安装包";
  } else if (u.status === "error") {
    body.innerHTML = `<p class="err">${esc(u.message || "")}</p>`;
    action.textContent = "重新检查";
  } else {
    body.innerHTML = `<p>${esc(u.message || "已是最新版本")}</p>`;
    action.textContent = "检查更新";
  }
}
async function pollAppUpdate() {
  try { renderAppUpdate(await api("/api/app-update")); } catch { /* 忽略 */ }
  const busy = ["downloading", "installing"].includes(state.appUpdate?.status);
  setTimeout(pollAppUpdate, busy ? 1000 : 60000);
}
$("#app-update-btn").addEventListener("click", () => $("#app-update").showModal());
$("#au-check").addEventListener("click", async () => { renderAppUpdate(await api("/api/app-update/check", { method: "POST", body: "{}" })); if (state.appUpdate.status !== "current") $("#app-update").showModal(); });
$("#au-action").addEventListener("click", async () => {
  const u = state.appUpdate || {};
  if (u.status === "available") { await api("/api/app-update/download", { method: "POST", body: "{}" }); setTimeout(pollAppUpdate, 500); }
  else if (u.status === "staged") await api("/api/app-update/restart", { method: "POST", body: "{}" });
  else if (u.status === "shell") window.open(u.installerUrl, "_blank");
  else renderAppUpdate(await api("/api/app-update/check", { method: "POST", body: "{}" }));
});
pollAppUpdate();

init().catch((err) => { $("#db-stats").textContent = "初始化失败：" + err.message; });


/* ---------- 快捷键 ---------- */
let keyRecording = null;
document.addEventListener("keydown", (e) => {
  if (keyRecording || e.isComposing || e.repeat) { if (e.repeat && KEYS.matches(e, KEYS.load().dictate)) e.preventDefault(); return; }
  const k = KEYS.load();
  if (KEYS.matches(e, k.dictate)) {
    e.preventDefault();
    if (!$("#view-ask").classList.contains("active")) showView("ask");
    if (dict.s) { if (KEYS.dictMode() !== "hold") { dict.s.node ? dictStop() : dictCancel(); } return; }
    state.dictHoldAt = Date.now();
    $("#question").focus();
    dictStart();
    return;
  }
  if (KEYS.matches(e, k.newMatter)) { e.preventDefault(); state.askOpened = true; showView("ask"); $("#new-matter").click(); return; }
  if (KEYS.matches(e, k.focusAsk)) { e.preventDefault(); showView("ask"); $("#question").focus(); return; }
  if (KEYS.matches(e, k.search)) { e.preventDefault(); showView("search"); $("#q")?.focus(); $("#q")?.select(); return; }
  if (KEYS.matches(e, k.settings)) { e.preventDefault(); $("#open-settings").click(); }
}, true);
// 按住说话：松开快捷键（主键或任一修饰键）就结束
document.addEventListener("keyup", (e) => {
  if (KEYS.dictMode() !== "hold" || !dict.s || keyRecording) return;
  const combo = KEYS.load().dictate;
  if (!combo) return;
  const parts = combo.split("+"), main = parts.at(-1);
  const modNames = { Mod: KEYS.isMac() ? "Meta" : "Control", Ctrl: "Control", Alt: "Alt", Shift: "Shift", Win: "Meta" };
  const mainUp = KEYS.comboOf({ key: e.key, code: e.code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }) === main;
  if (!mainUp && !parts.slice(0, -1).some((m) => modNames[m] === e.key)) return;
  if (dict.s.node) dictStop();
  else if (Date.now() - (state.dictHoldAt || 0) < 350) dictCancel();
  else { const s0 = dict.s, t0 = Date.now(); const w = setInterval(() => { if (dict.s !== s0) return clearInterval(w); if (s0.node) { clearInterval(w); dictStop(); } else if (Date.now() - t0 > 15000) { clearInterval(w); dictCancel(); } }, 100); }
}, true);

function renderKeys() {
  const keys = KEYS.load(), base = KEYS.defaults();
  $("#send-key").value = KEYS.sendKey();
  $("#dict-mode").value = KEYS.dictMode();
  $("#keys-list").innerHTML = KEYS.ACTIONS.map((a) => `<li data-k="${a.id}"><span class="k-label">${esc(a.label)}<em>${esc(a.where)}</em></span>
    <button type="button" class="k-btn">${esc(KEYS.labelOf(keys[a.id]))}</button>
    ${keys[a.id] !== base[a.id] ? `<button type="button" class="k-reset">恢复默认</button>` : ""}</li>`).join("");
  updateComposerHint();
}
function updateComposerHint() {
  const k = KEYS.load();
  const send = KEYS.sendKey() === "mod-enter" ? `${KEYS.isMac() ? "⌘" : "Ctrl＋"}回车发送` : "回车发送，Shift＋回车换行";
  $("#ask-btn").title = `发送（${send}）`;
  $("#mic-btn").title = `语音输入${k.dictate ? `（${KEYS.labelOf(k.dictate)}）` : ""}`;
}
$("#send-key").addEventListener("change", (e) => { KEYS.setSendKey(e.target.value); updateComposerHint(); });
$("#dict-mode").addEventListener("change", (e) => { KEYS.setDictMode(e.target.value); });
$("#keys-list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-k]");
  if (!li) return;
  const id = li.dataset.k;
  if (e.target.closest(".k-reset")) { const keys = KEYS.load(); keys[id] = KEYS.defaults()[id]; KEYS.save(keys); renderKeys(); return; }
  const btn = e.target.closest(".k-btn");
  if (!btn) return;
  btn.classList.add("rec"); btn.textContent = "请按下组合键…";
  $(".k-err", li)?.remove();
  keyRecording = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (ev.key === "Escape") { stopRecording(); renderKeys(); return; }
    const combo = KEYS.comboOf(ev);
    if (!combo) return; // 只按了修饰键，继续等
    const keys = KEYS.load();
    const chk = KEYS.checkCombo(combo, { action: id, current: keys });
    stopRecording();
    if (!chk.ok) { renderKeys(); $(`li[data-k="${id}"]`).insertAdjacentHTML("beforeend", `<span class="k-err">${esc(chk.reason)}</span>`); return; }
    keys[id] = combo; KEYS.save(keys); renderKeys();
  };
  window.addEventListener("keydown", keyRecording, true);
});
function stopRecording() { if (keyRecording) window.removeEventListener("keydown", keyRecording, true); keyRecording = null; }
renderKeys();
