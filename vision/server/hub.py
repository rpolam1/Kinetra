import argparse
import json
import os
import random
import re
import socket
import sys
import threading
import time
import uuid
import webbrowser

from flask import Flask, Response, jsonify, request, send_from_directory

from server.fusion import RepFusion, compute_sets
from server.heart import HeartLog
from server.holds import HoldLog
from server.live_service import LiveService
from server.routes_live import register_live_routes
from server.routes_vitals import register_vitals_routes
from server.store import Store
from formcheck.paths import EXERCISES_PATH, WEB_DIST_DIR
from formcheck.discovery import (DEFAULT_HTTP_PORT, DISCOVERY_PORT, HUB_HEADER,
                              DiscoveryResponder, local_ips)

DEFAULT_SET_GAP = 20.0
_TAG_IMAGE = re.compile(r"^/api/tags/\d+\.png$")
MAX_TAG_ID = 586  # AprilTag family 36h11 has ids 0..586


class HubCore:

    def __init__(self, db_path=":memory:", set_gap_seconds=DEFAULT_SET_GAP, exercise_config_path=None,
                 clock=time.time):
        self.lock = threading.RLock()
        self.store = Store(db_path)
        self.fusion = RepFusion()
        self.holds = HoldLog()
        self.heart = HeartLog(self.store)
        self.devices = {}
        self.set_gap = float(set_gap_seconds)
        self.cameras = {}
        self.patients_seen = set()
        for ev in self.store.all_events():  # rebuild state after a restart
            self._apply(ev)
        # live features, see live_service.py
        self.live = LiveService(self, load_exercise_configs(exercise_config_path), clock)

    def close(self):
        self.live.close()
        self.store.close()

    def ingest(self, camera_id, events):
        accepted = duplicates = rejected = 0
        with self.lock:
            cam = self.cameras.setdefault(camera_id, {"events": 0})
            cam["last_seen"] = time.time()
            for ev in events:
                ev = dict(ev)
                ev["camera_id"] = camera_id
                ev.setdefault("event_id", uuid.uuid4().hex)
                if ev.get("type") == "calibration_rep":
                    # big and short-lived, kept out of the event log
                    outcome = self.live.calibration_rep_event(ev)
                    accepted += outcome == "accepted"
                    duplicates += outcome == "duplicate"
                    rejected += outcome == "rejected"
                    continue
                if ev.get("type") == "rep" and not self._valid_rep(ev):
                    continue
                if ev.get("type") == "hold" and not self._valid_hold(ev):
                    continue
                if self.store.insert_event(ev) is None:
                    duplicates += 1
                    continue
                self._apply(ev)
                accepted += 1
                cam["events"] += 1
        if accepted:
            self.live.after_activity()
        result = {"accepted": accepted, "duplicates": duplicates}
        if rejected:
            result["rejected"] = rejected
        return result

    @staticmethod
    def _valid_rep(ev):
        try:
            return float(ev["t_end"]) > float(ev["t_start"]) and bool(ev.get("exercise"))
        except (KeyError, TypeError, ValueError):
            return False

    @staticmethod
    def _valid_hold(ev):
        try:
            return (float(ev["t_end"]) > float(ev["t_start"]) and bool(ev.get("exercise"))
                    and 0 < float(ev["seconds"]) < 3600)
        except (KeyError, TypeError, ValueError):
            return False

    def _apply(self, ev):
        kind = ev.get("type")
        if kind == "hold":
            if ev.get("patient_id"):
                self.patients_seen.add(ev["patient_id"])
            target = ev.get("target_seconds")
            self.holds.add({
                "camera_id": ev["camera_id"], "track_key": ev.get("track_key"), "patient_id": ev.get("patient_id"),
                "exercise": ev["exercise"], "t_start": float(ev["t_start"]), "t_end": float(ev["t_end"]),
                "seconds": float(ev["seconds"]),
                "target_seconds": float(target) if isinstance(target, (int, float)) else None,
                "completed": bool(ev.get("completed")),
            })
            return
        if kind == "rep":
            if ev.get("patient_id"):
                self.patients_seen.add(ev["patient_id"])
            self.fusion.add_rep({
                "event_id": ev["event_id"], "camera_id": ev["camera_id"],
                "track_key": ev.get("track_key"), "patient_id": ev.get("patient_id"),
                "exercise": ev["exercise"], "t_start": float(ev["t_start"]), "t_end": float(ev["t_end"]),
                "score": ev.get("score"), "label": ev.get("label"),
                "coverage": ev.get("coverage"), "issues": ev.get("issues") or [],
                "partial_return": bool(ev.get("partial_return")),
                "rom": ev.get("rom"),
            })
        elif kind == "bind" and ev.get("patient_id") and ev.get("track_key"):
            self.patients_seen.add(ev["patient_id"])
            self.fusion.bind(ev["track_key"], ev["patient_id"])
            self.holds.bind(ev["track_key"], ev["patient_id"])

    def _exercise_summary(self, reps):
        sets = compute_sets(reps, self.set_gap)
        scores = [r["score"] for r in reps if r["score"] is not None]
        now = time.time()
        current = sets[-1] if sets and now - sets[-1]["t_end"] <= self.set_gap else None
        set_of = {rid: s["set_index"] for s in sets for rid in s["rep_ids"]}
        return {
            "total_reps": len(reps),
            "total_sets": len(sets),
            "good_reps": sum(r["label"] == "good_form" for r in reps),
            "needs_correction": sum(r["label"] == "needs_correction" for r in reps),
            "flagged": sum(r["label"] == "flag_for_instructor" for r in reps),
            "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
            "sets": [{k: v for k, v in s.items() if k != "rep_ids"} for s in sets],
            "current_set": ({k: v for k, v in current.items() if k != "rep_ids"} if current else None),
            "reps": [self._public_rep(r, set_of.get(r["id"])) for r in reps],
        }

    @staticmethod
    def _public_rep(r, set_index):
        return {"id": r["id"], "t_start": round(r["t_start"], 2), "t_end": round(r["t_end"], 2),
                "score": r["score"], "label": r["label"], "issues": r["issues"],
                "cameras": sorted(r["cameras"]), "n_cameras": len(r["cameras"]),
                "partial_return": r["partial_return"], "set_index": set_index}

    def patient_summary(self, patient_id, exercise=None):
        with self.lock:
            reps = self.fusion.canonical_reps(patient_id, exercise)
            by_ex = {}
            for r in reps:
                by_ex.setdefault(r["exercise"], []).append(r)
            return {"patient_id": patient_id,
                    "assignment": self.store.assignments().get(patient_id),
                    "exercises": {ex: self._exercise_summary(rs) for ex, rs in by_ex.items()}}

    def patients(self):
        with self.lock:
            ids = set(self.patients_seen) | set(self.store.assignments())
            out = []
            for pid in sorted(ids):
                reps = self.fusion.canonical_reps(pid)
                out.append({"patient_id": pid, "total_reps": len(reps),
                            "last_activity": max((r["t_end"] for r in reps), default=None)})
            return out

    def unassigned(self):
        with self.lock:
            reps = self.fusion.canonical_reps(None)
            return [self._public_rep(r, None) | {"exercise": r["exercise"]} for r in reps]

    def state(self):
        with self.lock:
            tags = self.store.tags()
            return {"server_time": time.time(), "set_gap_seconds": self.set_gap,
                    "assignments": self.store.assignments(),
                    "tags": {str(k): v for k, v in tags.items()},
                    "tags_managed": bool(tags),  # once any tag is registered, unknown tags are ignored
                    "calibration": self.live.calibration.active_jobs(),  # cameras poll this for work
                    "cameras": {k: {"last_seen": v.get("last_seen"), "events": v["events"]}
                                for k, v in self.cameras.items()}}


