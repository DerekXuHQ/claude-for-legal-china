// 把助理的产出（Markdown）导出成 Word 文档：标题、段落、列表、表格、加粗。引用标记换成条文名称。
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from "docx";

const FONT = "SimSun";

function runs(text) {
  // **粗体** 与普通文字
  const out = [];
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    const bold = /^\*\*[^*]+\*\*$/.test(p);
    out.push(new TextRun({ text: bold ? p.slice(2, -2) : p.replace(/`/g, ""), bold, font: FONT, size: 22 }));
  }
  return out.length ? out : [new TextRun({ text: "", font: FONT })];
}

function table(lines) {
  const rows = lines.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim()));
  const cols = Math.max(...rows.map((r) => r.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, i) => new TableRow({
      children: Array.from({ length: cols }, (_, j) => new TableCell({
        borders: { top: border, bottom: border, left: border, right: border },
        children: [new Paragraph({ children: runs(i === 0 ? `**${r[j] || ""}**` : r[j] || "") })],
      })),
    })),
  });
}

/** @param {string} markdown 已经把 [[art:..]] 等标记处理过的文字 */
export async function markdownToDocx(title, markdown) {
  const clean = String(markdown).replace(/\[\[(art|law|case|ref):[^\]]+\]\]/g, "");
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: title, bold: true, font: FONT, size: 32 })] })];
  const lines = clean.split("\n");
  let tbl = [];
  const flush = () => { if (tbl.length) { children.push(table(tbl)); children.push(new Paragraph({ children: [] })); tbl = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) { tbl.push(line); continue; }
    flush();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Math.min(3, m[1].length - 1)];
      children.push(new Paragraph({ heading: level, children: [new TextRun({ text: m[2].replace(/\*\*/g, ""), bold: true, font: FONT, size: 26 })] }));
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: runs(m[1]) }));
    } else if ((m = line.match(/^\s*(\d+)[.、]\s+(.*)$/))) {
      children.push(new Paragraph({ children: runs(`${m[1]}. ${m[2]}`), indent: { left: 360 } }));
    } else if (/^>\s?/.test(line)) {
      children.push(new Paragraph({ children: runs(line.replace(/^>\s?/, "")), indent: { left: 480 } }));
    } else if (/^-{3,}$/.test(line.trim())) {
      children.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999" } } }));
    } else if (line.trim()) {
      children.push(new Paragraph({ children: runs(line), spacing: { after: 120 } }));
    }
  }
  flush();
  children.push(new Paragraph({ children: [] }));
  children.push(new Paragraph({ children: [new TextRun({ text: `本文件由中国法律检索的法律助理生成，仅供参考，不构成法律意见；正式使用前请经执业律师审核。生成时间：${new Date().toLocaleString("zh-CN")}`, italics: true, size: 18, font: FONT, color: "777777" })] }));
  const doc = new Document({ creator: "中国法律检索", title, sections: [{ children }] });
  return Packer.toBuffer(doc);
}
