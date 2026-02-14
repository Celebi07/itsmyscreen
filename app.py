import json
import os
import queue
import sqlite3
import threading
import time
import uuid
from datetime import datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DB_PATH = BASE_DIR / "polls.db"

DB_LOCK = threading.Lock()
SSE_SUBSCRIBERS = {}
SSE_LOCK = threading.Lock()


def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS polls (
                id TEXT PRIMARY KEY,
                question TEXT NOT NULL,
                created_at TEXT NOT NULL,
                creator_ip TEXT
            );

            CREATE TABLE IF NOT EXISTS options (
                id TEXT PRIMARY KEY,
                poll_id TEXT NOT NULL,
                label TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                FOREIGN KEY(poll_id) REFERENCES polls(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS votes (
                id TEXT PRIMARY KEY,
                poll_id TEXT NOT NULL,
                option_id TEXT NOT NULL,
                voter_id TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(poll_id) REFERENCES polls(id) ON DELETE CASCADE,
                FOREIGN KEY(option_id) REFERENCES options(id) ON DELETE CASCADE,
                UNIQUE(poll_id, voter_id),
                UNIQUE(poll_id, ip_address)
            );

            CREATE INDEX IF NOT EXISTS idx_votes_poll ON votes(poll_id);
            """
        )


def parse_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return None
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return None


def get_poll_data(poll_id):
    with DB_LOCK:
        with get_conn() as conn:
            poll = conn.execute("SELECT id, question, created_at FROM polls WHERE id = ?", (poll_id,)).fetchone()
            if not poll:
                return None
            options = conn.execute(
                """
                SELECT o.id, o.label, o.sort_order, COUNT(v.id) AS votes
                FROM options o
                LEFT JOIN votes v ON v.option_id = o.id
                WHERE o.poll_id = ?
                GROUP BY o.id
                ORDER BY o.sort_order ASC
                """,
                (poll_id,),
            ).fetchall()
            total_votes = sum(option["votes"] for option in options)
            return {
                "id": poll["id"],
                "question": poll["question"],
                "createdAt": poll["created_at"],
                "totalVotes": total_votes,
                "options": [
                    {
                        "id": option["id"],
                        "label": option["label"],
                        "votes": option["votes"],
                    }
                    for option in options
                ],
            }


def broadcast_poll_update(poll_id):
    payload = get_poll_data(poll_id)
    if not payload:
        return
    packet = f"data: {json.dumps(payload)}\n\n"
    with SSE_LOCK:
        subscribers = SSE_SUBSCRIBERS.get(poll_id, [])
        dead = []
        for subscriber_queue in subscribers:
            try:
                subscriber_queue.put_nowait(packet)
            except queue.Full:
                dead.append(subscriber_queue)
        if dead:
            SSE_SUBSCRIBERS[poll_id] = [q for q in subscribers if q not in dead]


class PollHandler(BaseHTTPRequestHandler):
    server_version = "PollRooms/1.0"

    def log_message(self, format, *args):
        return

    def _send_json(self, code, payload, extra_headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path):
        content = path.read_bytes()
        ext = path.suffix
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
        }.get(ext, "application/octet-stream")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def _get_or_set_voter(self):
        cookie = SimpleCookie(self.headers.get("Cookie"))
        existing = cookie.get("voter_id")
        if existing:
            return existing.value, None
        voter_id = str(uuid.uuid4())
        return voter_id, f"voter_id={voter_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000"

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/" or path.startswith("/poll/"):
            return self._send_file(PUBLIC_DIR / "index.html")

        if path == "/styles.css":
            return self._send_file(PUBLIC_DIR / "styles.css")

        if path == "/app.js":
            return self._send_file(PUBLIC_DIR / "app.js")

        if path.startswith("/api/polls/") and path.endswith("/events"):
            poll_id = path.split("/")[3]
            return self._serve_events(poll_id)

        if path.startswith("/api/polls/"):
            poll_id = path.split("/")[3]
            data = get_poll_data(poll_id)
            if not data:
                return self._send_json(404, {"error": "Poll not found"})
            return self._send_json(200, data)

        return self._send_json(404, {"error": "Not found"})

    def _serve_events(self, poll_id):
        if not get_poll_data(poll_id):
            return self._send_json(404, {"error": "Poll not found"})

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        subscriber_queue = queue.Queue(maxsize=10)
        with SSE_LOCK:
            SSE_SUBSCRIBERS.setdefault(poll_id, []).append(subscriber_queue)

        try:
            first_data = get_poll_data(poll_id)
            self.wfile.write(f"data: {json.dumps(first_data)}\n\n".encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    message = subscriber_queue.get(timeout=25)
                except queue.Empty:
                    message = "event: ping\ndata: {}\n\n"
                self.wfile.write(message.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with SSE_LOCK:
                subscribers = SSE_SUBSCRIBERS.get(poll_id, [])
                SSE_SUBSCRIBERS[poll_id] = [q for q in subscribers if q is not subscriber_queue]

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/api/polls":
            return self._create_poll()

        if path.startswith("/api/polls/") and path.endswith("/vote"):
            poll_id = path.split("/")[3]
            return self._vote_poll(poll_id)

        return self._send_json(404, {"error": "Not found"})

    def _create_poll(self):
        payload = parse_json(self)
        if not payload:
            return self._send_json(400, {"error": "Invalid JSON body"})

        question = (payload.get("question") or "").strip()
        options = payload.get("options") or []
        clean_options = [str(option).strip() for option in options if str(option).strip()]

        if len(question) < 5:
            return self._send_json(400, {"error": "Question must be at least 5 characters"})

        deduped = []
        for option in clean_options:
            if option.lower() not in [o.lower() for o in deduped]:
                deduped.append(option)

        if len(deduped) < 2:
            return self._send_json(400, {"error": "At least 2 unique options are required"})

        client_ip = self._client_ip()
        now = datetime.utcnow().isoformat() + "Z"

        with DB_LOCK:
            with get_conn() as conn:
                recent = conn.execute(
                    """
                    SELECT COUNT(*) AS total FROM polls
                    WHERE creator_ip = ?
                      AND created_at > datetime('now', '-1 minute')
                    """,
                    (client_ip,),
                ).fetchone()["total"]
                if recent >= 5:
                    return self._send_json(429, {"error": "Too many polls created from this IP. Please wait."})

                poll_id = uuid.uuid4().hex[:10]
                conn.execute(
                    "INSERT INTO polls (id, question, created_at, creator_ip) VALUES (?, ?, ?, ?)",
                    (poll_id, question, now, client_ip),
                )
                for index, option in enumerate(deduped):
                    conn.execute(
                        "INSERT INTO options (id, poll_id, label, sort_order) VALUES (?, ?, ?, ?)",
                        (uuid.uuid4().hex[:12], poll_id, option, index),
                    )
                conn.commit()

        share_link = f"{self.headers.get('Origin', '')}/poll/{poll_id}"
        if not share_link.startswith("http"):
            host = self.headers.get("Host", "localhost:8000")
            scheme = "https" if self.headers.get("X-Forwarded-Proto") == "https" else "http"
            share_link = f"{scheme}://{host}/poll/{poll_id}"

        return self._send_json(201, {"pollId": poll_id, "shareLink": share_link})

    def _vote_poll(self, poll_id):
        payload = parse_json(self)
        if not payload:
            return self._send_json(400, {"error": "Invalid JSON body"})

        option_id = payload.get("optionId")
        if not option_id:
            return self._send_json(400, {"error": "optionId is required"})

        cookie_value, set_cookie = self._get_or_set_voter()
        client_ip = self._client_ip()

        with DB_LOCK:
            with get_conn() as conn:
                poll = conn.execute("SELECT id FROM polls WHERE id = ?", (poll_id,)).fetchone()
                if not poll:
                    return self._send_json(404, {"error": "Poll not found"})

                option = conn.execute(
                    "SELECT id FROM options WHERE id = ? AND poll_id = ?",
                    (option_id, poll_id),
                ).fetchone()
                if not option:
                    return self._send_json(400, {"error": "Invalid option selected"})

                try:
                    conn.execute(
                        """
                        INSERT INTO votes (id, poll_id, option_id, voter_id, ip_address, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (uuid.uuid4().hex[:14], poll_id, option_id, cookie_value, client_ip, datetime.utcnow().isoformat() + "Z"),
                    )
                    conn.commit()
                except sqlite3.IntegrityError as error:
                    message = str(error)
                    if "votes.poll_id, votes.voter_id" in message:
                        return self._send_json(409, {"error": "This browser has already voted in this poll."})
                    if "votes.poll_id, votes.ip_address" in message:
                        return self._send_json(409, {"error": "A vote from this network has already been recorded for this poll."})
                    return self._send_json(409, {"error": "Duplicate vote rejected."})

        broadcast_poll_update(poll_id)
        headers = {"Set-Cookie": set_cookie} if set_cookie else None
        return self._send_json(200, {"success": True}, extra_headers=headers)


def run():
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), PollHandler)
    print(f"Server running on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
