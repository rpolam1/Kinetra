import collections
import concurrent.futures
import threading
import time
import uuid

import requests

from formcheck.discovery import find_hub, normalize_url


class HubLink:
    def __init__(self, base_url, camera_id, api_key=None, flush_interval=0.5,
                 poll_interval=2.0, timeout=2.0, clock=time.time, discovery=None, log=print):
        self._preferred = None if (not base_url or base_url == "auto") else base_url
        self.base = normalize_url(self._preferred) if self._preferred else None
        self._discovery = discovery or {}
        self._last_discover = 0.0
        self._log = log
        self.camera_id = camera_id
        self.run_id = uuid.uuid4().hex[:6]  # distinguishes restarts of this camera
        self.timeout = timeout
        self.flush_interval = flush_interval
        self.poll_interval = poll_interval
        self._clock = clock
        self.offset = 0.0
        self.online = False
        self.state = {"assignments": {}, "set_gap_seconds": 20.0}
        self.sent = 0
        self._buf = collections.deque(maxlen=20000)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._threads = []
        self._latest = {}  # path -> newest payload (older ones are replaced)
        self._latest_lock = threading.Lock()
        self._latest_wake = threading.Event()
        self._pool = None
        self._session = requests.Session()
        if api_key:
            self._session.headers["X-API-Key"] = api_key

    def discover(self, force=False):
        if not force and time.time() - self._last_discover < 10.0:
            return self.base is not None
        self._last_discover = time.time()
        url = find_hub(preferred=self._preferred, log=self._log, **self._discovery)
        if url and url != self.base:
            self.base = url
            self.sync_clock(3)
        elif url:
            self.online = True
        return url is not None

    def now(self):
        return self._clock() + self.offset

    def to_hub_time(self, t_local):
        return t_local + self.offset

    def sync_clock(self, samples=5):
        best = None
        if not self.base:
            self.online = False
            return None
        for _ in range(samples):
            try:
                t0 = self._clock()
                r = self._session.get(f"{self.base}/api/time", timeout=self.timeout)
                t1 = self._clock()
                server_t = r.json()["t"]
            except Exception:
                continue
            rtt = t1 - t0
            offset = server_t - (t0 + t1) / 2
            if best is None or rtt < best[0]:
                best = (rtt, offset)
        if best is None:
            self.online = False
            return None
        self.offset = best[1]
        self.online = True
        return self.offset

    def track_key(self, track_id):
        return f"{self.camera_id}-{self.run_id}-{track_id}"

    def send_rep(self, judgment, patient_id, track_id, exercise, id_source=None):
        ev = {
            "type": "rep", "event_id": uuid.uuid4().hex, "patient_id": patient_id,
            "track_key": self.track_key(track_id), "id_source": id_source, "exercise": exercise,
            "t_start": self.to_hub_time(judgment["t_start"]),
            "t_end": self.to_hub_time(judgment["t_end"]),
            "score": judgment.get("score"), "label": judgment.get("label"),
            "coverage": judgment.get("coverage"), "issues": judgment.get("issues") or [],
            "partial_return": bool(judgment.get("partial_return")),
            "rom": judgment.get("rom"), "rep_index": judgment.get("rep_index"),
        }
        self._enqueue(ev)

    def send_bind(self, track_id, patient_id, source="tag"):
        self._enqueue({"type": "bind", "event_id": uuid.uuid4().hex, "patient_id": patient_id,
                       "track_key": self.track_key(track_id), "source": source, "t": self.now()})

    def _enqueue(self, ev):
        with self._lock:
            self._buf.append(ev)

    def pending(self):
        with self._lock:
            return len(self._buf)

    def flush(self):
        while True:
            with self._lock:
                batch = list(self._buf)[:200]
            if not batch:
                return True
            if not self.base:
                self.online = False
                return False
            try:
                r = self._session.post(f"{self.base}/api/events", timeout=self.timeout,
                                       json={"camera_id": self.camera_id, "events": batch})
                if r.status_code != 200:
                    self.online = r.status_code < 500 and self.online
                    return False
            except Exception:
                self.online = False
                return False
            with self._lock:
                for _ in range(len(batch)):
                    self._buf.popleft()
            self.sent += len(batch)
            self.online = True

    def post_latest(self, path, payload):
        with self._latest_lock:
            self._latest[path] = payload
        self._latest_wake.set()

    def _flush_latest(self):
        with self._latest_lock:
            batch, self._latest = self._latest, {}
        if not batch or not self.base:
            return
        for path, payload in batch.items():
            try:
                self._session.post(f"{self.base}{path}", json=payload, timeout=1.5)
            except Exception:
                pass  # best effort: the next payload supersedes it

    def _latest_loop(self):
        while not self._stop.is_set():
            self._latest_wake.wait(0.5)
            self._latest_wake.clear()
            self._flush_latest()

    def submit(self, fn):
        if self._pool is None:
            self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="hublink")
        self._pool.submit(fn)

    def send_presence(self, people):
        self.post_latest("/api/presence", {"camera_id": self.camera_id, "people": people})

    def calibration_jobs(self):
        return [j for j in (self.state.get("calibration") or []) if j.get("camera_id") in (None, self.camera_id)]

    def claim_calibration(self, job_id):
        def work():
            try:
                self._session.post(f"{self.base}/api/calibration/{job_id}/claim", timeout=self.timeout,
                                   json={"camera_id": self.camera_id})
            except Exception:
                pass
        if self.base:
            self.submit(work)

    def post_calibration_frame(self, job_id, frame):
        self.post_latest(f"/api/calibration/{job_id}/frame", {"camera_id": self.camera_id, "frame": frame})

    def send_calibration_rep(self, job_id, payload):
        self._enqueue({"type": "calibration_rep", "event_id": uuid.uuid4().hex, "job_id": job_id, **payload})

    def assigned_exercise(self, patient_id, default=None):
        a = (self.state.get("assignments") or {}).get(patient_id)
        return a["exercise"] if a else default

    def poll_state(self):
        if not self.base:
            self.online = False
            return
        try:
            self.state = self._session.get(f"{self.base}/api/state", timeout=self.timeout).json()
            self.online = True
        except Exception:
            self.online = False

    def fetch_template(self, patient_id, exercise):
        if not self.base:
            return None
        try:
            r = self._session.get(f"{self.base}/api/templates/{patient_id}/{exercise}",
                                  timeout=self.timeout * 3)
            return r.json() if r.status_code == 200 else None
        except Exception:
            return None

    def push_template(self, patient_id, exercise, template):
        if not self.base:
            return False
        try:
            r = self._session.put(f"{self.base}/api/templates/{patient_id}/{exercise}",
                                  json=template, timeout=self.timeout * 5)
            return r.status_code == 200
        except Exception:
            return False

    def start(self):
        if self.base is None or self.sync_clock() is None:
            self.discover(force=True)
        self.poll_state()
        for fn in (self._send_loop, self._poll_loop, self._latest_loop):
            t = threading.Thread(target=fn, daemon=True)
            t.start()
            self._threads.append(t)
        return self

    def _send_loop(self):
        backoff = 0.0
        while not self._stop.is_set():
            ok = self.flush()
            if not ok:
                self.discover()  # hub may have moved / restarted
            backoff = 0.0 if ok else min(max(backoff * 2, 1.0), 5.0)
            self._stop.wait(self.flush_interval + backoff)

    def _poll_loop(self):
        last_sync = time.time()
        while not self._stop.is_set():
            self.poll_state()
            if not self.online:
                self.discover()
            if time.time() - last_sync > 60:
                self.sync_clock(3)
                last_sync = time.time()
            # poll fast while a calibration waits for a camera
            self._stop.wait(0.5 if self.state.get("calibration") else self.poll_interval)

    def close(self, flush_timeout=3.0):
        deadline = time.time() + flush_timeout
        while self.pending() and time.time() < deadline:
            if self.flush():
                break
            time.sleep(0.2)
        self._stop.set()
        self._latest_wake.set()
        if self._pool is not None:
            self._pool.shutdown(wait=False)
