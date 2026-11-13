"""SQLite storage for events, templates, tags, heart rate samples, assignments and a small key value table."""
import json
import sqlite3
import threading
import time


class Store:
    """Thread safe wrapper around one SQLite connection."""
    def __init__(self, path=":memory:"):
        """Open the database and create any missing tables."""
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        # Write ahead logging lets readers continue while the hub writes
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
            CREATE TABLE IF NOT EXISTS heart_samples(
                patient_id TEXT NOT NULL, t REAL NOT NULL, bpm REAL NOT NULL,
                PRIMARY KEY(patient_id, t));
            CREATE TABLE IF NOT EXISTS assignments(
                patient_id TEXT PRIMARY KEY, exercise TEXT, updated REAL);
        """)
        self._db.commit()

    def insert_event(self, event):
        """Save an event. Returns its row number, or None when the event id was already stored."""
        with self._lock:
            try:
                cur = self._db.execute(
                    "INSERT INTO events(event_id, camera_id, type, t, payload) VALUES(?,?,?,?,?)",
                    (event["event_id"], event.get("camera_id"), event.get("type"),
                     event.get("t_end") or event.get("t"), json.dumps(event)))
                self._db.commit()
                return cur.lastrowid
            except sqlite3.IntegrityError:
                # The event id is unique, so a resent event is reported as a duplicate
                return None

    def all_events(self):
        """All stored events in the order they arrived, used to rebuild state after a restart."""
        with self._lock:
            rows = self._db.execute("SELECT payload FROM events ORDER BY seq").fetchall()
        return [json.loads(r[0]) for r in rows]

    def put_template(self, patient_id, exercise, template):
        """Save or replace a patient's template for an exercise."""
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO templates VALUES(?,?,?,?)",
                             (patient_id, exercise, json.dumps(template), time.time()))
            self._db.commit()

    def get_template(self, patient_id, exercise):
        """A patient's template for an exercise, or None."""
        with self._lock:
            row = self._db.execute("SELECT payload FROM templates WHERE patient_id=? AND exercise=?",
                                   (patient_id, exercise)).fetchone()
        return json.loads(row[0]) if row else None

    def set_assignment(self, patient_id, exercise):
        """Set the exercise a patient is currently assigned."""
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO assignments VALUES(?,?,?)",
                             (patient_id, exercise, time.time()))
            self._db.commit()

    def assignments(self):
        """All assignments by patient id."""
        with self._lock:
            rows = self._db.execute("SELECT patient_id, exercise, updated FROM assignments").fetchall()
        return {p: {"exercise": e, "updated": u} for p, e, u in rows}

    def set_tag(self, tag_id, patient_id, display_name=None):
        """Register an AprilTag for a patient."""
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO tags VALUES(?,?,?,?)",
                             (int(tag_id), patient_id, display_name, time.time()))
            self._db.commit()

    def delete_tag(self, tag_id):
        """Remove a tag. Returns True when it existed."""
        with self._lock:
            cur = self._db.execute("DELETE FROM tags WHERE tag_id=?", (int(tag_id),))
            self._db.commit()
            return cur.rowcount > 0

    def replace_tags(self, tags):
        """Replace every tag with the given set."""
        with self._lock:
            self._db.execute("DELETE FROM tags")
            now = time.time()
            self._db.executemany("INSERT INTO tags VALUES(?,?,?,?)",
                                 [(int(t), p, n, now) for t, (p, n) in tags.items()])
            self._db.commit()

    def tags(self):
        """All tags by tag id."""
        with self._lock:
            rows = self._db.execute("SELECT tag_id, patient_id, display_name FROM tags").fetchall()
        return {t: {"patient_id": p, "display_name": n} for t, p, n in rows}

    def add_heart_samples(self, patient_id, samples):
        """Save heart rate samples. A sample at the same time replaces the old one."""
        with self._lock:
            self._db.executemany("INSERT OR REPLACE INTO heart_samples VALUES(?,?,?)",
                                 [(patient_id, s["t"], s["bpm"]) for s in samples])
            self._db.commit()

    def heart_samples(self, patient_id, since, until=None):
        """Heart rate samples for a patient in a time range."""
        with self._lock:
            rows = self._db.execute(
                "SELECT t, bpm FROM heart_samples WHERE patient_id=? AND t>=? AND t<=? ORDER BY t",
                (patient_id, since, until if until is not None else 4e9)).fetchall()
        return [{"t": t, "bpm": b} for t, b in rows]

    def latest_heart(self, patient_id):
        """The newest heart rate sample for a patient, or None."""
        with self._lock:
            row = self._db.execute("SELECT t, bpm FROM heart_samples WHERE patient_id=? ORDER BY t DESC LIMIT 1",
                                   (patient_id,)).fetchone()
        return {"t": row[0], "bpm": row[1]} if row else None

    def kv_set(self, key, value):
        """Save a JSON value under a key."""
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO kv VALUES(?,?)", (key, json.dumps(value)))
            self._db.commit()

    def kv_get(self, key, default=None):
        """Read a JSON value, or the default when the key is missing."""
        with self._lock:
            row = self._db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def clear_assignment(self, patient_id):
        """Clear a patient's assignment."""
        with self._lock:
            self._db.execute("DELETE FROM assignments WHERE patient_id=?", (patient_id,))
            self._db.commit()

    def close(self):
        """Close the database."""
        with self._lock:
            self._db.close()
