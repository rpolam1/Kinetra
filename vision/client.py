import argparse
import json
import os
import socket
import sys
import time

from formcheck.calibration_session import CalibrationRunner
from formcheck.paths import EXERCISES_PATH
from formcheck.feature_extractor import FeatureExtractor
from formcheck.identity import PersonTracker
from formcheck.quality_judge import QualityJudge
from formcheck.template_manager import TemplateManager

TEMPLATE_RETRY_SEC = 30.0
PRESENCE_INTERVAL = 1.0  # seconds between "who I can see" heartbeats to the hub
PALETTE = [(0, 255, 0), (255, 160, 0), (255, 0, 255), (0, 200, 255), (255, 255, 0), (160, 160, 255)]


def load_exercise_configs(path=EXERCISES_PATH):
    with open(path) as f:
        return json.load(f)


def load_tag_map(path):
    if path and os.path.exists(path):
        with open(path) as f:
            return {int(k): v for k, v in json.load(f).items()}
    return {}

MIN_HOLD_SECONDS = 3.0


class PersonSession:

    def __init__(self, track_id):
        self.track_id = track_id
        self.patient_id = None
        self.exercise = None
        self.extractor = None
        self.judge = None
        self.has_template = False
        self.good = self.bad = self.total = 0
        self.last_text = ""
        self.hold_reported = False
        self.holding = False
        self.hold_seconds = 0.0
        self.hold_peak = 0.0
        self.hold_last_t = None
        self.hold_who = None


