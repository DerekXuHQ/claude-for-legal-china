// 用户上传的文件：取出文字。
// 有文字层的直接读：Word（.docx/.doc）、PDF、PPT（.pptx）、Excel（.xlsx）、纯文本、Markdown、CSV、HTML、RTF、邮件（.eml）。
// 读不出文字的部分（扫描版 PDF 的页、Word/PPT 里贴的扫描图）交给文字识别（见 ocr.mjs）。
import mammoth from "mammoth";
import { createRequire } from "node:module";
import path from "node:path";

const PDF_ASSETS = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")) + path.sep;

const MAX_CHARS = 200000;
export const EXT = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();

// 正常文字：汉字（含扩展区、兼容区、生僻字）、中文标点、全角字符、字母数字和常见符号
const GOOD_CHAR = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u{20000}-\u{3134f}\u3000-\u303f\uff00-\uffef\u2000-\u206f\u00a0-\u00ffA-Za-z0-9.,;:!?()[\]《》〈〉【】“”‘’、，。；：！？（）%‰\-—–_/\\@#&*+=<>~·•…]/u;
// 乱码迹象：替换符、私用区（字体没有编码表时常见）、控制字符
const BAD_CHAR = /[\ufffd\ue000-\uf8ff\u0000-\u0008\u000e-\u001f]/u;
/** 文字里有没有乱码迹象（给识别结果和直接读到的文字做最后检查） */
export function garbleRatio(text) {
  const t = [...String(text || "").replace(/\s+/g, "")];
  return t.length ? t.filter((c) => BAD_CHAR.test(c)).length / t.length : 0;
}

/** 一页文字够不够用：太少，或大多是乱码（字体没嵌入编码表的 PDF 常见），就要识别 */
export function pageNeedsOcr(text) {
  const t = [...(text || "").replace(/\s+/g, "")];
  if (t.length < 25) return true;
  const good = t.filter((c) => GOOD_CHAR.test(c)).length;
  const bad = t.filter((c) => BAD_CHAR.test(c)).length;
  return good / t.length < 0.7 || bad / t.length > 0.02;
}

// 简繁常用字，用来判断文本文件编码
const COMMON = "的一是不了人我在有他这中大来上个国到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黄德收脸钱党倒未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似斯专石若兵弟谁校读志飞观争究包组造落视济喜离虽坏兴這個們來說時會為過對後麼於還發當經頭動長樣現將實點種聲話問機給幾業間電門東無與進從開學國說個們關係條款規定應該處罰賠償權利義務當事約訂協議甲乙雙方責任";

const scoreCommon = (s) => { let n = 0; for (const c of s) { if (COMMON.includes(c)) n += 2; else if (c === "\ufffd") n -= 5; } return n; };

/** 文本文件：先按 UTF-8（含 BOM / UTF-16），不合法再按 GB18030（Windows 记事本旧文件常见） */
export function decodeText(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^\ufeff/, ""); } catch { /* 不是 UTF-8 */ }
  // 简体（GBK/GB18030）还是繁体（Big5）：分别解码，常用字多、替换符少的那个对
  const cands = ["gb18030", "big5"].map((enc) => { try { return new TextDecoder(enc).decode(b); } catch { return ""; } });
  return scoreCommon(cands[1]) > scoreCommon(cands[0]) ? cands[1] : cands[0];
}

const xmlText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const IMG = /\.(png|jpe?g|gif|bmp|webp)$/i;
const mimeOf = (f) => ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" })[EXT(f)] || "image/png";
const numOf = (f) => Number(f.match(/(\d+)\.\w+$/)?.[1] || 0);

async function zipOf(buffer) { const JSZip = (await import("jszip")).default; return JSZip.loadAsync(buffer); }
/** 压缩包里的图片（跳过 15KB 以下的图标、logo） */
async function zipImages(zip, paths) {
  const out = [];
  for (const f of paths) {
    const e = zip.file(f);
    if (!e || !IMG.test(f)) continue;
    const buf = await e.async("nodebuffer");
    if (buf.length < 15000) continue;
    out.push({ data: buf.toString("base64"), mime: mimeOf(f), name: f.split("/").pop() });
  }
  return out;
}

