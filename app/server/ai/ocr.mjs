// 文字识别：扫描件、照片、截图、视频画面统一交给视觉模型逐字转录。
// 一页一次调用（准确率最高），几页并行；视频画面几帧一组。
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { complete } from "./models.mjs";

/* ---------- 本机文字识别（初稿）----------
   Mac 用系统自带的 Vision，Windows 用系统自带的 Windows.Media.Ocr。它们对生僻字、繁体字认得准，但偶尔认错常见字；
   视觉模型正好相反。所以先用本机引擎出初稿，再让模型对照图片逐字核对，两边互相纠错。本机引擎不可用时只用模型。 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
let scriptDir = null;
function localScript(name) { // 脚本在 app.asar 里，系统工具读不到，复制到临时目录
  if (!scriptDir) scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "cls-ocr-"));
  const dst = path.join(scriptDir, name);
  if (!fs.existsSync(dst)) fs.writeFileSync(dst, fs.readFileSync(path.join(HERE, "ocr", name)));
  return dst;
}
const run = (cmd, args, timeout) => new Promise((ok) => execFile(cmd, args, { timeout, maxBuffer: 20e6, windowsHide: true, encoding: "utf8" }, (err, out) => ok(err ? "" : String(out || ""))));
// iOS 版：本机文字识别、HEIC、录音转换由原生层提供（ios/web-src/boot 里注册 globalThis.__iosNative）
const IOS = () => globalThis.__iosNative;
export async function localOcr(img) {
  if (IOS()) return IOS().ocr(img).catch(() => "");
  if (process.platform !== "darwin" && process.platform !== "win32") return "";
  const ext = /png/.test(img.mime) ? "png" : /bmp/.test(img.mime) ? "bmp" : /gif/.test(img.mime) ? "gif" : "jpg";
  const tmp = path.join(os.tmpdir(), `cls-ocr-${process.pid}-${Math.random().toString(36).slice(2)}.${ext}`);
  try {
    fs.writeFileSync(tmp, Buffer.from(img.data, "base64"));
    let text = process.platform === "darwin"
      ? await run("/usr/bin/osascript", ["-l", "JavaScript", localScript("vision-mac.js"), tmp], 90000)
      : await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", localScript("ocr-win.ps1"), "-Path", tmp], 90000);
    // Windows 的识别结果在汉字之间加空格，去掉
    text = text.replace(/(?<=[\u3000-\u9fff\uff00-\uffef]) (?=[\u3000-\u9fff\uff00-\uffef])/g, "").trim();
    return text;
  } catch { return ""; } finally { fs.rmSync(tmp, { force: true }); }
}

// 异体字、新旧字形：模型常把原文的写法「改正」成它更熟悉的另一种。两种都是正确的字，但原件写哪种就得是哪种。
const VARIANTS = ["賬帳", "裡裏", "着著", "群羣", "綫線", "為爲", "峰峯", "污汙", "眾衆", "床牀", "卻却", "夠够", "歎嘆", "啟啓", "敘敍", "雞鷄", "繡綉", "溫温", "冊册", "屍尸", "鉤鈎", "淨净", "覆复", "彥彦", "颜顏", "姊姐", "於于", "週周", "台臺", "臺檯", "里裡", "叙敘", "录錄", "镕熔", "喆哲", "堃坤", "淼渺", "昇升", "陞升", "璐路"];
const VARIANT_OF = new Map();
for (const [a, b] of VARIANTS) { VARIANT_OF.set(a + b, true); VARIANT_OF.set(b + a, true); }
// GB2312 收的 6763 个常用字。初稿里是 GB2312 以外的字（生僻字、繁体字），模型却在同一位置写了别的字，
// 多半是模型把它不熟的字「纠正」成了长得像的字（实测：龑→翼、龑→襲、陳→陈），这时以初稿为准。
const GB2312 = (() => {
  const set = new Set(), dec = new TextDecoder("gb18030");
  for (let hi = 0xb0; hi <= 0xf7; hi++) for (let lo = 0xa1; lo <= 0xfe; lo++) { const c = dec.decode(Uint8Array.of(hi, lo)); if (c.length === 1 && c !== "\ufffd") set.add(c); }
  return set;
})();
const isHan = (c) => /\p{Script=Han}/u.test(c);

/** 把模型结果和本机初稿逐字对齐（遇到不同就往后找重新对上的位置）；等长替换的地方逐字判断：
 *  一对异体字，或初稿是 GB2312 以外的字而模型写了常用字，就恢复初稿的写法。 */