class CameraPipeline:

    def __init__(self, exercise_configs, template_manager, link=None, tag_map=None,
                 default_exercise=None, on_rep=None, camera_id=None):
        self.camera_id = camera_id or (link.camera_id if link else None)
        self.configs = exercise_configs
        self.templates = template_manager
        self.link = link
        self.tag_map = tag_map or {}
        self.default_exercise = default_exercise
        self.on_rep = on_rep
        self.tracker = PersonTracker()
        self.sessions = {}
        self._template_cache = {}  # (patient, exercise) -> (template|None, fetched_at)
        self._calibrations = {}  # job id -> CalibrationRunner for jobs running on this camera
        self._claim_requested = set()  # job ids this camera already asked to claim
        self._last_presence = float("-inf")

    def _template_for(self, patient_id, exercise, now):
        if patient_id is None:
            return None
        key = (patient_id, exercise)
        cached = self._template_cache.get(key)
        if cached and (cached[0] is not None or now - cached[1] < TEMPLATE_RETRY_SEC):
            return cached[0]
        slots = ([f"{exercise}@{self.camera_id}"] if self.camera_id else []) + [exercise]
        tpl = None
        for slot in slots:
            tpl = self.templates.load_template(patient_id, slot)
            if tpl is None and self.link is not None:
                tpl = self.link.fetch_template(patient_id, slot)
                if tpl is not None:
                    self.templates.store_template(patient_id, slot, tpl)
            if tpl is not None:
                break
        self._template_cache[key] = (tpl, now)
        return tpl

    def _exercise_for(self, patient_id):
        if patient_id is not None and self.link is not None:
            return self.link.assigned_exercise(patient_id, self.default_exercise)
        return self.default_exercise

    def _configure(self, sess, patient_id, exercise, now):
        template = self._template_for(patient_id, exercise, now)
        if sess.exercise != exercise or sess.judge is None:
            if sess.holding:
                self._finish_hold(sess)
                sess.holding = False
            cfg = self.configs[exercise]
            sess.exercise = exercise
            sess.extractor = FeatureExtractor(cfg)
            sess.judge = QualityJudge(cfg, template)
            sess.has_template = template is not None
            sess.hold_reported = False
        elif template is not None and (not sess.has_template or sess.patient_id != patient_id):
            sess.judge.set_template(template)  # identified (or calibrated) mid-session
            sess.has_template = True
        sess.patient_id = patient_id

    def _map_tags(self, tags):
        state = self.link.state if self.link else {}
        registry = state.get("tags") or {}
        managed = bool(state.get("tags_managed"))
        mapped = []
        for t in tags:
            entry = registry.get(str(t["tag_id"]))
            if entry:
                pid = entry["patient_id"]
            elif managed:
                continue
            else:
                pid = self.tag_map.get(t["tag_id"], f"p{t['tag_id']:03d}")
            mapped.append(dict(t, patient_id=pid))
        return mapped

    def _calibrate(self, people, frame_shape, now):
        if not self.link:
            return set()
        jobs = self.link.calibration_jobs()
        wanted = {j["id"] for j in jobs}
        for job_id in [i for i in self._calibrations if i not in wanted]:
            del self._calibrations[job_id]  # finished, cancelled or taken by another camera
        handled = set()
        for job in jobs:
            if job["status"] == "pending":
                if job["id"] not in self._claim_requested:
                    self._claim_requested.add(job["id"])
                    self.link.claim_calibration(job["id"])  # the next state poll shows it as ours
                continue
            if job["camera_id"] != self.link.camera_id:
                continue
            cfg = self.configs.get(job["exercise"])
            if cfg is None:
                continue
            runner = self._calibrations.get(job["id"])
            if runner is None:
                runner = self._calibrations[job["id"]] = CalibrationRunner(job, cfg, self.link)
            track = runner.step(people, frame_shape, now)
            if track is not None:
                handled.add(track)
        return handled

    def _send_presence(self, people, now):
        if not self.link or now - self._last_presence < PRESENCE_INTERVAL:
            return
        self._last_presence = now
        self.link.send_presence([
            {"patient_id": p["patient_id"], "track_key": self.link.track_key(p["track_id"]),
             "id_source": p["id_source"],
             "exercise": (self.sessions[p["track_id"]].exercise or "") if p["track_id"] in self.sessions else "",
             "holding": bool(p["track_id"] in self.sessions and self.sessions[p["track_id"]].holding),
             "hold_seconds": self.sessions[p["track_id"]].hold_seconds if p["track_id"] in self.sessions else 0}
            for p in people])

    def step(self, poses, tags, frame_shape, now):
        mapped = self._map_tags(tags)
        people = self.tracker.update(poses, frame_shape, mapped, now)

        for ev in self.tracker.pop_events():
            print(f"[identity] track {ev['track_id']} -> {ev['patient_id']} ({ev['source']})")
            if self.link:
                self.link.send_bind(ev["track_id"], ev["patient_id"], ev["source"])

        calibrating = self._calibrate(people, frame_shape, now)

        out = []
        for p in people:
            sess = self.sessions.setdefault(p["track_id"], PersonSession(p["track_id"]))
            if p["track_id"] in calibrating:  # being calibrated: not scored as a normal rep
                out.append((p, None))
                continue
            exercise = self._exercise_for(p["patient_id"])
            if exercise is None or exercise not in self.configs:
                out.append((p, None))
                continue
            self._configure(sess, p["patient_id"], exercise, now)
            feature = sess.extractor.extract(p["landmarks"], frame_shape)
            if feature is not None:
                feature["timestamp"] = now
                for j in sess.judge.process_feature(feature):
                    self._on_judgment(sess, p, j)
            out.append((p, sess))

        self._send_presence(people, now)

        alive = {t.id for t in self.tracker.tracks}
        for tid in [t for t in self.sessions if t not in alive]:
            if self.sessions[tid].holding:
                self._finish_hold(self.sessions[tid])
            del self.sessions[tid]
        return out

    def _finish_hold(self, sess):
        peak, last_t, who = sess.hold_peak, sess.hold_last_t, sess.hold_who
        sess.hold_peak, sess.hold_last_t = 0.0, None
        if peak < MIN_HOLD_SECONDS or last_t is None or who is None or sess.exercise is None:
            return
        target = self.configs.get(sess.exercise, {}).get("target_duration_sec")
        print(f"[hold] ended {who[0] or 'unknown'}: {peak}s")
        if self.link:
            self.link.send_hold({"t_start": last_t - peak, "t_end": last_t, "seconds": peak,
                                 "target_seconds": target, "completed": target is not None and peak >= target},
                                who[0], who[1], sess.exercise, who[2])

    def _on_judgment(self, sess, person, j):
        if j.get("type") == "hold_progress":
            was_holding = sess.holding
            sess.holding = j["holding"]
            sess.hold_seconds = j["elapsed_seconds"]
            if sess.holding:
                sess.hold_peak = max(sess.hold_peak, j["elapsed_seconds"])
                sess.hold_last_t = j.get("t")
                sess.hold_who = (person["patient_id"], person["track_id"], person["id_source"])
            elif was_holding:
                self._finish_hold(sess)
            if not sess.holding:
                sess.hold_reported = False
            return
        if j.get("type") == "hold_complete":
            if not sess.hold_reported:  # one set per hold
                sess.hold_reported = True
                print(f"[hold] {person['patient_id'] or 'unknown'}: {j['elapsed_seconds']}s")
                if self.link:
                    self.link.send_rep({"t_start": j["t_end"] - j["elapsed_seconds"], "t_end": j["t_end"],
                                        "label": "hold"},
                                       person["patient_id"], person["track_id"], sess.exercise,
                                       person["id_source"])
            return
        if j.get("type") != "rep":
            return
        sess.total += 1
        if j["label"] == "good_form":
            sess.good += 1
        elif j["label"] in ("needs_correction", "flag_for_instructor"):
            sess.bad += 1
        issues = j.get("issues") or []
        sess.last_text = (f"{j['label']} {j['score']}" if j.get("score") is not None else j["label"])
        if issues:
            sess.last_text += f" - {issues[0]}"
        who = person["patient_id"] or f"unknown#{person['track_id']}"
        print(f"[rep] {who} {sess.exercise}: {j['label']} score={j.get('score')} "
              f"rom={j.get('rom')} {issues[:2]}")
        if self.link:
            self.link.send_rep(j, person["patient_id"], person["track_id"], sess.exercise,
                               person["id_source"])
        if self.on_rep:
            self.on_rep(person, sess, j)