async function readPptx(buffer) {
  const zip = await zipOf(buffer);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => numOf(a) - numOf(b));
  const parts = [], images = [];
  for (const f of slides) {
    const n = numOf(f);
    const xml = await zip.file(f).async("string");
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => xmlText(m[1])).join("")).filter((x) => x.trim());
    let notes = "";
    const nf = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    if (nf) notes = [...(await nf.async("string")).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => xmlText(m[1])).join("").trim();
    parts.push(`【第 ${n} 页幻灯片】\n${paras.join("\n")}${notes && !/^\d+$/.test(notes) ? `\n（备注：${notes}）` : ""}`);
    if (paras.join("").replace(/\s/g, "").length < 20) {
      const rels = zip.file(`ppt/slides/_rels/slide${n}.xml.rels`);
      const targets = rels ? [...(await rels.async("string")).matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => "ppt/media/" + m[1]) : [];
      for (const img of await zipImages(zip, targets)) images.push({ ...img, label: `第 ${n} 页幻灯片里的图片`, slot: parts.length - 1 });
    }
  }
  return { parts, images };
}

async function readXlsx(buffer) {
  const zip = await zipOf(buffer);
  const sst = zip.file("xl/sharedStrings.xml") ? [...(await zip.file("xl/sharedStrings.xml").async("string")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => xmlText(x[1])).join("")) : [];
  const wb = await zip.file("xl/workbook.xml")?.async("string") || "";
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string") || "";
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?(xl\/)?/, "xl/")]));
  const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: xmlText(m[1]), file: relMap[m[2]] }));
  // 日期格式的单元格：Excel 存的是天数（1900 年起），按样式表里的数字格式换回日期
  const styles = await zip.file("xl/styles.xml")?.async("string") || "";
  const custom = Object.fromEntries([...styles.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [m[1], xmlText(m[2])]));
  const xfs = [...(styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "").matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map((m) => m[1]);
  const isDateFmt = (id) => (+id >= 14 && +id <= 22) || (+id >= 45 && +id <= 47) || (+id >= 27 && +id <= 36) || (+id >= 50 && +id <= 58) || (custom[id] && /[ymd]|[年月日]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]/g, "")) && !/^[#0.,%]+$/.test(custom[id]));
  const fmtDate = (v) => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)); const iso = d.toISOString(); return v % 1 ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10); };
  const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const out = [];
  for (const sh of sheets) {
    const xml = await zip.file(sh.file)?.async("string");
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+\d+)"/)?.[1] || "";
        const t = c[1].match(/t="(\w+)"/)?.[1];
        const v = c[2]?.match(/<v>([^<]*)<\/v>/)?.[1];
        const st = c[1].match(/\bs="(\d+)"/)?.[1];
        let val = (!t || t === "n") && v != null && st && isDateFmt(xfs[+st]) && !isNaN(+v) ? fmtDate(+v) : t === "s" ? sst[+v] ?? "" : t === "inlineStr" ? [...(c[2] || "").matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => xmlText(x[1])).join("") : v != null ? xmlText(v) : "";
        cells[ref ? col(ref) : cells.length] = String(val).replace(/\s+/g, " ");
      }
      if (cells.some((x) => x)) rows.push(Array.from(cells, (x) => x || "").join("\t"));
      if (rows.length >= 3000) { rows.push("〔行数过多，后面的行没有读入〕"); break; }
    }
    if (rows.length) out.push(`【工作表：${sh.name}】\n${rows.join("\n")}`);
  }
  return out.join("\n\n");
}

