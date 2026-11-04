"""Claude for Legal China：本地法律检索服务。

运行：.venv/bin/python server.py [--port 8765]
只监听 127.0.0.1。设置（含 API key）存放在 data/settings.json，收藏和 AI 回答存放在 data/user.db。
"""
import argparse
import json
import os
import sqlite3
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import agent
import search

APP = Path(__file__).resolve().parent
DATA = APP / "data"
STATIC = APP / "static"
SETTINGS = DATA / "settings.json"
USER_DB = DATA / "user.db"
DEFAULT_SETTINGS = {"provider": "anthropic", "base_url": "", "api_key": "", "model": "claude-opus-5-5",
                    "effort": "medium", "extra_headers": {}, "fallback": True}
MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}

_conversations: dict[str, list] = {}
_user_lock = threading.Lock()


def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    if SETTINGS.exists():
        s.update(json.loads(SETTINGS.read_text(encoding="utf-8")))
    if not s["api_key"] and s["provider"] == "anthropic" and os.environ.get("ANTHROPIC_API_KEY"):
        s["api_key"] = os.environ["ANTHROPIC_API_KEY"]
    return s


def save_settings(new: dict) -> None:
    s = load_settings()
    for k in DEFAULT_SETTINGS:
        if k in new and not (k == "api_key" and new[k] == "********"):
            s[k] = new[k]
    SETTINGS.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(SETTINGS, 0o600)


def user_db() -> sqlite3.Connection:
    conn = sqlite3.connect(USER_DB)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """CREATE TABLE IF NOT EXISTS bookmarks(id INTEGER PRIMARY KEY, kind TEXT, ref_id TEXT, title TEXT,
               subtitle TEXT, snippet TEXT, note TEXT, created REAL, UNIQUE(kind, ref_id));
           CREATE TABLE IF NOT EXISTS answers(id TEXT PRIMARY KEY, question TEXT, region TEXT, answer TEXT,
               steps TEXT, model TEXT, created REAL);"""
    )
    return conn


