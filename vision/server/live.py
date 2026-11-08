import json
import threading
import time
from collections import deque


PRESENCE_TIMEOUT = 8.0  # seconds unseen before 'not detected'
REST_AFTER = 12.0  # seconds since the last rep before resting
WINDOW = 3  # how many recent reps the light is based on

LIGHTS = ("not_detected", "resting", "on_track", "drifting", "needs_help")


def compute_light(present, now, last_rep_at, recent_scores, holding=False, hold_seconds=0.0):
    if not present:
        return "not_detected", "Not seen by any camera"
    if holding:
        return "on_track", f"Holding position ({hold_seconds:.0f}s)"
    if last_rep_at is None or now - last_rep_at > REST_AFTER:
        return "resting", "Resting or getting ready"
    scores = [s for s in recent_scores[-WINDOW:] if s is not None]
    if not scores:
        return "on_track", "Counting reps (no form score for this exercise)"
    flagged = sum(1 for s in scores if s < 50)
    average = sum(scores) / len(scores)
    if average < 50 or flagged >= 2:
        return "needs_help", f"Form is poor (recent average {average:.0f})"
    if average < 80 or flagged == 1:
        return "drifting", f"Form is slipping (recent average {average:.0f})"
    return "on_track", f"Good form (recent average {average:.0f})"



class PresenceTracker:

    def __init__(self, ttl=PRESENCE_TIMEOUT):
        self.ttl = ttl
        self._by_camera = {}

    def update(self, camera_id, people, now):
        self._by_camera[camera_id] = {"t": now, "people": list(people)}

    def _fresh(self, now):
        return {cam: v for cam, v in self._by_camera.items() if now - v["t"] <= self.ttl}

    def patients(self, now):
        out = {}
        for cam, v in self._fresh(now).items():
            for person in v["people"]:
                pid = person.get("patient_id")
                if not pid:
                    continue
                entry = out.setdefault(pid, {"last_seen": v["t"], "cameras": [], "id_source": person.get("id_source"),
                                             "holding": False, "hold_seconds": 0.0})
                if person.get("holding"):
                    entry["holding"] = True
                    entry["hold_seconds"] = max(entry["hold_seconds"], person.get("hold_seconds") or 0.0)
                entry["last_seen"] = max(entry["last_seen"], v["t"])
                if cam not in entry["cameras"]:
                    entry["cameras"].append(cam)
        return out

    def anonymous(self, now):
        return [{"camera_id": cam, "track_key": p.get("track_key"), "last_seen": v["t"]}
                for cam, v in sorted(self._fresh(now).items())
                for p in v["people"] if not p.get("patient_id")]

    def cameras(self, now):
        return {cam: v["t"] for cam, v in self._fresh(now).items()}



class LiveBus:

    def __init__(self, history=1000):
        self._cond = threading.Condition()
        self._events = deque(maxlen=history)
        self._seq = 0

    @property
    def seq(self):
        with self._cond:
            return self._seq

    def publish(self, topic, data, key=None):
        with self._cond:
            self._seq += 1
            self._events.append((self._seq, topic, key, data))
            self._cond.notify_all()
            return self._seq

    def _next(self, cursor, topics, key, timeout):
        deadline = time.monotonic() + timeout
        with self._cond:
            while True:
                fresh = [e for e in self._events if e[0] > cursor]
                if fresh:
                    cursor = fresh[-1][0]
                    wanted = [e for e in fresh if e[1] in topics and (e[2] is None or key is None or e[2] == key)]
                    if wanted:
                        return wanted, cursor
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return [], cursor
                self._cond.wait(remaining)

    def stream(self, topics, key=None, initial=(), heartbeat=15.0, stop=None):
        topics = set(topics)
        cursor = self.seq
        yield ": connected\n\n"
        for topic, data in initial:
            yield self._format(cursor, topic, data)
        while not (stop and stop.is_set()):
            events, cursor = self._next(cursor, topics, key, heartbeat)
            if not events:
                yield ": keep-alive\n\n"  # also lets the server notice a closed connection
                continue
            # snapshots keep only the newest event per topic/key
            latest = {}
            for seq, topic, k, data in events:
                latest[(topic, k)] = (seq, topic, data)
            for seq, topic, data in sorted(latest.values()):
                yield self._format(seq, topic, data)

    @staticmethod
    def _format(seq, topic, data):
        return f"id: {seq}\nevent: {topic}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"