def default_exercise_config_path():
    return EXERCISES_PATH if os.path.isfile(EXERCISES_PATH) else None


def load_exercise_configs(path):
    if not path or not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def create_app(core=None, api_key=None, name=None, web_dir=None):
    core = core or HubCore()
    started_at = time.time()
    hub_name = name or socket.gethostname()
    api_key = api_key if api_key is not None else os.environ.get("HUB_API_KEY")
    app = Flask(__name__)
    app.config["core"] = core

    @app.before_request
    def _auth():
        if request.method == "OPTIONS" or not request.path.startswith("/api/") \
                or request.path == "/api/health" or _TAG_IMAGE.match(request.path):
            # open on purpose: web app, health, tag images
            # (img tags can't send headers)
            return None
        if api_key and request.headers.get("X-API-Key") != api_key:
            return jsonify({"error": "unauthorized"}), 401

    @app.after_request
    def _cors(resp):  # lets a browser dashboard on another origin call us
        resp.headers[HUB_HEADER] = "exercise-hub"  # lets clients recognise a hub
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        return resp

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True, "service": "exercise-hub", "name": hub_name,
                        "started_at": started_at})

    @app.get("/api/time")
    def server_time():
        return jsonify({"t": time.time()})

    @app.post("/api/events")
    def events():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not body.get("camera_id") or not isinstance(body.get("events"), list):
            return jsonify({"error": "expected {camera_id, events:[...]}"}), 400
        return jsonify(core.ingest(str(body["camera_id"]), body["events"]))

    @app.get("/api/state")
    def state():
        return jsonify(core.state())

    @app.post("/api/assign")
    def assign():
        body = request.get_json(silent=True) or {}
        if not body.get("patient_id") or not body.get("exercise"):
            return jsonify({"error": "patient_id and exercise required"}), 400
        core.store.set_assignment(body["patient_id"], body["exercise"])
        core.patients_seen.add(body["patient_id"])
        return jsonify({"ok": True})

    @app.get("/api/patients")
    def patients():
        return jsonify(core.patients())

    @app.get("/api/patients/<patient_id>/summary")
    def summary(patient_id):
        return jsonify(core.patient_summary(patient_id, request.args.get("exercise")))

    @app.get("/api/unassigned")
    def unassigned():
        return jsonify(core.unassigned())

    @app.put("/api/templates/<patient_id>/<exercise>")
    def put_template(patient_id, exercise):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not body.get("calibration_reps"):
            return jsonify({"error": "template with calibration_reps required"}), 400
        core.store.put_template(patient_id, exercise, body)
        return jsonify({"ok": True})

    @app.get("/api/templates/<patient_id>/<exercise>")
    def get_template(patient_id, exercise):
        t = core.store.get_template(patient_id, exercise)
        if t is None:
            return jsonify({"error": "not found"}), 404
        return jsonify(t)


    register_live_routes(app, core)
    register_vitals_routes(app, core)

    def _valid_tag(tag_id):
        return 0 <= tag_id <= MAX_TAG_ID

    @app.get("/api/tags")
    def list_tags():
        return jsonify({"tags": {str(k): v for k, v in core.store.tags().items()}})

    @app.put("/api/tags/<int:tag_id>")
    def put_tag(tag_id):
        body = request.get_json(silent=True) or {}
        pid, name = body.get("patient_id"), body.get("display_name")
        if not _valid_tag(tag_id) or not isinstance(pid, str) or not pid.strip() or len(pid) > 64 \
                or (name is not None and (not isinstance(name, str) or len(name) > 40)):
            return jsonify({"error": f"tag id 0..{MAX_TAG_ID}, patient_id (<=64 chars) required"}), 400
        core.store.set_tag(tag_id, pid.strip(), name)
        return jsonify({"ok": True})

    @app.delete("/api/tags/<int:tag_id>")
    def delete_tag(tag_id):
        return jsonify({"ok": True, "deleted": core.store.delete_tag(tag_id)})

    @app.put("/api/tags")
    def replace_tags():
        body = request.get_json(silent=True)
        raw = body.get("tags") if isinstance(body, dict) else None
        if not isinstance(raw, dict):
            return jsonify({"error": "expected {tags: {id: {patient_id, display_name}}}"}), 400
        parsed = {}
        for key, v in raw.items():
            try:
                tid = int(key)
            except ValueError:
                return jsonify({"error": f"bad tag id {key!r}"}), 400
            if not _valid_tag(tid) or not isinstance(v, dict) or not isinstance(v.get("patient_id"), str):
                return jsonify({"error": f"bad entry for tag {key}"}), 400
            parsed[tid] = (v["patient_id"], v.get("display_name"))
        core.store.replace_tags(parsed)
        return jsonify({"ok": True, "count": len(parsed)})

    @app.get("/api/tags/<int:tag_id>.png")
    def tag_image(tag_id):
        if not _valid_tag(tag_id):
            return jsonify({"error": "tag id out of range"}), 404
        try:
            size = min(max(int(request.args.get("size", 600)), 100), 2000)
            import cv2
            from formcheck.identity import TagDetector
            ok, buf = cv2.imencode(".png", TagDetector.make_tag_image(tag_id, size))
        except Exception as e:  # cv2 missing or too old
            return jsonify({"error": f"cannot render tag: {e}"}), 501
        return Response(buf.tobytes(), mimetype="image/png",
                        headers={"Cache-Control": "public, max-age=86400"})

    # make it absolute, flask resolves relative paths against server/
    web_dir = os.path.abspath(web_dir) if web_dir else None
    if web_dir and os.path.isfile(os.path.join(web_dir, "index.html")):
        @app.get("/")
        def web_index():
            return send_from_directory(web_dir, "index.html")

        @app.get("/<path:path>")
        def web_files(path):
            if path.startswith("api/"):
                return jsonify({"error": "not found"}), 404
            full = os.path.normpath(os.path.join(web_dir, path))
            if full.startswith(os.path.normpath(web_dir) + os.sep) and os.path.isfile(full):
                return send_from_directory(web_dir, path)
            return send_from_directory(web_dir, "index.html")  # single-page-app fallback

    return app