function htmlToText(html) {
  return tidyLines(xmlText(html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n").replace(/<\/t[dh]>/gi, "\t").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")));
}
/** 每行去掉首尾空白，连续空行并成一个（网页源码缩进多） */
const tidyLines = (t) => t.split("\n").map((l) => l.replace(/[ \t\u00a0　]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n");

// RTF：中文写成 \\'xx 字节，编码看字体表里的 \\fcharset（134 = GBK，136 = Big5），没写就按常用字判断
const RTF_CHARSET = { 0: "windows-1252", 128: "shift_jis", 129: "euc-kr", 134: "gb18030", 136: "big5", 222: "windows-874", 238: "windows-1250" };
function dropGroup(s, re) { // 去掉以 re 开头的 {...} 整组（处理嵌套括号）
  for (let m; (m = re.exec(s)); ) {
    let depth = 0, i = m.index;
    for (; i < s.length; i++) { if (s[i] === "\\") { i++; continue; } if (s[i] === "{") depth++; else if (s[i] === "}" && --depth === 0) break; }
    s = s.slice(0, m.index) + s.slice(i + 1);
    re.lastIndex = 0;
  }
  return s;
}
function rtfToText(buffer) {
  let s = buffer.toString("latin1");
  const cp = s.match(/\\ansicpg(\d+)/)?.[1];
  const fonts = {};
  for (const m of (s.match(/\{\\fonttbl[\s\S]*?\}\s*\}/)?.[0] || "").matchAll(/\\f(\d+)[^;{}]*?\\fcharset(\d+)/g)) fonts[m[1]] = RTF_CHARSET[m[2]];
  s = dropGroup(s, /\{\\(fonttbl|colortbl|stylesheet|info|listtable|listoverridetable|pict|\*)/g);
  const guess = (bytes) => { const c = ["gb18030", "big5"].map((e) => new TextDecoder(e).decode(bytes)); return scoreCommon(c[1]) > scoreCommon(c[0]) ? "big5" : "gb18030"; };
  let font = null;
  s = s.replace(/\\f(\d+)\b|((?:\\'[0-9a-f]{2})+)/gi, (all, f, run) => {
    if (f !== undefined) { font = f; return ""; }
    const bytes = Uint8Array.from(run.match(/'([0-9a-f]{2})/gi).map((h) => parseInt(h.slice(1), 16)));
    const enc = (font && fonts[font] && fonts[font] !== "windows-1252" ? fonts[font] : null) || (cp === "936" ? "gb18030" : cp === "950" ? "big5" : bytes.some((b) => b > 0x80) && bytes.length > 1 ? guess(bytes) : "windows-1252");
    try { return new TextDecoder(enc).decode(bytes); } catch { return ""; }
  });
  s = s.replace(/\\u(-?\d+) ?\??/g, (_, n) => String.fromCharCode((+n + 65536) % 65536));
  return s.replace(/\\(par|line)\b ?/g, "\n").replace(/\\tab\b ?/g, "\t").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/\\\n/g, "\n").replace(/[{}]/g, "").replace(/\\([\\{}])/g, "$1");
}

function emlToText(buffer) {
  const raw = buffer.toString("latin1");
  const head = raw.split(/\r?\n\r?\n/)[0];
  const dec = (s) => s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, cs, e, d) => { try { const b = e.toUpperCase() === "B" ? Buffer.from(d, "base64") : Buffer.from(d.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), "latin1"); return new TextDecoder(cs).decode(b); } catch { return d; } });
  const hdr = ["From", "To", "Cc", "Date", "Subject"].map((k) => { const m = head.match(new RegExp(`^${k}:\\s*(.*(?:\\r?\\n[ \\t].*)*)`, "mi")); return m ? `${k}: ${dec(m[1].replace(/\r?\n[ \t]+/g, " "))}` : ""; }).filter(Boolean);
  const bodies = [];
  for (const part of raw.split(/\r?\n--[^\r\n]+/)) {
    const ct = part.match(/Content-Type:\s*text\/(plain|html)[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/i);
    if (!ct) continue;
    const cs = ct[0].match(/charset="?([\w-]+)/i)?.[1] || "utf-8";
    const te = part.match(/Content-Transfer-Encoding:\s*([\w-]+)/i)?.[1]?.toLowerCase();
    let body = part.split(/\r?\n\r?\n/).slice(1).join("\n\n");
    let bytes = te === "base64" ? Buffer.from(body.replace(/\s+/g, ""), "base64") : te === "quoted-printable" ? Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), "latin1") : Buffer.from(body, "latin1");
    let text; try { text = new TextDecoder(cs).decode(bytes); } catch { text = bytes.toString("utf-8"); }
    bodies.push({ html: ct[1].toLowerCase() === "html", text });
  }
  const best = bodies.find((b) => !b.html) || bodies[0];
  return [...hdr, "", best ? (best.html ? htmlToText(best.text) : best.text) : ""].join("\n");
}

// pdf.js 在 Node 里要 DOMMatrix，默认从原生模块 @napi-rs/canvas 取；可是安装包里的原生模块只对应打包那台机器的芯片
// （在 Mac 上打的 Windows 安装包里是 Mac 的版本），装错了就整个读不了 PDF。取文字只需要二维变换，这里自带一个纯 JS 的，
// 不依赖原生模块，所有平台都一样。
class Matrix2D {
  constructor(init) {
    const m = Array.isArray(init) || ArrayBuffer.isView(init) ? [...init] : init && typeof init === "object" ? [init.a, init.b, init.c, init.d, init.e, init.f] : [1, 0, 0, 1, 0, 0];
    [this.a, this.b, this.c, this.d, this.e, this.f] = m.length === 16 ? [m[0], m[1], m[4], m[5], m[12], m[13]] : m.length >= 6 ? m : [1, 0, 0, 1, 0, 0];
  }
  get m11() { return this.a; } get m12() { return this.b; } get m21() { return this.c; } get m22() { return this.d; } get m41() { return this.e; } get m42() { return this.f; }
  get is2D() { return true; }
  get isIdentity() { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0; }
  static #mul(p, q) { return [p.a * q.a + p.c * q.b, p.b * q.a + p.d * q.b, p.a * q.c + p.c * q.d, p.b * q.c + p.d * q.d, p.a * q.e + p.c * q.f + p.e, p.b * q.e + p.d * q.f + p.f]; }
  #set(v) { [this.a, this.b, this.c, this.d, this.e, this.f] = v; return this; }
  multiplySelf(o) { return this.#set(Matrix2D.#mul(this, new Matrix2D(o))); }
  preMultiplySelf(o) { return this.#set(Matrix2D.#mul(new Matrix2D(o), this)); }
  multiply(o) { return new Matrix2D(this).multiplySelf(o); }
  translateSelf(x = 0, y = 0) { return this.multiplySelf([1, 0, 0, 1, x, y]); }
  translate(x, y) { return new Matrix2D(this).translateSelf(x, y); }
  scaleSelf(sx = 1, sy = sx) { return this.multiplySelf([sx, 0, 0, sy, 0, 0]); }
  scale(sx, sy) { return new Matrix2D(this).scaleSelf(sx, sy); }
  invertSelf() {
    const det = this.a * this.d - this.b * this.c;
    if (!det) return this.#set([NaN, NaN, NaN, NaN, NaN, NaN]);
    return this.#set([this.d / det, -this.b / det, -this.c / det, this.a / det, (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det]);
  }
  inverse() { return new Matrix2D(this).invertSelf(); }
  transformPoint(p = {}) { const x = p.x || 0, y = p.y || 0; return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 }; }
  toFloat32Array() { return Float32Array.of(this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1); }
}
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = Matrix2D;

async function readPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // 中文 PDF 常用 Adobe-GB1 / CNS1 预置编码表，不给 cMapUrl 时这类字会读成空白或乱码
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, cMapUrl: PDF_ASSETS + "cmaps/", cMapPacked: true, standardFontDataUrl: PDF_ASSETS + "standard_fonts/" }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    let line = "", out = [], lastY = null;
    for (const it of c.items) {
      const y = it.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ""; }
      line += it.str;
      lastY = y;
    }
    out.push(line);
    pages.push(out.join("\n"));
  }
  return pages;
}

