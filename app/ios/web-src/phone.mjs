// 手机布局的交互：事项列表默认收起、选完事项自动收起；点开条文、引用原文时全屏显示，左上角「返回」关闭。
// 界面脚本（renderer/app.js）加载之后调用。
export function setupPhone() {
  const phone = () => window.matchMedia("(max-width: 760px)").matches;
  const W = window;
  if (typeof W.setCollapsed !== "function") return;

  // 手机上不自动弹出键盘：界面代码里的 .focus() 只在桌面版生效，用户点输入框时照常
  const q = document.getElementById("question");
  if (q) q.focus = function (...a) { if (!phone()) return HTMLTextAreaElement.prototype.focus.apply(this, a); };
  // 打字时（键盘弹出）收起底部标签栏
  document.addEventListener("focusin", (e) => { if (phone() && e.target.matches?.("input, textarea, [contenteditable]")) document.body.classList.add("typing"); });
  document.addEventListener("focusout", () => setTimeout(() => { if (!document.activeElement?.matches?.("input, textarea, [contenteditable]")) document.body.classList.remove("typing"); }, 50));

  const collapseSides = () => { if (phone()) { W.setCollapsed("ask-left", true); W.setCollapsed("ask-right", true); } };
  collapseSides();

  // 点遮罩关闭事项抽屉
  document.addEventListener("click", (e) => {
    if (!phone()) return;
    const drawer = document.querySelector('[data-pane="ask-left"]');
    if (drawer && !drawer.classList.contains("collapsed") && !drawer.contains(e.target) && !e.target.closest('[data-toggle="ask-left"]')) W.setCollapsed("ask-left", true);
  }, true);

  // 打开事项后收起抽屉
  if (typeof W.openMatter === "function") {
    const orig = W.openMatter;
    W.openMatter = async (...a) => { const r = await orig(...a); if (phone()) W.setCollapsed("ask-left", true); return r; };
  }
  const nm = document.getElementById("new-matter");
  nm?.addEventListener("click", () => { if (phone()) setTimeout(() => W.setCollapsed("ask-left", true), 0); });

  // 全屏阅读：浏览 / 检索 / 收藏的详情，和法律助理里点引用打开的原文
  const back = document.createElement("button");
  back.className = "ios-back";
  back.type = "button";
  back.innerHTML = "‹ 返回";
  document.body.appendChild(back);
  const closeReading = () => {
    document.body.classList.remove("ios-reading");
    document.querySelectorAll(".split > .pane-right.reading").forEach((p) => p.classList.remove("reading"));
    if (phone()) W.setCollapsed("ask-right", true);
  };
  back.addEventListener("click", closeReading);

  if (typeof W.openItem === "function") {
    const orig = W.openItem;
    W.openItem = async (kind, id, target, ...rest) => {
      const r = await orig(kind, id, target, ...rest);
      if (phone() && target?.classList?.contains("pane-right")) {
        if (target.closest(".split")) target.classList.add("reading");
        document.body.classList.add("ios-reading");
      }
      return r;
    };
  }
  // 法律助理里展开原文面板时也显示「返回」
  const right = document.querySelector('[data-pane="ask-right"]');
  if (right) new MutationObserver(() => {
    if (!phone()) return;
    const open = !right.classList.contains("collapsed");
    if (open) document.body.classList.add("ios-reading");
    else if (!document.querySelector(".split > .pane-right.reading")) document.body.classList.remove("ios-reading");
  }).observe(right, { attributes: true, attributeFilter: ["class"] });

  // 切换标签页时关掉全屏面板
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", closeReading));
}

// 听写：页面拿不到麦克风时（app:// 不是安全来源），话筒按钮改用 iOS 的语音识别
import { call, on } from "./native.mjs";
export function setupNativeDictation() {
  if (navigator.mediaDevices?.getUserMedia && window.isSecureContext) return; // 页面能直接用麦克风，沿用原来的听写
  const old = document.getElementById("mic-btn");
  if (!old) return;
  const btn = old.cloneNode(true); // 去掉原来的点击处理
  old.replaceWith(btn);
  const icon = btn.innerHTML;
  const q = document.getElementById("question");
  let st = null; // { before, after, off }
  const ui = (state) => {
    btn.classList.toggle("rec", state === "on");
    btn.innerHTML = state === "on" ? `<span class="dict-wave"><i></i><i></i><i></i><i></i></span><span class="dict-label">正在听</span>` : state === "wait" ? `<span class="dict-label">准备中</span>` : icon;
    q.classList.toggle("dictating", state !== "idle");
  };
  const end = () => { st?.off?.(); st = null; ui("idle"); };
  btn.addEventListener("click", async () => {
    if (st) { call("speech.stop").catch(() => {}); setTimeout(() => { if (st) end(); }, 1500); return; }
    const c = q.selectionEnd ?? q.value.length;
    st = { before: q.value.slice(0, c), after: q.value.slice(c) };
    ui("wait");
    st.off = on("speech", (ev) => {
      if (!st) return;
      if (ev.error) { window.toast?.("听写出错：" + ev.error); end(); return; }
      q.value = st.before + (ev.text || "") + st.after;
      q.dispatchEvent(new Event("input", { bubbles: true }));
      if (ev.final) end();
    });
    try { await call("speech.start"); if (st) ui("on"); }
    catch (e) { window.toast?.(e.message); end(); }
  });
}

// 「软件版本」：iOS 版通过 App Store 更新，不显示桌面版的在线更新按钮
export function setupIosVersion() {
  const sec = document.querySelector('[data-sec="version"].set-sec');
  if (!sec) return;
  const p = sec.querySelector("p.muted");
  if (p) p.textContent = "iOS 版通过 App Store 更新（在 App Store 打开「自动更新」即可）。法规数据按「法规更新」里的设置从官方网站自动更新。";
  document.getElementById("au-check")?.closest(".row")?.remove();
  document.getElementById("app-update-btn")?.remove();
}