export function keepDraftVariants(draft, final) {
  if (!draft) return final;
  const d = [...draft.replace(/\s+/g, "")];
  const f = [...final];
  const idx = [];
  f.forEach((c, i) => { if (!/\s/.test(c)) idx.push(i); });
  const g = idx.map((i) => f[i]);
  const same = (i, j, n) => { for (let k = 0; k < n; k++) if (d[i + k] === undefined || d[i + k] !== g[j + k]) return false; return true; };
  let i = 0, j = 0;
  while (i < d.length && j < g.length) {
    if (d[i] === g[j]) { i++; j++; continue; }
    // 找最近的重新对齐点：两边各往后跳 a、b 个字之后连续 3 个字相同
    let best = null;
    for (let s2 = 1; s2 <= 24 && !best; s2++) for (let a = 0; a <= s2; a++) { const b = s2 - a; if (same(i + a, j + b, 3)) { best = [a, b]; break; } }
    const [a, b] = best || [1, 1]; // 对不上（多半到了结尾）就当作一个字的替换
    if (a === b) for (let k = 0; k < a; k++) {
      const want = d[i + k], got = g[j + k];
      // 初稿是 GB2312 以外的字（生僻字、繁体字）：本机引擎实测从不凭空造出生僻字，模型却常把它换成长得像的字（龑→翼／襲），以初稿为准
      if (isHan(want) && isHan(got) && (VARIANT_OF.has(want + got) || !GB2312.has(want))) f[idx[j + k]] = want;
    }
    i += a; j += b;
  }
  return f.join("");
}

const CHECK_PROMPT = (draft) => `
下面是本机文字识别引擎的初稿。它对生僻字、繁体字通常认得准，但偶尔会认错常见字、漏字、断行或丢掉表格结构。请以图片为准逐字核对初稿：
两者不一致的地方仔细看图片；初稿的字和图上字形一致就必须保留——即使你觉得另一种写法更常见或更规范（如 賬/帳、裡/裏、着/著、群/羣），也不要替换；生僻字、繁体字、异体字都照初稿；只有初稿的字和图上字形明显不同（如把「同」认成「司」）才改；初稿漏的补上。
【初稿】
${draft}`;

const PAGE_PROMPT = (label) => `这是用户上传给律师助理的材料${label ? `（${label}）` : ""}，可能是扫描件、照片或截图。
请把上面所有文字逐字、完整地转录出来：
- 保持原有的段落、编号和换行；表格用 Markdown 表格；
- 聊天截图保留每句话的说话人和时间；
- 印章、签名、手写内容写成〔印章：××公司〕〔签名：××〕〔手写：……〕；看不清的字写〔?〕；
- 原文是繁体就照繁体写，异体字、生僻字（人名、地名里常见）照原样写，不要改成简体或近似字；全角半角标点照原样；
- 数字、金额、日期、身份证号、案号、条款编号逐位核对，宁可标〔?〕也不要猜；
- 不要总结、不要解释、不要改正原文的错别字；
- 页面没有文字时只输出「（空白页）」。`;

const FRAMES_PROMPT = `下面是用户上传的一段视频按时间截取的画面，每张图前面标了时间点。
请转录画面里出现的所有文字（字幕、屏幕上的文件、聊天记录、PPT、标牌等），按时间点列出：
「[mm:ss] 文字内容」。前后画面里重复出现的同一段文字只写一次；没有文字的画面跳过，可以用一句话描述关键画面（如「两人在办公室谈话」）。繁体、生僻字照原样写，不要改成简体。不要分析。`;

const dataUrl = (img) => `data:${img.mime || "image/jpeg"};base64,${img.data}`;

/** 识别一张图（一页）。img: {data: base64, mime} */
export async function ocrImage(settings, { model, img, label = "", signal }) {
  const draft = await localOcr(img);
  if (process.env.CLS_DEBUG) { console.error(`[ocr] ${label} 本机初稿 ${draft.length} 字：${draft.slice(0, 80).replace(/\n/g, " ")}`); if (process.env.CLS_DEBUG === "2") fs.writeFileSync(path.join(os.tmpdir(), `cls-ocr-last-${label.replace(/\W/g, "")}.${/png/.test(img.mime) ? "png" : "jpg"}`), Buffer.from(img.data, "base64")); }
  const r = await complete(settings, {
    model, effort: "low", signal,
    messages: [{ role: "user", content: [{ type: "text", text: PAGE_PROMPT(label) + (draft ? CHECK_PROMPT(draft.slice(0, 20000)) : "") }, { type: "image_url", image_url: { url: dataUrl(img), detail: "high" } }] }],
  });
  return keepDraftVariants(draft, (r.choices?.[0]?.message?.content || "").trim());
}

