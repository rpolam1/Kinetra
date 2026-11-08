import time
import uuid

from formcheck.template_manager import assemble_template

MIN_KEPT = 3  # fewest kept reps that make a usable template
MAX_TARGET = 10
DEFAULT_TARGET = 5
MAX_REPS = 60  # per job: stops a runaway camera from filling memory
MAX_SAMPLES_PER_REP = 2000
MAX_FRAMES_PER_REP = 200
MAX_LANDMARK_VALUES = 33 * 3
JOB_IDLE_EXPIRY = 30 * 60.0

ACTIVE = ("pending", "active")


class CalibrationError(Exception):

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


class CalibrationManager:
    def __init__(self, exercise_configs=None, clock=time.time):
        self.exercise_configs = exercise_configs
        self.clock = clock
        self._jobs = {}

    def create(self, patient_id, exercise, camera_id=None, target_reps=DEFAULT_TARGET):
        if not isinstance(patient_id, str) or not patient_id.strip() or len(patient_id) > 64:
            raise CalibrationError("invalid", "patient_id is required")
        if not isinstance(exercise, str) or not exercise:
            raise CalibrationError("invalid", "exercise is required")
        if not isinstance(target_reps, int) or isinstance(target_reps, bool) or not MIN_KEPT <= target_reps <= MAX_TARGET:
            raise CalibrationError("invalid", f"target_reps must be {MIN_KEPT}-{MAX_TARGET}")
        if camera_id is not None and (not isinstance(camera_id, str) or not camera_id.strip()):
            raise CalibrationError("invalid", "camera_id must be a non-empty string")
        if self.exercise_configs is not None:
            cfg = self.exercise_configs.get(exercise)
            if cfg is None:
                raise CalibrationError("invalid", f"Unknown exercise '{exercise}'")
            if cfg.get("tracking") != "scored":
                raise CalibrationError("invalid", f"{cfg.get('name', exercise)} is not form-scored, so it needs no calibration")

        self.expire()
        for job in self._jobs.values():  # one calibration per patient+exercise, one per camera
            if job["status"] in ACTIVE and (
                (job["patient_id"] == patient_id and job["exercise"] == exercise)
                or (camera_id is not None and job["camera_id"] == camera_id)
            ):
                self._close(job, "cancelled", "Replaced by a newer calibration")

        now = self.clock()
        job = {
            "id": uuid.uuid4().hex[:12], "patient_id": patient_id.strip(), "exercise": exercise,
            "camera_id": camera_id, "target_reps": target_reps, "status": "pending",
            "created": now, "updated": now, "reps": [], "seen_events": set(),
            "last_frame": None, "message": None, "result": None,
        }
        self._jobs[job["id"]] = job
        return job

    def get(self, job_id):
        job = self._jobs.get(job_id)
        if job is None:
            raise CalibrationError("not_found", "No such calibration")
        return job

    def claim(self, job_id, camera_id):
        job = self.get(job_id)
        if job["status"] not in ACTIVE:
            raise CalibrationError("conflict", f"Calibration is {job['status']}")
        if job["camera_id"] not in (None, camera_id):
            raise CalibrationError("conflict", f"Already claimed by {job['camera_id']}")
        job["camera_id"] = camera_id
        job["status"] = "active"
        self._touch(job)
        return job

    def cancel(self, job_id):
        job = self.get(job_id)
        if job["status"] in ACTIVE:
            self._close(job, "cancelled", "Cancelled")
        return job

    def expire(self):
        now = self.clock()
        for job in self._jobs.values():
            if job["status"] in ACTIVE and now - job["updated"] > JOB_IDLE_EXPIRY:
                self._close(job, "cancelled", "Expired after 30 minutes of inactivity")
        for job_id in [i for i, j in self._jobs.items() if j["status"] not in ACTIVE and now - j["updated"] > JOB_IDLE_EXPIRY]:
            del self._jobs[job_id]  # finished/cancelled jobs are forgotten after a while

    def add_rep(self, job_id, camera_id, payload):
        job = self.get(job_id)
        if job["status"] not in ACTIVE:
            raise CalibrationError("conflict", f"Calibration is {job['status']}")
        if job["camera_id"] != camera_id:
            raise CalibrationError("conflict", "This camera has not claimed the calibration")
        event_id = payload.get("event_id")
        if event_id is not None and event_id in job["seen_events"]:
            return next((r["index"] for r in job["reps"] if r.get("event_id") == event_id), 0), True
        if len(job["reps"]) >= MAX_REPS:
            raise CalibrationError("conflict", "Too many reps uploaded for one calibration")

        samples = payload.get("samples")
        if not isinstance(samples, list) or not 5 <= len(samples) <= MAX_SAMPLES_PER_REP:
            raise CalibrationError("invalid", "samples must be a list of 5-%d entries" % MAX_SAMPLES_PER_REP)
        for s in samples:
            if not isinstance(s, dict) or not _number(s.get("timestamp")) or not _number(s.get("angle")):
                raise CalibrationError("invalid", "each sample needs a numeric timestamp and angle")
        frames = payload.get("frames", [])
        if not isinstance(frames, list) or len(frames) > MAX_FRAMES_PER_REP:
            raise CalibrationError("invalid", "too many skeleton frames")
        for f in frames:
            p = f.get("p") if isinstance(f, dict) else None
            if not _number(f.get("t") if isinstance(f, dict) else None) or not isinstance(p, list) \
                    or len(p) > MAX_LANDMARK_VALUES or len(p) % 3 != 0 or not all(_number(v) for v in p):
                raise CalibrationError("invalid", "malformed skeleton frame")

        duration = samples[-1]["timestamp"] - samples[0]["timestamp"]
        if duration <= 0:
            raise CalibrationError("invalid", "rep has no duration")
        rom = payload.get("rom")
        index = len(job["reps"]) + 1
        job["reps"].append({
            "index": index, "event_id": event_id, "status": "pending",
            "rom": round(float(rom), 1) if _number(rom) else None,
            "duration_sec": round(duration, 3), "partial_return": bool(payload.get("partial_return")),
            "samples": samples, "frames": frames, "received_at": self.clock(),
        })
        if event_id is not None:
            job["seen_events"].add(event_id)
        self._touch(job)
        return index, False

    def set_frame(self, job_id, camera_id, frame):
        job = self.get(job_id)
        if job["status"] not in ACTIVE:
            raise CalibrationError("conflict", f"Calibration is {job['status']}")
        if job["camera_id"] != camera_id:
            raise CalibrationError("conflict", "This camera has not claimed the calibration")
        if not isinstance(frame, dict):
            raise CalibrationError("invalid", "frame must be an object")
        lm = frame.get("landmarks")
        if lm is not None and (not isinstance(lm, list) or len(lm) > 33
                               or any(not isinstance(p, list) or len(p) != 3 for p in lm)):
            raise CalibrationError("invalid", "malformed landmarks")
        job["last_frame"] = frame
        self._touch(job)
        return job

    def decide(self, job_id, index, decision):
        job = self.get(job_id)
        if job["status"] not in ACTIVE:
            raise CalibrationError("conflict", f"Calibration is {job['status']}")
        if decision not in ("keep", "discard"):
            raise CalibrationError("invalid", "decision must be 'keep' or 'discard'")
        rep = self._rep(job, index)
        rep["status"] = "kept" if decision == "keep" else "discarded"
        self._touch(job)
        return job

    def finish(self, job_id):
        job = self.get(job_id)
        if job["status"] not in ACTIVE:
            raise CalibrationError("conflict", f"Calibration is {job['status']}")
        kept = [r for r in job["reps"] if r["status"] == "kept"]
        if len(kept) < MIN_KEPT:
            raise CalibrationError("too_few", f"Keep at least {MIN_KEPT} good reps (you have {len(kept)}).")
        if job["camera_id"] is None:
            raise CalibrationError("conflict", "No camera has joined this calibration yet")

        slot = f"{job['exercise']}@{job['camera_id']}"
        template = assemble_template(job["patient_id"], slot, [
            {"samples": r["samples"], "duration_sec": r["duration_sec"]} for r in kept])
        warnings = []
        if self.exercise_configs is not None:
            from formcheck.form_scorer import build_profile, calibration_warnings
            profile = build_profile(template, self.exercise_configs.get(job["exercise"]))
            if profile is None:
                raise CalibrationError("unusable", "These reps could not be turned into a template. Redo a few and try again.")
            warnings = calibration_warnings(profile)

        job["result"] = {
            "slot": slot, "template": template, "kept": len(kept), "warnings": warnings,
            "reps": [{"index": r["index"], "samples": r["samples"], "frames": r["frames"],
                      "duration_sec": r["duration_sec"], "rom": r["rom"]} for r in kept],
        }
        self._close(job, "finished", None)
        return job["result"]

    def active_jobs(self):
        self.expire()
        return [self._brief(j) for j in self._jobs.values() if j["status"] in ACTIVE]

    def summary(self, job):
        counts = {s: sum(1 for r in job["reps"] if r["status"] == s) for s in ("pending", "kept", "discarded")}
        return {
            **self._brief(job), "kept": counts["kept"], "discarded": counts["discarded"], "pending": counts["pending"],
            "message": job["message"], "min_kept": MIN_KEPT,
            "slot": job["result"]["slot"] if job["result"] else None,
            "warnings": job["result"]["warnings"] if job["result"] else [],
            "reps": [{"index": r["index"], "status": r["status"], "rom": r["rom"],
                      "duration_sec": r["duration_sec"], "partial_return": r["partial_return"],
                      "n_frames": len(r["frames"])} for r in job["reps"]],
        }

    def rep_detail(self, job_id, index):
        rep = self._rep(self.get(job_id), index)
        return {k: rep[k] for k in ("index", "status", "rom", "duration_sec", "partial_return", "samples", "frames")}

    @staticmethod
    def _brief(job):
        return {"id": job["id"], "patient_id": job["patient_id"], "exercise": job["exercise"],
                "camera_id": job["camera_id"], "status": job["status"], "target_reps": job["target_reps"]}

    @staticmethod
    def _rep(job, index):
        if not isinstance(index, int) or not 1 <= index <= len(job["reps"]):
            raise CalibrationError("not_found", "No such rep")
        return job["reps"][index - 1]

    def _touch(self, job):
        job["updated"] = self.clock()

    def _close(self, job, status, message):
        job["status"] = status
        job["message"] = message
        job["last_frame"] = None
        self._touch(job)
