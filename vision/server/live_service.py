"""Live features of the hub. Joins presence, reps, heart rate, sessions and calibration into the status the web app shows, and publishes changes."""
import json
import threading
import time

from server.calibration import CalibrationError, CalibrationManager
from server.fusion import compute_sets
from server.heart import evaluate, summarize
from server.live import LiveBus, PresenceTracker, compute_light
from server.session import SessionError, SessionManager, exercise_progress

SKELETON_MIN_INTERVAL = 0.08  # max ~12 skeleton frames/s per calibration
TICK_SECONDS = 1.0  # recheck time-based changes this often


class LiveService:
    """Builds the live status for the board and drives sessions and calibration jobs. Shares the hub's lock."""
    def __init__(self, core, exercise_configs=None, clock=time.time):
        self.core = core
        self.clock = clock
        self.exercise_configs = exercise_configs
        self.bus = LiveBus()
        self.presence = PresenceTracker()
        self.session = SessionManager(core.store, clock)
        self.calibration = CalibrationManager(exercise_configs, clock)
        self.stop_event = threading.Event()
        self._signature = None
        self._last_skeleton = {}
        self._ticker = None

    def presence_update(self, camera_id, people):
        """Record who a camera can see, after cleaning up what it sent."""
        if not isinstance(people, list) or len(people) > 100:
            raise ValueError("people must be a list")
        clean = []
        for p in people:
            if not isinstance(p, dict):
                raise ValueError("each person must be an object")
            pid = p.get("patient_id")
            clean.append({"patient_id": pid if isinstance(pid, str) and pid else None,
                          "track_key": str(p.get("track_key") or "")[:80],
                          "id_source": str(p.get("id_source") or "")[:16],
                          "exercise": str(p.get("exercise") or "")[:64],
                          "holding": bool(p.get("holding")),
                          "hold_seconds": max(0.0, min(float(p.get("hold_seconds") or 0), 3600.0))})
        with self.core.lock:
            self.presence.update(camera_id, clean, self.clock())
            cam = self.core.cameras.setdefault(camera_id, {"events": 0})
            cam["last_seen"] = time.time()
        self.publish_live()

    def _reps_since(self, pid, started_at):
        """Combined reps for a patient that started after a time."""
        return [r for r in self.core.fusion.canonical_reps(pid) if r["t_start"] >= started_at]

    def _exercise_reps(self, pid, participant):
        """Reps for the participant's current exercise since they moved to it."""
        item = participant["plan"][participant["index"]]
        return [r for r in self.core.fusion.canonical_reps(pid, item["exercise_id"])
                if r["t_start"] >= participant["exercise_started_at"]]

    def _participant_view(self, sess, p, seen, now):
        """Everything the board shows for one participant. A very high heart rate overrides the form light."""
        pid = p["patient_id"]
        since = self._reps_since(pid, sess["started_at"])
        scores = [r["score"] for r in since][-3:]
        last_rep_at = since[-1]["t_end"] if since else None
        present = seen is not None
        if p["finished"]:
            light, reason = "finished", "Finished every exercise"
            exercise = progress = None
        else:
            holding = bool(seen and seen.get("holding"))
            light, reason = compute_light(present, now, last_rep_at, scores, holding,
                                          seen.get("hold_seconds", 0.0) if seen else 0.0)
            item = p["plan"][p["index"]]
            nxt = p["plan"][p["index"] + 1]["name"] if p["index"] + 1 < len(p["plan"]) else None
            exercise = {"id": item["exercise_id"], "name": item["name"], "tracking": item["tracking"],
                        "sets": item["sets"], "reps": item["reps"], "seconds": item["seconds"],
                        "load": item["load"], "modification": item["modification"],
                        "index": p["index"], "total": len(p["plan"]), "next": nxt}
            progress = exercise_progress(item, self._exercise_reps(pid, p), self.core.set_gap, now)
        heart = self.heart_view(pid, p.get("heart_zone"), now)
        if not p["finished"] and heart["status"] == "high":
            light, reason = "needs_help", f"Heart rate very high ({heart['bpm']} bpm). Check on them"
        return {"patient_id": pid, "board_name": p["board_name"], "light": light, "reason": reason,
                "heart_rate": heart, "present": present, "cameras": seen["cameras"] if seen else [],
                "exercise": exercise, "progress": progress, "recent_scores": scores,
                "last_rep_at": last_rep_at, "finished": p["finished"], "done_count": len(p["done"])}

    def heart_view(self, patient_id, zone, now=None):
        """Heart rate status for a patient. The current time can be passed in so one snapshot uses a single clock."""
        return evaluate(self.core.heart.latest(patient_id), self.clock() if now is None else now, zone)

    def heart_status(self, patient_id):
        """Heart rate status for a patient, using the zone from the running session if there is one."""
        p = self.session.participant(patient_id) if self.session.active else None
        return self.heart_view(patient_id, p.get("heart_zone") if p else None)

    def live_snapshot(self):
        """The full live status for the board."""
        now = self.clock()
        with self.core.lock:
            sess = self.session.state()
            seen = self.presence.patients(now)
            participants = []
            if sess and sess["ended_at"] is None:
                participants = [self._participant_view(sess, sess["participants"][pid], seen.get(pid), now)
                                for pid in sess["order"]]
            online = set(self.presence.cameras(now))
            cameras = [{"id": c, "online": c in online} for c in sorted(set(self.core.cameras) | online)]
            return {
                "server_time": now,
                "session": None if not sess else {
                    "id": sess["id"], "active": sess["ended_at"] is None, "started_at": sess["started_at"],
                    "ended_at": sess["ended_at"], "auto_advance": sess["auto_advance"]},
                "participants": participants,
                "unidentified": [{"camera_id": a["camera_id"], "track_key": a["track_key"]}
                                 for a in self.presence.anonymous(now)],
                "cameras": cameras,
            }

    def publish_live(self, force=False):
        """Send a snapshot to the bus. Without force, nothing is sent unless something other than the time has changed."""
        snapshot = self.live_snapshot()
        signature = json.dumps({k: v for k, v in snapshot.items() if k != "server_time"},
                               sort_keys=True, separators=(",", ":"))
        with self.core.lock:
            if not force and signature == self._signature:
                return False
            self._signature = signature
        self.bus.publish("status", snapshot)
        return True

    def after_activity(self):
        """Called after new events. Moves people on to their next exercise when auto advance is on and their target is met, then publishes."""
        with self.core.lock:
            sess = self.session.state()
            if self.session.active and sess["auto_advance"]:
                now = self.clock()
                for pid in self.session.order():
                    p = self.session.participant(pid)
                    if p["finished"]:
                        continue
                    item = p["plan"][p["index"]]
                    if item["tracking"] not in ("scored", "count_only") or not item.get("reps"):
                        continue
                    if exercise_progress(item, self._exercise_reps(pid, p), self.core.set_gap, now)["target_met"]:
                        self._advance(pid)
        self.publish_live()

    def start_ticker(self, interval=TICK_SECONDS):
        """Start the background thread that refreshes time based status such as resting and lost signal."""
        if self._ticker is not None:
            return

        def loop():
            while not self.stop_event.wait(interval):
                try:
                    self.publish_live()
                except Exception:  # never let the ticker die
                    pass

        self._ticker = threading.Thread(target=loop, daemon=True, name="live-ticker")
        self._ticker.start()

    def close(self):
        """Stop the ticker thread."""
        self.stop_event.set()

    def _assign(self, patient_id):
        """Point the patient's assignment at the exercise they are on, or clear it."""
        item = self.session.current_item(patient_id)
        if item:
            self.core.store.set_assignment(patient_id, item["exercise_id"])
        else:
            self.core.store.clear_assignment(patient_id)

    def _advance(self, patient_id, to_index=None):
        """Move a patient on in the session and update their assignment."""
        self.session.advance(patient_id, to_index)
        self._assign(patient_id)

    def session_start(self, participants, auto_advance=False):
        """Start a session and assign each participant their first exercise."""
        with self.core.lock:
            state = self.session.start(participants, auto_advance)
            for pid in state["order"]:
                self._assign(pid)
        self.publish_live(force=True)
        return state

    def session_advance(self, patient_id, to_index=None):
        """Move one participant to the next exercise, or to a chosen one."""
        with self.core.lock:
            self._advance(patient_id, to_index)
        self.publish_live()

    def session_set_auto_advance(self, enabled):
        """Turn automatic advancing on or off."""
        with self.core.lock:
            self.session.set_auto_advance(enabled)
        self.after_activity()

    def session_end(self):
        """End the session and return its summary."""
        with self.core.lock:
            summary = self.session_summary()  # computed before the session closes
            self.session.end()
        self.publish_live(force=True)
        return summary

    def session_summary(self):
        """Per patient and exercise results for the session, including form, range of motion, holds and heart rate."""
        sess = self.session.state()
        if not sess:
            raise SessionError("conflict", "No session")
        now = self.clock()
        out = []
        for pid in sess["order"]:
            p = sess["participants"][pid]
            exercises = []
            for i, item in enumerate(p["plan"]):
                reps = [r for r in self.core.fusion.canonical_reps(pid, item["exercise_id"])
                        if r["t_start"] >= sess["started_at"]]
                scores = [r["score"] for r in reps if r["score"] is not None]
                prog = exercise_progress(item, reps, self.core.set_gap, now)
                roms = [r["rom"] for r in reps if r.get("rom") is not None]
                tempos = [r["t_end"] - r["t_start"] for r in reps if r["t_end"] > r["t_start"]]
                holds = self.core.holds.for_patient(pid, item["exercise_id"], sess["started_at"])
                held = [h["seconds"] for h in holds]
                spans = [(r["t_start"], r["t_end"]) for r in reps] + [(h["t_start"], h["t_end"]) for h in holds]
                during = (summarize(self.core.heart.between(pid, min(a for a, _ in spans), max(b for _, b in spans)),
                                    p.get("heart_zone")) if spans else None)
                exercises.append({
                    "exercise_id": item["exercise_id"], "name": item["name"], "tracking": item["tracking"],
                    "target_sets": item["sets"], "target_reps": item["reps"], "reps": len(reps),
                    "sets": len(compute_sets(reps, self.core.set_gap)),
                    "good": sum(r["label"] == "good_form" for r in reps),
                    "needs_correction": sum(r["label"] == "needs_correction" for r in reps),
                    "flagged": sum(r["label"] == "flag_for_instructor" for r in reps),
                    "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
                    "avg_rom": round(sum(roms) / len(roms), 1) if roms else None,
                    "avg_rep_seconds": round(sum(tempos) / len(tempos), 2) if tempos else None,
                    "hold_attempts": len(holds),
                    "holds_completed": sum(1 for h in holds if h["completed"]),
                    "best_hold_seconds": round(max(held), 1) if held else None,
                    "avg_hold_seconds": round(sum(held) / len(held), 1) if held else None,
                    "avg_hr": during["avg_bpm"] if during else None,
                    "peak_hr": during["max_bpm"] if during else None,
                    "completed": any(d["index"] == i for d in p["done"]) or prog["target_met"],
                })
            ended = sess["ended_at"] or now
            heart = summarize(self.core.heart.between(pid, sess["started_at"], ended), p.get("heart_zone"))
            out.append({"patient_id": pid, "board_name": p["board_name"], "exercises": exercises, "heart": heart})
        return {"session_id": sess["id"], "started_at": sess["started_at"],
                "ended_at": sess["ended_at"] or now, "participants": out}

    def _publish_calibration(self, job):
        """Send the job's state to anyone watching it."""
        self.bus.publish("calibration", self.calibration.summary(job), key=job["id"])

    def calibration_create(self, patient_id, exercise, camera_id=None, target_reps=5):
        """Create a calibration job and tell watchers."""
        with self.core.lock:
            job = self.calibration.create(patient_id, exercise, camera_id, target_reps)
            self._publish_calibration(job)
            return self.calibration.summary(job)

    def calibration_claim(self, job_id, camera_id):
        """Let a camera claim a job and tell watchers."""
        with self.core.lock:
            job = self.calibration.claim(job_id, camera_id)
            self._publish_calibration(job)
            return self.calibration.summary(job)

    def calibration_frame(self, job_id, camera_id, frame):
        """Pass a preview skeleton to watchers. Frames that arrive too quickly are dropped."""
        with self.core.lock:
            job = self.calibration.set_frame(job_id, camera_id, frame)
            now = time.monotonic()
            if now - self._last_skeleton.get(job_id, 0.0) < SKELETON_MIN_INTERVAL:
                return  # forward only the newest frames; extras are dropped
            self._last_skeleton[job_id] = now
        self.bus.publish("skeleton", {**frame, "job_id": job["id"]}, key=job_id)

    def calibration_rep_event(self, event):
        """Handle a calibration rep sent as an event. Returns accepted, duplicate or rejected."""
        with self.core.lock:
            try:
                _, duplicate = self.calibration.add_rep(event.get("job_id"), event.get("camera_id"), event)
            except CalibrationError:
                return "rejected"
            if not duplicate:
                self._publish_calibration(self.calibration.get(event["job_id"]))
            return "duplicate" if duplicate else "accepted"

    def calibration_decide(self, job_id, index, decision):
        """Keep or discard a rep and tell watchers."""
        with self.core.lock:
            job = self.calibration.decide(job_id, index, decision)
            self._publish_calibration(job)
            return self.calibration.summary(job)

    def calibration_finish(self, job_id):
        """Finish a job, save the template and return the kept reps."""
        with self.core.lock:
            job = self.calibration.get(job_id)
            result = self.calibration.finish(job_id)
            self.core.store.put_template(job["patient_id"], result["slot"], result["template"])
            self._publish_calibration(job)
            return {"ok": True, "slot": result["slot"], "kept": result["kept"],
                    "warnings": result["warnings"], "reps": result["reps"]}

    def calibration_cancel(self, job_id):
        """Cancel a job and tell watchers."""
        with self.core.lock:
            job = self.calibration.cancel(job_id)
            self._publish_calibration(job)
            return self.calibration.summary(job)