class EmbeddedHub:

    def __init__(self, port=DEFAULT_HTTP_PORT, db="hub.db", set_gap=DEFAULT_SET_GAP,
                 discovery_port=DISCOVERY_PORT, api_key=None, host="0.0.0.0"):
        from werkzeug.serving import make_server
        self.core = HubCore(db, set_gap, exercise_config_path=default_exercise_config_path())
        self.core.live.start_ticker()
        self.app = create_app(self.core, api_key=api_key)
        self._srv = make_server(host, port, self.app, threaded=True)  # raises OSError if port taken
        self.port = self._srv.server_port
        self._thread = threading.Thread(target=self._srv.serve_forever, daemon=True)
        self._thread.start()
        self.responder = DiscoveryResponder(self.port, started_at=time.time(), port=discovery_port)
        self.responder.start()
        self.url_local = f"http://127.0.0.1:{self.port}"
        self.urls = [f"http://{ip}:{self.port}" for ip in local_ips()]

    def stop(self):
        self.responder.stop()
        self._srv.shutdown()
        self.core.live.close()


def host_if_alone(link, port=DEFAULT_HTTP_PORT, db="hub.db", set_gap=DEFAULT_SET_GAP,
                  log=print, **embedded_kwargs):
    time.sleep(random.uniform(0.2, 1.5))
    if link.discover(force=True):
        return None
    try:
        hub = EmbeddedHub(port=port, db=db, set_gap=set_gap, **embedded_kwargs)
    except OSError as e:
        log(f"could not host a hub on port {port} ({e}); retrying discovery")
        link.discover(force=True)
        return None
    link.base = hub.url_local
    link.sync_clock(3)
    log(f"No hub found -- this laptop is now the hub. Others will find it automatically "
        f"({', '.join(hub.urls) or hub.url_local}).")
    return hub


