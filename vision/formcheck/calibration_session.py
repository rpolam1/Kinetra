"""Captures reps from a camera during a calibration job and sends them, with replay frames, to the hub."""
from collections import deque

from formcheck.feature_extractor import FeatureExtractor
from formcheck.rep_segmenter import RepSegmenter
from formcheck.template_manager import rep_samples_for_template

LIVE_POST_INTERVAL = 0.2  # seconds between live skeleton updates (~5/s)
FRAME_BUFFER_SECONDS = 25.0  # longest rep the segmenter accepts
REPLAY_PAD = 0.4  # seconds of context kept before and after each rep
MAX_REPLAY_FRAMES = 60  # keeps each uploaded rep small


def flat_landmarks(landmarks):
    """Flatten landmarks into x, y, visibility triples, rounded to keep the upload small."""
    out = []
    for lm in landmarks:
        out.extend((round(lm.x, 3), round(lm.y, 3), round(getattr(lm, "visibility", 1.0), 2)))
    return out


def grouped_landmarks(flat):
    return [flat[i:i + 3] for i in range(0, len(flat), 3)]


def subsample(items, limit):
    """Pick evenly spaced items, always keeping the first and last."""
    n = len(items)
    if n <= limit:
        return list(items)
    return [items[round(i * (n - 1) / (limit - 1))] for i in range(limit)]


class CalibrationRunner:
    """Drives one calibration job. Follows a single person, segments their reps and uploads each rep with a short replay of the frames around it."""
    def __init__(self, job, exercise_config, sender):
        self.job = job
        self.sender = sender
        self.extractor = FeatureExtractor(exercise_config)
        self.segmenter = RepSegmenter(
            mode="rep_based",
            min_angle_range_deg=exercise_config.get("min_rom_deg", 15.0),
            rest_direction=exercise_config.get("rest_direction"),
        )
        self.track_id = None  # the person being calibrated (sticky)
        self.reps_sent = 0
        self._frames = deque(maxlen=int(FRAME_BUFFER_SECONDS * 30))
        self._last_post = float("-inf")

    def _choose(self, people):
        """Pick the person to calibrate. Once chosen, the same track is kept until they leave view, so someone walking past does not take over the job."""
        if not people:
            self.track_id = None
            return None, "no_person", "No one in view"
        if self.track_id is not None:
            for p in people:
                if p["track_id"] == self.track_id:
                    return p, "ok", ""
            self.track_id = None
        # Prefer someone already identified by their tag as this patient
        mine = [p for p in people if p["patient_id"] == self.job["patient_id"]]
        if mine:
            self.track_id = mine[0]["track_id"]
            return mine[0], "ok", ""
        unknown = [p for p in people if p["patient_id"] is None]
        if len(people) == 1 and len(unknown) == 1:
            self.track_id = unknown[0]["track_id"]  # the only person in view: assume it is them
            return unknown[0], "ok", ""
        if len(people) == 1:
            return None, "wrong_person", "The person in view is wearing someone else's tag"
        return None, "ambiguous", "Several people in view: show the patient's tag so the right person is tracked"

    def step(self, people, frame_shape, now):
        """Process one frame of detections. Returns the track id being followed, or None when nobody usable is in view. Live status is posted at most every LIVE_POST_INTERVAL seconds."""
        person, status, message = self._choose(people)
        angle = None
        landmarks = None

        if person is not None:
            landmarks = flat_landmarks(person["landmarks"])
            self._frames.append((now, landmarks))
            feature = self.extractor.extract(person["landmarks"], frame_shape)
            if feature is None:
                status, message = "joints_hidden", "The whole body must be visible: step back or turn to face the camera"
            else:
                angle = round(feature["primary_angle"], 1)
                feature["timestamp"] = now
                self.segmenter.add_sample(feature)
                for samples, meta in self.segmenter.extract_completed_reps_with_meta():
                    self._send_rep(samples, meta)

        if now - self._last_post >= LIVE_POST_INTERVAL:
            self._last_post = now
            self.sender.post_calibration_frame(self.job["id"], {
                "status": status, "message": message, "angle": angle,
                "phase": self.segmenter.phase, "reps_sent": self.reps_sent,
                "aspect": round(frame_shape[1] / frame_shape[0], 3),
                "landmarks": grouped_landmarks(landmarks) if landmarks else None,
            })
        return self.track_id if person is not None else None

    def _send_rep(self, samples, meta):
        # Pad the window so the replay shows the setup and the return, not only the rep itself
        start, end = meta["t_start"] - REPLAY_PAD, meta["t_end"] + REPLAY_PAD
        window = [(t, lm) for t, lm in self._frames if start <= t <= end]
        frames = [{"t": round(t - start, 3), "p": lm} for t, lm in subsample(window, MAX_REPLAY_FRAMES)]
        self.reps_sent += 1
        self.sender.send_calibration_rep(self.job["id"], {
            "samples": rep_samples_for_template(samples),
            "frames": frames,
            "rom": round(meta["rom"], 1),
            "partial_return": meta["partial_return"],
        })