/** 识别视频画面。frames: [{data, mime, t(秒)}] */
export async function ocrFrames(settings, { model, frames, signal }) {
  const drafts = [];
  for (const f of frames) drafts.push(await localOcr(f));
  const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const content = [{ type: "text", text: FRAMES_PROMPT }];
  frames.forEach((f, i) => content.push({ type: "text", text: `[${mmss(f.t || 0)}]${drafts[i] ? `\n（本机识别初稿，生僻字、繁体字通常准，常见字偶尔认错；以画面为准核对，初稿与画面一致的写法照抄，不要改成更常见的字）\n${drafts[i].slice(0, 4000)}` : ""}` }, { type: "image_url", image_url: { url: dataUrl(f), detail: "high" } }));
  const r = await complete(settings, { model, effort: "low", signal, messages: [{ role: "user", content }] });
  return keepDraftVariants(drafts.join("\n"), (r.choices?.[0]?.message?.content || "").trim());
}

/** 并行识别多页，保持顺序；onProgress(done, total) */
export async function ocrPages(settings, { model, images, labelOf = (i) => `第 ${i + 1} 页`, concurrency = 4, signal, onProgress }) {
  const out = new Array(images.length).fill("");
  let next = 0, done = 0;
  async function worker() {
    while (next < images.length) {
      const i = next++;
      out[i] = await ocrImage(settings, { model, img: images[i], label: labelOf(i), signal });
      onProgress?.(++done, images.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, worker));
  return out;
}

/* ---------- TIFF（扫描仪常用，可能多页）：解码后转成 PNG 再识别 ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngFromRGBA(rgba, w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
/** TIFF → [{data, mime:"image/png"}]，每页一张；过大的页按 2 倍抽样缩小 */
export async function tiffToPngs(buffer) {
  const UTIF = (await import("utif")).default;
  const ifds = UTIF.decode(buffer);
  const pages = [];
  for (const ifd of ifds.slice(0, 60)) {
    UTIF.decodeImage(buffer, ifd);
    let w = ifd.width, h = ifd.height;
    if (!w || !h) continue;
    let rgba = UTIF.toRGBA8(ifd);
    while (w * h > 9e6) { // 缩小到 900 万像素以内
      const nw = w >> 1, nh = h >> 1, small = new Uint8Array(nw * nh * 4);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let k = 0; k < 4; k++) small[(y * nw + x) * 4 + k] = rgba[(y * 2 * w + x * 2) * 4 + k];
      rgba = small; w = nw; h = nh;
    }
    pages.push({ data: pngFromRGBA(rgba, w, h).toString("base64"), mime: "image/png" });
  }
  return pages;
}

/** HEIC（苹果手机照片）：Mac 上用系统自带的 sips 转成 JPEG；其他系统提示转换 */
export async function heicToJpeg(buffer) {
  if (IOS()) return IOS().heicToJpeg(buffer);
  if (process.platform !== "darwin") throw new Error("这台电脑不能直接读取 HEIC 照片，请在手机或相册里导出为 JPG 后再上传");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(path.join(tmpdir(), "cls-heic-"));
  try {
    writeFileSync(path.join(dir, "in.heic"), buffer);
    execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", path.join(dir, "in.heic"), "--out", path.join(dir, "out.jpg")], { stdio: "ignore", timeout: 60000 });
    return { data: readFileSync(path.join(dir, "out.jpg")).toString("base64"), mime: "image/jpeg" };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** 前端解不了的录音格式（如手机通话录音常见的 AMR）：Mac 上用系统自带的 afconvert 转成 24kHz 单声道 WAV */
export async function audioToWav16k(buffer, ext) {
  if (IOS()) return IOS().audioToWav(buffer, ext);
  if (process.platform !== "darwin") throw new Error("读不出这个录音的格式，请先导出成 m4a、mp3 或 wav 再上传");
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(path.join(tmpdir(), "cls-audio-"));
  try {
    const inp = path.join(dir, "in." + (ext || "bin")), out = path.join(dir, "out.wav");
    writeFileSync(inp, buffer);
    try { execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", inp, out], { stdio: "ignore", timeout: 300000 }); }
    catch { throw new Error("读不出这个录音的格式，请先导出成 m4a、mp3 或 wav 再上传"); }
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
