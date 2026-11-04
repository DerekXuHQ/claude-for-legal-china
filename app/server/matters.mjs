// 事项（每件事一个工作区）：对话记录、上传的文件、助理的状态，存在 user.db；图片等原文件存在 data/files/。
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

export function ensureMatterTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matters(id TEXT PRIMARY KEY, title TEXT, created REAL, updated REAL, task TEXT DEFAULT '',
      state TEXT DEFAULT '{}', display TEXT DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS matter_files(id TEXT PRIMARY KEY, matter_id TEXT, name TEXT, kind TEXT, mime TEXT,
      chars INT, text TEXT, file TEXT, created REAL);
    CREATE INDEX IF NOT EXISTS idx_mf_matter ON matter_files(matter_id);
  `);
}

const now = () => Date.now() / 1000;

export function listMatters(db) {
  return db.prepare("SELECT id, title, created, updated, task, (SELECT count(*) FROM matter_files f WHERE f.matter_id = m.id) files FROM matters m ORDER BY updated DESC").all();
}

export function createMatter(db, title = "") {
  const id = randomUUID();
  db.prepare("INSERT INTO matters(id, title, created, updated) VALUES(?,?,?,?)").run(id, title || "新事项", now(), now());
  return id;
}

export function getMatter(db, id) {
  const m = db.prepare("SELECT * FROM matters WHERE id = ?").get(id);
  if (!m) return null;
  const files = db.prepare("SELECT id, name, kind, mime, chars, created FROM matter_files WHERE matter_id = ? ORDER BY created").all(id);
  return { ...m, state: JSON.parse(m.state || "{}"), display: JSON.parse(m.display || "[]"), files };
}

export function saveMatter(db, id, { state, display, title, task }) {
  const sets = ["updated = ?"], args = [now()];
  if (state !== undefined) { sets.push("state = ?"); args.push(JSON.stringify(state)); }
  if (display !== undefined) { sets.push("display = ?"); args.push(JSON.stringify(display)); }
  if (title !== undefined) { sets.push("title = ?"); args.push(String(title).slice(0, 80)); }
  if (task !== undefined) { sets.push("task = ?"); args.push(task); }
  db.prepare(`UPDATE matters SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
}

export function deleteMatter(db, dataDir, id) {
  for (const f of db.prepare("SELECT file FROM matter_files WHERE matter_id = ?").all(id)) {
    if (f.file) rmSync(path.join(dataDir, "files", f.file), { force: true });
  }
  db.prepare("DELETE FROM matter_files WHERE matter_id = ?").run(id);
  db.prepare("DELETE FROM matters WHERE id = ?").run(id);
}

export function addFile(db, dataDir, matterId, { name, kind, mime, text, buffer }) {
  const id = randomUUID();
  let file = "";
  if (buffer && kind !== "text") {
    mkdirSync(path.join(dataDir, "files"), { recursive: true });
    file = id + (path.extname(name) || "");
    writeFileSync(path.join(dataDir, "files", file), buffer);
  }
  db.prepare("INSERT INTO matter_files VALUES(?,?,?,?,?,?,?,?,?)").run(id, matterId, name, kind, mime || "", (text || "").length, text || "", file, now());
  return { id, name, kind, mime, chars: (text || "").length };
}

export function filesForAsk(db, matterId, ids = null) {
  const rows = db.prepare("SELECT id, name, kind, text FROM matter_files WHERE matter_id = ? ORDER BY created").all(matterId);
  return ids ? rows.filter((r) => ids.includes(r.id)) : rows;
}

export function filePath(db, dataDir, id) {
  const r = db.prepare("SELECT file, mime, name FROM matter_files WHERE id = ?").get(id);
  if (!r || !r.file) return null;
  const p = path.join(dataDir, "files", r.file);
  return existsSync(p) ? { path: p, mime: r.mime, name: r.name } : null;
}