/**
 * 读文件。返回：
 * - text：能直接读到的文字
 * - ocrPages：PDF 里需要识别的页码（从 1 开始）以及每页已有文字 pages（识别后按页拼回去）
 * - images：Word/PPT 里需要识别的图片 [{data, mime, label, slot?}]
 */
export async function extractDoc(name, buffer) {
  const ext = EXT(name);
  if (ext === "pdf") {
    const pages = await readPdf(buffer);
    const ocrPages = pages.map((t, i) => (pageNeedsOcr(t) ? i + 1 : 0)).filter(Boolean);
    return { pages, ocrPages, text: pages.join("\n\n") };
  }
  if (ext === "docx") {
    // Node 版 mammoth 收 buffer，浏览器版（iOS App 里）收 arrayBuffer；两个都给
    const ab = buffer.buffer ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) : buffer;
    const text = (await mammoth.extractRawText({ buffer, arrayBuffer: ab })).value;
    const zip = await zipOf(buffer);
    const media = Object.keys(zip.files).filter((f) => /^word\/media\//.test(f)).sort((a, b) => numOf(a) - numOf(b));
    const len = text.replace(/\s/g, "").length;
    // 正文很少、或者图片多而文字少（扫描件贴进 Word）时，识别图片
    const images = media.length && (len < 300 || (media.length >= 3 && len / media.length < 400)) ? (await zipImages(zip, media)).map((x, i) => ({ ...x, label: `文档里的第 ${i + 1} 张图片` })) : [];
    return { text, images };
  }
  if (ext === "doc") {
    const WordExtractor = (await import("word-extractor")).default;
    const d = await new WordExtractor().extract(buffer);
    return { text: [d.getBody(), d.getFootnotes?.(), d.getEndnotes?.()].filter((x) => x && x.trim()).join("\n\n") };
  }
  if (ext === "pptx") {
    const { parts, images } = await readPptx(buffer);
    return { parts, images, text: parts.join("\n\n") };
  }
  if (ext === "xlsx" || ext === "xlsm") return { text: await readXlsx(buffer) };
  if (ext === "ppt") throw new Error("旧版 .ppt 文件请另存为 .pptx 或 PDF 后再上传");
  if (ext === "xls") throw new Error("旧版 .xls 文件请另存为 .xlsx 或 PDF 后再上传");
  if (ext === "html" || ext === "htm") return { text: htmlToText(decodeText(buffer)) };
  if (ext === "rtf") return { text: rtfToText(Buffer.from(buffer)) };
  if (ext === "eml") return { text: emlToText(Buffer.from(buffer)) };
  if (["txt", "md", "markdown", "csv", "tsv", "text", "json", "xml", "log", ""].includes(ext)) return { text: decodeText(buffer) };
  throw new Error(`不支持的文件类型：.${ext}`);
}

