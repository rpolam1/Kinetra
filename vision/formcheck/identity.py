"""Finds out who each person in view is. AprilTags give a definite identity, and between tag sightings a tracker keeps it by position and by body proportions."""
import math

import numpy as np
from scipy.optimize import linear_sum_assignment

try:
    import cv2
except ImportError:  # TagDetector needs cv2; the tracker doesn't
    cv2 = None

VIS_MIN = 0.3
_NOSE = 0
_SHOULDERS = (11, 12)
_ELBOWS = (13, 14)
_WRISTS = (15, 16)
_HIPS = (23, 24)
_KNEES = (25, 26)
_ANKLES = (27, 28)
_TAG_NEAR_POINTS = (_NOSE,) + _SHOULDERS + _ELBOWS + _WRISTS + _HIPS


class TagDetector:
    """Detects AprilTags in a camera frame. Needs the OpenCV aruco module."""

    def __init__(self, dictionary="DICT_APRILTAG_36h11"):
        if cv2 is None or not hasattr(cv2, "aruco"):
            raise RuntimeError("OpenCV aruco module not available -- "
                               "install opencv-contrib-python")
        aruco = cv2.aruco
        self._dict = aruco.getPredefinedDictionary(getattr(aruco, dictionary))
        if hasattr(aruco, "ArucoDetector"):  # OpenCV >= 4.7
            self._detector = aruco.ArucoDetector(self._dict, aruco.DetectorParameters())
            self._params = None
        else:  # older OpenCV
            self._detector = None
            self._params = aruco.DetectorParameters_create()

    def detect(self, frame_bgr):
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        if self._detector is not None:
            corners, ids, _ = self._detector.detectMarkers(gray)
        else:
            corners, ids, _ = cv2.aruco.detectMarkers(gray, self._dict, parameters=self._params)
        out = []
        if ids is None:
            return out
        for c, tag_id in zip(corners, ids.flatten()):
            pts = np.asarray(c, dtype=float).reshape(4, 2)
            side = float(np.mean([np.linalg.norm(pts[i] - pts[(i + 1) % 4]) for i in range(4)]))
            out.append({"tag_id": int(tag_id), "center": tuple(pts.mean(axis=0)),
                        "size": side, "corners": pts})
        return out

    @staticmethod
    def make_tag_image(tag_id, size_px=400, dictionary="DICT_APRILTAG_36h11"):
        """Render a printable tag with a white border so detection still works on paper or a screen."""
        aruco = cv2.aruco
        d = aruco.getPredefinedDictionary(getattr(aruco, dictionary))
        if hasattr(aruco, "generateImageMarker"):
            img = aruco.generateImageMarker(d, tag_id, size_px)
        else:
            img = aruco.drawMarker(d, tag_id, size_px)
        border = size_px // 5
        return cv2.copyMakeBorder(img, border, border, border, border,
                                  cv2.BORDER_CONSTANT, value=255)


def _pt(landmarks, idx, w, h):
    """Landmark position in pixels, or None when it is too uncertain to use."""
    lm = landmarks[idx]
    if getattr(lm, "visibility", 1.0) < VIS_MIN:
        return None
    return (lm.x * w, lm.y * h)


def _mid(a, b):
    """Midpoint of two points, or whichever one exists."""
    if a is not None and b is not None:
        return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    return a or b


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def body_info(landmarks, frame_shape):
    """Measurements used for tracking: body centre, a size scale, a body-proportion signature and the points a tag can sit near. Returns None when fewer than two torso points are visible."""
    h, w = frame_shape[0], frame_shape[1]
    sh = [_pt(landmarks, i, w, h) for i in _SHOULDERS]
    hp = [_pt(landmarks, i, w, h) for i in _HIPS]
    torso_pts = [p for p in sh + hp if p is not None]
    if len(torso_pts) < 2:
        return None
    centroid = (sum(p[0] for p in torso_pts) / len(torso_pts),
                sum(p[1] for p in torso_pts) / len(torso_pts))

    sh_mid, hip_mid = _mid(*sh), _mid(*hp)
    shoulder_w = _dist(sh[0], sh[1]) if sh[0] and sh[1] else None
    torso_len = _dist(sh_mid, hip_mid) if sh_mid and hip_mid else None
    # Torso length is the best size scale, then shoulder width, then a fixed guess
    if torso_len:
        scale = torso_len
    elif shoulder_w:
        scale = shoulder_w * 1.3
    else:
        scale = 80.0
    scale = max(scale, 30.0)

    # weak biometric, only used to break ties on re-id
    sig = {}
    if torso_len and torso_len > 1:
        if shoulder_w:
            sig["sw"] = shoulder_w / torso_len
        for side, (kn, an) in enumerate(zip(_KNEES, _ANKLES)):
            hip, knee, ankle = hp[side], _pt(landmarks, kn, w, h), _pt(landmarks, an, w, h)
            if hip and knee:
                sig[f"th{side}"] = _dist(hip, knee) / torso_len
            if knee and ankle:
                sig[f"sk{side}"] = _dist(knee, ankle) / torso_len

    near = [p for p in (_pt(landmarks, i, w, h) for i in _TAG_NEAR_POINTS) if p is not None]
    return {"centroid": centroid, "scale": scale, "signature": sig, "near_points": near}