def _capture(cv2, i, explicit):
    # DirectShow opens quickly on Windows; the default driver (MSMF) can freeze on a second camera
    if sys.platform.startswith("win"):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened() or not explicit:
            return cap
        cap.release()
    return cv2.VideoCapture(i)


def open_camera(cv2, index=None, limit=10):
    # an explicit index is used as given; otherwise take the first camera that really delivers a picture
    candidates = [index] if index is not None else range(limit)
    for i in candidates:
        cap = _capture(cv2, i, index is not None)
        if cap.isOpened():
            ok, frame = cap.read()
            if ok and frame is not None:
                return cap, i
        cap.release()
    return None, None


def run(args):
    import cv2
    from formcheck.hub_client import HubLink
    from formcheck.identity import TagDetector
    from formcheck.pose_extractor import PoseExtractor

    configs = load_exercise_configs(args.config)
    if args.exercise and args.exercise not in configs:
        raise ValueError(f"Unknown exercise '{args.exercise}'")

    cap, index = open_camera(cv2, args.camera)
    if cap is None:
        raise RuntimeError("No working camera found." if args.camera is None else
                           f"Could not open camera {args.camera}.")
    if args.camera_id is None:
        host = socket.gethostname()
        args.camera_id = host if index == 0 else f"{host}-{index}"
    print(f"Using camera {index} as '{args.camera_id}'")

    link = embedded = None
    if not args.no_hub:
        link = HubLink(args.hub or "auto", args.camera_id, api_key=args.api_key)
        print("Looking for the hub on the network...")
        if not link.discover(force=True) and args.auto_host:
            from server.hub import host_if_alone
            embedded = host_if_alone(link)
        link.start()
        if link.online:
            print(f"Connected to hub {link.base}  (clock offset {link.offset:+.3f}s)")
        else:
            print("No hub found yet -- running anyway; reps are buffered and sent as soon as a "
                  "hub appears (it keeps searching). Start one with:  py -m server.hub")

    pipeline = CameraPipeline(configs, TemplateManager(), link, load_tag_map(args.tags),
                              default_exercise=args.exercise, camera_id=args.camera_id)
    pose = PoseExtractor(num_poses=args.max_people)
    tag_detector = TagDetector()

    print("Running. Show your AprilTag to the camera to identify yourself. Press q to quit.")
    frame_no = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_no += 1
            poses = pose.process_all(frame)
            tags = tag_detector.detect(frame) if frame_no % 2 == 0 else []
            results = pipeline.step(poses, tags, frame.shape, time.time())

            if not args.no_display:
                for p, sess in results:
                    color = PALETTE[p["track_id"] % len(PALETTE)]
                    name = p["patient_id"] or f"unknown #{p['track_id']}"
                    label = f"{name} [{p['id_source']}]"
                    if sess:
                        label += f"  {sess.good}/{sess.total}"
                    pose.draw_person(frame, p["landmarks"], color, label)
                    if sess and sess.last_text:
                        x, y = int(p["centroid"][0]), int(p["centroid"][1] + 1.2 * p["scale"])
                        cv2.putText(frame, sess.last_text[:60], (max(x - 100, 5), y),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                for t in tags:
                    cv2.polylines(frame, [t["corners"].astype(int)], True, (0, 255, 255), 2)
                status = (f"{args.camera_id} | hub: "
                          f"{'online' if link and link.online else 'offline' if link else 'n/a'}"
                          f"{f' ({link.pending()} queued)' if link else ''}")
                cv2.putText(frame, status, (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                cv2.imshow("Exercise client (q to quit)", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    finally:
        cap.release()
        cv2.destroyAllWindows()
        pose.close()
        if link:
            link.close()
        if embedded:
            embedded.stop()


def selftest(args):
    import numpy as np
    from formcheck.identity import TagDetector
    from formcheck.pose_extractor import PoseExtractor
    configs = load_exercise_configs(args.config)
    pose = PoseExtractor()
    pose.process_all(np.zeros((480, 640, 3), dtype=np.uint8))
    TagDetector().detect(np.zeros((480, 640, 3), dtype=np.uint8))
    pose.close()
    print(f"selftest ok: pose model loaded, {len(configs)} exercises")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Multi-person exercise tracking client")
    ap.add_argument("--camera-id", default=None,
                    help="unique name for this camera (default: the computer name, plus -N for camera N)")
    ap.add_argument("--hub", default="auto",
                    help="hub URL; default 'auto' finds it on the network by itself "
                         "(a wrong address is ignored and discovery is used)")
    ap.add_argument("--no-hub", action="store_true", help="run standalone (no hub at all)")
    ap.add_argument("--auto-host", action="store_true",
                    help="if no hub is found, this laptop starts one (others find it automatically)")
    ap.add_argument("--api-key", default=os.environ.get("HUB_API_KEY"))
    ap.add_argument("--exercise", help="default exercise for people with no hub assignment")
    ap.add_argument("--camera", type=int, default=None,
                    help="camera number to open (default: the first one that works)")
    ap.add_argument("--max-people", type=int, default=4)
    ap.add_argument("--tags", default="config/tags.json", help="optional tag-id -> patient-id map")
    ap.add_argument("--config", default=EXERCISES_PATH)
    ap.add_argument("--no-display", action="store_true")
    ap.add_argument("--selftest", action="store_true",
                    help="load the pose model, run it on a blank frame and exit (checks the install)")
    args = ap.parse_args()
    if sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        args.no_display = True  # no screen attached (e.g. a headless Jetson)
    if args.selftest:
        raise SystemExit(selftest(args))
    run(args)


if __name__ == "__main__":
    main()