/** 整理并截断 */
// 康熙部首、部首补充区（PDF 字体常把「方人月」映射成长得一样的「⽅⼈⽉」）换回正常汉字，否则检索和核对都对不上
const RADICAL = /[\u2e80-\u2eff\u2f00-\u2fdf]/g;
// 部首补充区没有标准对应关系，常见的简化部首手工对应
const RADICAL_SUP = { "⺠": "民", "⺟": "母", "⺩": "王", "⻁": "虎", "⻄": "西", "⻆": "角", "⻅": "见", "⻓": "长", "⻔": "门", "⻋": "车", "⻙": "韦", "⻚": "页", "⻛": "风", "⻜": "飞", "⻝": "食", "⻢": "马", "⻣": "骨", "⻤": "鬼", "⻥": "鱼", "⻦": "鸟", "⻧": "卤", "⻨": "麦", "⻩": "黄", "⻬": "齐", "⻮": "齿", "⻰": "龙", "⻳": "龟", "⻊": "足", "⻉": "贝", "⻈": "讠" };
export const fixRadicals = (s) => s.replace(RADICAL, (c) => RADICAL_SUP[c] || c.normalize("NFKC"));

export function tidy(text) {
  text = fixRadicals(String(text || "")).replace(/\r\n?/g, "\n").replace(/[ \t　]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n\n〔文件过长，后面的部分没有读入〕" : text;
}

/** 只要直接能读到的文字（不做识别），给不需要识别的调用方用 */
export async function extractText(name, buffer) {
  const r = await extractDoc(name, buffer);
  const text = tidy(r.text);
  if (!text) throw new Error("没有从文件里读到文字");
  return text;
}

/** 按条款切分合同：「第X条」「一、」「1.」「1.1」等开头的行视为条款起点；再按长度合并成段。 */
export function splitClauses(text, maxChars = 3500) {
  const lines = text.split("\n");
  const starts = /^\s*(第[零〇一二三四五六七八九十百千0-9]+[条章节]|[一二三四五六七八九十]+[、．.]|\d+(\.\d+)*[、．.\s]|（[一二三四五六七八九十]+）)/;
  const clauses = [];
  let cur = [];
  for (const l of lines) {
    if (starts.test(l) && cur.length) { clauses.push(cur.join("\n")); cur = []; }
    cur.push(l);
  }
  if (cur.length) clauses.push(cur.join("\n"));
  const chunks = [];
  let buf = "";
  for (const c of clauses) {
    if (buf && buf.length + c.length > maxChars) { chunks.push(buf); buf = ""; }
    if (c.length > maxChars) {
      for (let i = 0; i < c.length; i += maxChars) chunks.push(c.slice(i, i + maxChars));
      continue;
    }
    buf += (buf ? "\n" : "") + c;
  }
  if (buf.trim()) chunks.push(buf);
  return chunks;
}