def _print_banner(port, discovery_ok, web_dir=None):
    urls = [f"http://{ip}:{port}" for ip in local_ips()] or [f"http://localhost:{port}"]
    print("=" * 64)
    print(" Exercise hub is running. Clients find it AUTOMATICALLY.")
    print(" (If you ever need the address, it is: " + "  or  ".join(urls) + ")")
    print(" Web app: " + (f"open {urls[0]} in a browser (board: {urls[0]}/#/board)" if web_dir
                           else "not found -- build it (cd web && npm run build) or run `npm run dev`"))
    if not discovery_ok:
        print(" ! Auto-discovery port is busy; clients can still find this hub by subnet scan.")
    if sys.platform.startswith("win"):
        print(" Windows: if other laptops can't connect, allow it through the firewall once:")
        print("   py tools/hub_check.py --fix-firewall      (run PowerShell as Administrator)")
    print("=" * 64)


def _chrome_paths():
    if sys.platform.startswith("win"):
        roots = [os.environ.get(k) for k in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
        return [os.path.join(r, "Google", "Chrome", "Application", "chrome.exe") for r in roots if r]
    if sys.platform == "darwin":
        return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]


def open_in_browser(url):
    # Chrome if it is installed, otherwise whatever the default browser is
    for path in _chrome_paths():
        if os.path.isfile(path):
            webbrowser.register("chrome-found", None, webbrowser.BackgroundBrowser(path))
            return webbrowser.get("chrome-found").open(url)
    return webbrowser.open(url)


def main():
    ap = argparse.ArgumentParser(description="Exercise-tracking hub")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=DEFAULT_HTTP_PORT)
    ap.add_argument("--db", default="hub.db")
    ap.add_argument("--set-gap", type=float, default=DEFAULT_SET_GAP,
                    help="seconds without a rep before a new set starts")
    ap.add_argument("--no-discovery", action="store_true", help="don't answer discovery probes")
    ap.add_argument("--exercises", default=None,
                    help="exercise library JSON (default: config/exercises.json); used to validate calibrations")
    ap.add_argument("--web", default=None,
                    help="folder with the built web app (default: ../web/dist if it exists); "
                         "served at / so the app and the hub share one address")
    ap.add_argument("--no-browser", action="store_true", help="don't open the web app in a browser on start")
    args = ap.parse_args()
    web_dir = args.web or (WEB_DIST_DIR if os.path.isfile(os.path.join(WEB_DIST_DIR, "index.html")) else None)
    core = HubCore(args.db, args.set_gap, exercise_config_path=args.exercises or default_exercise_config_path())
    core.live.start_ticker()
    app = create_app(core, web_dir=web_dir)
    responder = None
    if not args.no_discovery:
        responder = DiscoveryResponder(args.port, started_at=time.time())
        responder.start()
        time.sleep(0.2)
    _print_banner(args.port, responder is not None and responder.error is None, web_dir)
    if web_dir and not args.no_browser:
        threading.Timer(1.5, open_in_browser, args=(f"http://localhost:{args.port}",)).start()
    app.run(host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
    main()