def _sig_diff(a, b):
    """Difference between two body signatures. Returns a neutral value when they share no measurements."""
    keys = set(a) & set(b)
    if not keys:
        return 0.15  # unknown: neutral
    return min(1.0, sum(abs(a[k] - b[k]) for k in keys) / len(keys))


def _merge_sig(old, new, alpha=0.15):
    """Blend a new signature into the stored one slowly, so a single noisy frame barely changes it."""
    out = dict(old)
    for k, v in new.items():
        out[k] = v if k not in out else (1 - alpha) * out[k] + alpha * v
    return out


class Track:
    """One person followed across frames, with their patient binding if they have one."""
    _next_id = 1

    def __init__(self, info, landmarks, now):
        self.id = Track._next_id
        Track._next_id += 1
        self.patient_id = None
        self.id_source = "unknown"  # "tag" | "continuity" | "reid" | "unknown"
        self.centroid = info["centroid"]
        self.velocity = (0.0, 0.0)
        self.scale = info["scale"]
        self.signature = dict(info["signature"])
        self.landmarks = landmarks
        self.first_seen = self.last_seen = now
        self.tag_last_seen = None
        self.matched_now = True

    def predicted(self, now):
        dt = min(max(now - self.last_seen, 0.0), 0.5)
        return (self.centroid[0] + self.velocity[0] * dt, self.centroid[1] + self.velocity[1] * dt)

    def update(self, info, landmarks, now):
        dt = max(now - self.last_seen, 1e-3)
        vx = (info["centroid"][0] - self.centroid[0]) / dt
        vy = (info["centroid"][1] - self.centroid[1]) / dt
        self.velocity = (0.6 * self.velocity[0] + 0.4 * vx, 0.6 * self.velocity[1] + 0.4 * vy)
        self.centroid = info["centroid"]
        self.scale = 0.7 * self.scale + 0.3 * info["scale"]
        self.signature = _merge_sig(self.signature, info["signature"])
        self.landmarks = landmarks
        self.last_seen = now
        self.matched_now = True


