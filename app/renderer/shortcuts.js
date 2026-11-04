// 快捷键（设置 → 快捷键），照搬 CopyDeck 的 shortcuts.js：每项能录制、恢复默认；
// 存成「主修饰键」写法（Mod = Mac 的 ⌘ / Windows 的 Ctrl），两个平台一套代码。存在本机（localStorage）。
(function () {
  const ACTIONS = [
    { id: "dictate", label: "开始 / 结束听写", where: "法律助理的输入框" },
    { id: "newMatter", label: "新建事项", where: "任何地方" },
    { id: "focusAsk", label: "跳到法律助理的输入框", where: "任何地方" },
    { id: "search", label: "检索法规", where: "任何地方" },
    { id: "settings", label: "打开设置", where: "任何地方" },
  ];
  const isMac = () => !/^win/i.test(navigator.platform || "");
  function defaults(mac = isMac()) {
    return { dictate: mac ? "Alt+Space" : "Mod+Shift+D", newMatter: "Mod+N", focusAsk: "Mod+J", search: "Mod+K", settings: "Mod+," };
  }
  // 系统占着的键：录了也收不到
  const SYSTEM = { mac: ["Mod+Q", "Mod+W", "Mod+H", "Mod+Tab", "Mod+Space", "Mod+M", "Mod+Ctrl+Space", "Mod+Alt+Esc"], win: ["Alt+F4", "Alt+Tab", "Alt+Space", "Mod+Alt+Delete", "Mod+Esc"] };
  // 编辑在用的键：改了会把复制粘贴弄坏
  const EDITING = ["Mod+C", "Mod+V", "Mod+X", "Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+A", "Mod+R", "Mod+Shift+R", "Mod+Enter"];
  const KEY_NAMES = { Space: "Space", Enter: "Enter", NumpadEnter: "Enter", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`", Tab: "Tab", Backspace: "Backspace", Escape: "Esc" };
  function keyOf(e) {
    const c = e.code || "";
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^F([1-9]|1[0-2])$/.test(c)) return c;
    if (/^Arrow/.test(c)) return c;
    if (KEY_NAMES[c]) return KEY_NAMES[c];
    const k = e.key || "";
    if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
    return { " ": "Space", Enter: "Enter", ",": ",", ".": ".", "/": "/" }[k] || "";
  }
  const MOD_KEYS = /^(Meta|Control|Alt|Shift|OS)/;
  function comboOf(e, mac = isMac()) {
    if (MOD_KEYS.test(e.key || "") || MOD_KEYS.test(e.code || "")) return "";
    const k = keyOf(e);
    if (!k) return "";
    const parts = [];
    if (mac ? e.metaKey : e.ctrlKey) parts.push("Mod");
    if (mac && e.ctrlKey) parts.push("Ctrl");
    if (!mac && e.metaKey) parts.push("Win");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    parts.push(k);
    return parts.join("+");
  }
  const matches = (e, combo) => !!combo && comboOf(e) === combo;
  function labelOf(combo, mac = isMac()) {
    if (!combo) return "不用快捷键";
    const MAC = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Space: "空格", Enter: "回车", Esc: "Esc" }, WIN = { Mod: "Ctrl", Win: "Win", Space: "空格", Enter: "回车" };
    const p = combo.split("+").map((x) => (mac ? MAC : WIN)[x] || x.replace(/^Arrow/, ""));
    return mac ? p.join("") : p.join("＋");
  }
  function checkCombo(combo, { action = "", current = {} } = {}) {
    const mac = isMac();
    if (!combo) return { ok: false, reason: "没认出这个键，换一个试试" };
    const parts = combo.split("+"), key = parts.at(-1), mods = parts.slice(0, -1).filter((m) => m !== "Shift");
    if (!mods.length && !/^F([1-9]|1[0-2])$/.test(key)) return { ok: false, reason: `要带 ${mac ? "⌘、⌃ 或 ⌥" : "Ctrl 或 Alt"}（F1–F12 可以单独用），不然打字时会误触` };
    if (SYSTEM[mac ? "mac" : "win"].includes(combo)) return { ok: false, reason: `${labelOf(combo)} 被系统占着，应用收不到，换一个` };
    if (EDITING.includes(combo)) return { ok: false, reason: `${labelOf(combo)} 是复制、粘贴、撤销或发送在用的，换一个` };
    const clash = ACTIONS.find((a) => a.id !== action && current[a.id] === combo);
    if (clash) return { ok: false, reason: `${labelOf(combo)} 已经给了「${clash.label}」；先把那一项改掉或恢复默认` };
    return { ok: true };
  }
  const get = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 存不了就只在本次有效 */ } };
  function load() {
    const out = { ...defaults() };
    let saved = {};
    try { saved = JSON.parse(get("cls.shortcuts") || "{}") || {}; } catch { saved = {}; }
    for (const a of ACTIONS) if (typeof saved[a.id] === "string") out[a.id] = saved[a.id];
    return out;
  }
  function save(keys) {
    const base = defaults(), diff = {};
    for (const a of ACTIONS) if (keys[a.id] !== base[a.id]) diff[a.id] = keys[a.id] ?? "";
    set("cls.shortcuts", JSON.stringify(diff));
  }
  // 发送方式：enter = 回车发送、Shift+回车换行；mod-enter = ⌘/Ctrl+回车发送、回车换行
  const sendKey = () => get("cls.sendKey") || "enter";
  const setSendKey = (v) => set("cls.sendKey", v);
  // 听写方式：toggle = 按一下开始、再按一下结束；hold = 按住说话、松开结束
  const dictMode = () => get("cls.dictMode") || "toggle";
  const setDictMode = (v) => set("cls.dictMode", v);
  window.KEYS = { ACTIONS, isMac, defaults, comboOf, matches, labelOf, checkCombo, load, save, sendKey, setSendKey, dictMode, setDictMode };
})();
