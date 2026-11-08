import json
import sqlite3
import threading
import time


class Store:
    def __init__(self, path=":memory:"):
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS events(
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE NOT NULL,
                camera_id TEXT, type TEXT, t REAL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS templates(
                patient_id TEXT, exercise TEXT, payload TEXT NOT NULL, updated REAL,
                PRIMARY KEY(patient_id, exercise));
            CREATE TABLE IF NOT EXISTS tags(
                tag_id INTEGER PRIMARY KEY, patient_id TEXT NOT NULL, display_name TEXT, updated REAL);
            CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS assignments(
                patient_id TEXT PRIMARY KEY, exercise TEXT, updated REAL);
        """)
        self._db.commit()

    def insert_event(self, event):
        with self._lock:
            try:
                cur = self._db.execute(
                    "INSERT INTO events(event_id, camera_id, type, t, payload) VALUES(?,?,?,?,?)",
                    (event["event_id"], event.get("camera_id"), event.get("type"),
                     event.get("t_end") or event.get("t"), json.dumps(event)))
                self._db.commit()
                return cur.lastrowid
            except sqlite3.IntegrityError:
                return None

    def all_events(self):
        with self._lock:
            rows = self._db.execute("SELECT payload FROM events ORDER BY seq").fetchall()
        return [json.loads(r[0]) for r in rows]

    def put_template(self, patient_id, exercise, template):
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO templates VALUES(?,?,?,?)",
                             (patient_id, exercise, json.dumps(template), time.time()))
            self._db.commit()

    def get_template(self, patient_id, exercise):
        with self._lock:
            row = self._db.execute("SELECT payload FROM templates WHERE patient_id=? AND exercise=?",
                                   (patient_id, exercise)).fetchone()
        return json.loads(row[0]) if row else None

    def set_assignment(self, patient_id, exercise):
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO assignments VALUES(?,?,?)",
                             (patient_id, exercise, time.time()))
            self._db.commit()

    def assignments(self):
        with self._lock:
            rows = self._db.execute("SELECT patient_id, exercise, updated FROM assignments").fetchall()
        return {p: {"exercise": e, "updated": u} for p, e, u in rows}

    def set_tag(self, tag_id, patient_id, display_name=None):
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO tags VALUES(?,?,?,?)",
                             (int(tag_id), patient_id, display_name, time.time()))
            self._db.commit()

    def delete_tag(self, tag_id):
        with self._lock:
            cur = self._db.execute("DELETE FROM tags WHERE tag_id=?", (int(tag_id),))
            self._db.commit()
            return cur.rowcount > 0

    def replace_tags(self, tags):
        with self._lock:
            self._db.execute("DELETE FROM tags")
            now = time.time()
            self._db.executemany("INSERT INTO tags VALUES(?,?,?,?)",
                                 [(int(t), p, n, now) for t, (p, n) in tags.items()])
            self._db.commit()

    def tags(self):
        with self._lock:
            rows = self._db.execute("SELECT tag_id, patient_id, display_name FROM tags").fetchall()
        return {t: {"patient_id": p, "display_name": n} for t, p, n in rows}

    def kv_set(self, key, value):
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO kv VALUES(?,?)", (key, json.dumps(value)))
            self._db.commit()

    def kv_get(self, key, default=None):
        with self._lock:
            row = self._db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def clear_assignment(self, patient_id):
        with self._lock:
            self._db.execute("DELETE FROM assignments WHERE patient_id=?", (patient_id,))
            self._db.commit()

    def close(self):
        with self._lock:
            self._db.close()