class Handler(BaseHTTPRequestHandler):
    server_version = "ClaudeForLegalChina/1.0"

    def log_message(self, fmt, *args):  # 安静一点，只打印错误
        pass

    # ---------- 工具 ----------
    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _same_origin(self) -> bool:
        # 拒绝其他网页跨站调用本地接口
        origin = self.headers.get("Origin")
        return not origin or urlparse(origin).hostname in ("127.0.0.1", "localhost")

    # ---------- GET ----------
    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        path = unquote(url.path)
        try:
            if path == "/api/meta":
                s = load_settings()
                return self._json({**search.meta(), "configured": bool(s["api_key"]) or s["provider"] == "openai" and bool(s["base_url"])})
            if path == "/api/search":
                kind = q.get("type", "articles")
                limit, offset = int(q.get("limit", 20)), int(q.get("offset", 0))
                common = dict(level=q.get("level", ""), province=q.get("province", ""), topic=q.get("topic", ""),
                              current_only=q.get("all") != "1", limit=limit, offset=offset)
                text = q.get("q", "")
                if kind == "laws":
                    return self._json(search.search_laws(text, **common))
                if kind == "cases":
                    return self._json(search.search_cases(text, limit=limit, offset=offset))
                if kind == "refs":
                    return self._json(search.search_refs(text, limit=limit, offset=offset))
                return self._json(search.search_articles(text, **common))
            if path.startswith("/api/item/"):
                kind, item_id = path[len("/api/item/"):].split("/", 1)
                getter = {"article": search.get_article, "law": search.get_doc, "case": search.get_case, "ref": search.get_ref}.get(kind)
                if kind == "answer":
                    with _user_lock, user_db() as conn:
                        r = conn.execute("SELECT * FROM answers WHERE id = ?", (item_id,)).fetchone()
                    return self._json({**dict(r), "kind": "answer"} if r else {"error": "未找到"}, 200 if r else 404)
                item = getter(item_id) if getter else None
                return self._json(item or {"error": "未找到"}, 200 if item else 404)
            if path == "/api/bookmarks":
                with _user_lock, user_db() as conn:
                    rows = conn.execute("SELECT * FROM bookmarks ORDER BY created DESC").fetchall()
                return self._json([dict(r) for r in rows])
            if path == "/api/settings":
                s = load_settings()
                return self._json({**s, "api_key": "********" if s["api_key"] else ""})
            return self._static(path)
        except Exception as e:
            traceback.print_exc()
            return self._json({"error": str(e)}, 500)

    def _static(self, path: str):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (STATIC / rel).resolve()
        if not target.is_relative_to(STATIC) or not target.is_file():
            return self._json({"error": "未找到"}, 404)
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # ---------- POST / DELETE ----------
    def do_POST(self):
        if not self._same_origin():
            return self._json({"error": "forbidden"}, 403)
        path = urlparse(self.path).path
        try:
            if path == "/api/settings":
                save_settings(self._body())
                return self._json({"ok": True})
            if path == "/api/bookmarks":
                b = self._body()
                with _user_lock, user_db() as conn:
                    conn.execute(
                        "INSERT INTO bookmarks(kind, ref_id, title, subtitle, snippet, note, created) VALUES(?,?,?,?,?,?,?) "
                        "ON CONFLICT(kind, ref_id) DO UPDATE SET note = excluded.note",
                        (b["kind"], b["ref_id"], b.get("title", ""), b.get("subtitle", ""), b.get("snippet", ""), b.get("note", ""), time.time()),
                    )
                return self._json({"ok": True})
            if path == "/api/ask":
                return self._ask(self._body())
            return self._json({"error": "未找到"}, 404)
        except Exception as e:
            traceback.print_exc()
            return self._json({"error": str(e)}, 500)

    def do_DELETE(self):
        if not self._same_origin():
            return self._json({"error": "forbidden"}, 403)
        path = urlparse(self.path).path
        if path.startswith("/api/bookmarks/"):
            with _user_lock, user_db() as conn:
                conn.execute("DELETE FROM bookmarks WHERE id = ?", (int(path.rsplit("/", 1)[1]),))
            return self._json({"ok": True})
        if path.startswith("/api/conversation/"):
            _conversations.pop(path.rsplit("/", 1)[1], None)
            return self._json({"ok": True})
        return self._json({"error": "未找到"}, 404)

    # ---------- AI 问答（Server-Sent Events） ----------
    def _ask(self, body: dict):
        settings = load_settings()
        question = (body.get("question") or "").strip()
        region = (body.get("region") or "").strip()
        conv_id = body.get("conversation_id") or uuid.uuid4().hex
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        answer, steps = [], []

        def emit(ev: dict):
            if ev["type"] == "text":
                answer.append(ev["delta"])
            elif ev["type"] == "text_reset":
                answer.clear()
            elif ev["type"] == "step":
                steps.append(ev["text"])
            self.wfile.write(f"data: {json.dumps(ev, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()

        if not question:
            return emit({"type": "error", "message": "问题不能为空"})
        if not settings["api_key"] and settings["provider"] == "anthropic":
            return emit({"type": "error", "message": "还没有配置 API key，请点右上角「设置」。"})
        try:
            history = _conversations.get(conv_id, [])
            _conversations[conv_id] = agent.ask(settings, history, question, region, emit)
            answer_id = uuid.uuid4().hex[:12]
            with _user_lock, user_db() as conn:
                conn.execute("INSERT INTO answers VALUES(?,?,?,?,?,?,?)",
                             (answer_id, question, region, "".join(answer), json.dumps(steps, ensure_ascii=False), settings["model"], time.time()))
            emit({"type": "done", "answer_id": answer_id, "conversation_id": conv_id})
        except BrokenPipeError:
            pass
        except Exception as e:
            traceback.print_exc()
            msg = f"{type(e).__name__}: {e}"
            try:
                emit({"type": "error", "message": msg[:500]})
            except BrokenPipeError:
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    if not search.DB_PATH.exists():
        raise SystemExit("未找到 data/legal.db，请先运行 ./run.sh 或 scripts/build_index.py")
    DATA.mkdir(exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Claude for Legal China 已启动：http://127.0.0.1:{args.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
