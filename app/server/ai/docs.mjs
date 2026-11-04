// 用户上传的文件：取出文字。支持 Word（.docx）、PDF、纯文本和 Markdown。
import mammoth from "mammoth";

const MAX_CHARS = 200000;

export async function extractText(name, buffer) {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  let text;
  if (ext === "docx") {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      let line = "", out = [];
      let lastY = null;
      for (const it of c.items) {
        const y = it.transform?.[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ""; }
        line += it.str;
        lastY = y;
      }
      out.push(line);
      pages.push(out.join("\n"));
    }
    text = pages.join("\n\n");
  } else if (["txt", "md", "markdown", "csv", "text", ""].includes(ext)) {
    text = new TextDecoder("utf-8").decode(buffer);
  } else if (ext === "doc") {
    throw new Error("暂不支持旧版 .doc 文件，请另存为 .docx 或 PDF 后再上传");
  } else {
    throw new Error(`不支持的文件类型：.${ext}`);
  }
  text = text.replace(/\r\n?/g, "\n").replace(/[ \t　]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("没有从文件里读到文字（可能是扫描件图片，需要先做文字识别）");
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n\n〔文件过长，后面的部分没有读入〕" : text;
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