class PersonTracker:
    """Keeps a stable track id for each person across frames and attaches the patient id when a tag is seen."""
    def __init__(self, gate_scales=3.0, max_missing_sec=1.5, reid_window_sec=120.0,
                 reid_max_cost=0.5, reid_margin=0.08, tag_max_dist_scales=2.0):
        self.gate_scales = gate_scales
        self.max_missing_sec = max_missing_sec
        self.reid_window_sec = reid_window_sec
        self.reid_max_cost = reid_max_cost
        self.reid_margin = reid_margin
        self.tag_max_dist_scales = tag_max_dist_scales
        self.tracks = []
        self._lost = []  # snapshots of lost tracks that had a patient
        self._events = []

    def pop_events(self):
        ev, self._events = self._events, []
        return ev

    def update(self, poses, frame_shape, tags=(), now=0.0):
        """Match this frame's poses to existing tracks, start tracks for new people, apply tag sightings and drop people who have been gone too long. Returns the people matched in this frame."""
        infos = []
        for lms in poses:
            info = body_info(lms, frame_shape)
            if info is not None:
                infos.append((lms, info))

        for t in self.tracks:
            t.matched_now = False

        # 1. match poses to tracks
        pose_track = {}
        if self.tracks and infos:
            big = 1e6
            cost = np.full((len(self.tracks), len(infos)), big)
            for i, t in enumerate(self.tracks):
                pred = t.predicted(now)
                gate = self.gate_scales + 4.0 * min(now - t.last_seen, 1.0)
                for j, (_, info) in enumerate(infos):
                    d = _dist(pred, info["centroid"]) / max(t.scale, info["scale"])
                    if d <= gate:
                        cost[i, j] = d + 0.3 * _sig_diff(t.signature, info["signature"])
            rows, cols = linear_sum_assignment(cost)
            for i, j in zip(rows, cols):
                if cost[i, j] < big:
                    self.tracks[i].update(infos[j][1], infos[j][0], now)
                    pose_track[j] = self.tracks[i]

        # 2. unmatched: re-identify or start a track
        for j, (lms, info) in enumerate(infos):
            if j in pose_track:
                continue
            t = Track(info, lms, now)
            self._try_reid(t, info, frame_shape, now)
            self.tracks.append(t)
            pose_track[j] = t

        # 3. tags override guesses
        for tag in tags:
            self._apply_tag(tag, infos, pose_track, now)

        # 4. retire stale tracks
        alive = []
        for t in self.tracks:
            if t.matched_now or now - t.last_seen <= self.max_missing_sec:
                alive.append(t)
            elif t.patient_id is not None:
                self._lost.append({"patient_id": t.patient_id, "centroid": t.centroid,
                                   "scale": t.scale, "signature": dict(t.signature),
                                   "last_seen": t.last_seen})
        self.tracks = alive
        self._lost = [l for l in self._lost if now - l["last_seen"] <= self.reid_window_sec]

        return [self._public(t, now) for t in self.tracks if t.matched_now]

    # How long a tag sighting keeps counting as a direct identification
    TAG_FRESH_SEC = 2.0

    def _public(self, t, now):
        source = t.id_source
        if source == "tag" and (t.tag_last_seen is None or now - t.tag_last_seen > self.TAG_FRESH_SEC):
            source = "continuity"  # bound by a tag earlier; tag currently hidden
        return {"track_id": t.id, "patient_id": t.patient_id, "id_source": source,
                "landmarks": t.landmarks, "centroid": t.centroid, "scale": t.scale}

    def _active_patients(self):
        return {t.patient_id for t in self.tracks if t.patient_id is not None}

    def _try_reid(self, track, info, frame_shape, now):
        """Give a new track the identity of a recently lost one, but only when it is a clear best match."""
        if not self._lost:
            return
        diag = math.hypot(frame_shape[0], frame_shape[1])
        active = self._active_patients()
        cands = []
        for l in self._lost:
            if l["patient_id"] in active:
                continue  # that patient is already visible elsewhere
            c = _dist(l["centroid"], info["centroid"]) / diag + 0.6 * _sig_diff(l["signature"], info["signature"])
            cands.append((c, l))
        if not cands:
            return
        cands.sort(key=lambda x: x[0])
        best_cost, best = cands[0]
        runner = cands[1][0] if len(cands) > 1 else None
        if best_cost <= self.reid_max_cost and (runner is None or runner - best_cost >= self.reid_margin):
            self._set_patient(track, best["patient_id"], "reid")  # also clears the lost entry

    def _set_patient(self, track, patient_id, source):
        """Bind a patient to a track and record the change. Any other track holding the same patient is released first."""
        if track.patient_id == patient_id and track.id_source == source:
            return
        for other in self.tracks:  # one patient <-> one track at a time
            if other is not track and other.patient_id == patient_id:
                other.patient_id, other.id_source = None, "unknown"
        self._lost = [l for l in self._lost if l["patient_id"] != patient_id]
        changed = track.patient_id != patient_id
        track.patient_id, track.id_source = patient_id, source
        if changed:
            self._events.append({"track_id": track.id, "patient_id": patient_id, "source": source})

    def _apply_tag(self, tag, infos, pose_track, now):
        """Assign a tag to the nearest person. Tags far from everyone, or about equally close to two people, are ignored."""
        cx, cy = tag["center"]
        scored = []
        for j, (_, info) in enumerate(infos):
            if not info["near_points"]:
                continue
            d = min(_dist((cx, cy), p) for p in info["near_points"]) / info["scale"]
            scored.append((d, j))
        if not scored:
            return
        scored.sort()
        best_d, best_j = scored[0]
        if best_d > self.tag_max_dist_scales:
            return  # tag isn't on anyone
        if len(scored) > 1 and best_d > 0.6 and scored[1][0] < 1.3 * best_d:
            return  # ambiguous: wait for a clearer view
        track = pose_track.get(best_j)
        if track is None:
            return
        track.tag_last_seen = now
        # the caller maps tag_id to a patient id
        self._set_patient(track, tag["patient_id"] if "patient_id" in tag else tag["tag_id"], "tag")
