import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
from formcheck.feature_extractor import FeatureExtractor
from formcheck.landmarks import PoseLandmark
from test_all_exercises import (FPS, LIB, REPS, SHAPE, Rig, endpoints, pose, rep_exercises, run_reps,
                                timed_exercises)

RIGHT_SIDE = {12, 14, 16, 24, 26, 28}
LEFT_SIDE = {11, 13, 15, 23, 25, 27}
HIP_WIDTH = 30.0
SCALE = 1000.0
DEPTH_NOISE = 3.0


def pose3d(joint, theta, yaw_deg, rng=None):
    flat = pose(joint, theta)
    c, s = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
    out = []
    for idx, lm in enumerate(flat):
        if lm.visibility <= 0:
            out.append(PoseLandmark(lm.x, lm.y, 0.0, 0.0, 0.0, 0.0, 0.0))
            continue
        px, py = lm.x * 640.0, lm.y * 480.0
        u = px - (60.0 if idx in RIGHT_SIDE else 0.0) - 290.0
        lat = HIP_WIDTH if idx in LEFT_SIDE else -HIP_WIDTH
        x_cam = u * c + lat * s
        z_cam = -u * s + lat * c
        if rng is not None:
            z_cam += rng.gauss(0, DEPTH_NOISE)
        out.append(PoseLandmark((x_cam + 320.0) / 640.0, py / 480.0, 0.0, 0.99,
                                x_cam / SCALE, py / SCALE, z_cam / SCALE))
    return out


class ViewRig(Rig):
    def __init__(self, eid, yaw, template=None, seed=1, noise=1.2):
        super().__init__(eid, template, seed, noise)
        self.yaw = yaw
        self.depth_rng = random.Random(seed + 100)

    def feed(self, theta):
        lms = pose3d(self.cfg["angle_joint"], theta + self.rng.gauss(0, self.noise), self.yaw, self.depth_rng)
        f = self.ext.extract(lms, SHAPE)
        assert f is not None
        f["timestamp"] = self.t
        self.t += 1.0 / FPS
        self.out.extend(self.judge.process_feature(f))


def run_view_reps(eid, yaw, template=None, n=REPS, depth=1.0, seed=1):
    rig = ViewRig(eid, yaw, template, seed)
    rest, peak = endpoints(rig.cfg)
    rig.hold(rest, 1.5)
    for _ in range(n):
        rig.rep(rest, rest + (peak - rest) * depth)
        rig.hold(rest, 1.0)
    rig.hold(rest, 1.0)
    return rig


def view_template(eid, yaw=0):
    rig = ViewRig(eid, yaw)
    captured = []
    original = rig.judge.segmenter.extract_completed_reps_with_meta

    def grab(*a, **k):
        got = original(*a, **k)
        captured.extend(s for s, _ in got)
        return got

    rig.judge.segmenter.extract_completed_reps_with_meta = grab
    rest, peak = endpoints(rig.cfg)
    rig.hold(rest, 1.5)
    for _ in range(REPS):
        rig.rep(rest, peak)
        rig.hold(rest, 1.0)
    return {"calibration_reps": [{"samples": [{"timestamp": s["timestamp"] - r[0]["timestamp"], "angle": s["angle"],
                                               "aux": s["aux"], "signals": s["signals"]} for s in r]} for r in captured]}


def test_the_measured_angle_is_the_same_from_every_view():
    bad = []
    for eid in ("goblet_squat", "wall_sit"):
        cfg = LIB[eid]
        ext = FeatureExtractor(cfg)
        base = ext.extract(pose3d(cfg["angle_joint"], 100.0, 0.0), SHAPE)["primary_angle"]
        for yaw in (30, 60, 90, 120, 180):
            got = ext.extract(pose3d(cfg["angle_joint"], 100.0, yaw), SHAPE)["primary_angle"]
            if abs(got - base) > 1.0:
                bad.append((eid, yaw, round(base, 1), round(got, 1)))
    assert not bad, f"angle changed with the view: {bad}"


def test_every_rep_exercise_counts_every_rep_from_the_front_and_at_an_angle():
    bad = []
    for yaw in (45, 90):
        for eid in rep_exercises():
            got = len(run_view_reps(eid, yaw).reps_done())
            if got != REPS:
                bad.append((eid, yaw, got))
    assert not bad, f"wrong rep counts: {bad}"


def test_every_hold_completes_from_the_front():
    bad = []
    for eid in timed_exercises():
        rig = ViewRig(eid, 90)
        _, peak = endpoints(rig.cfg)
        rig.hold(peak, rig.cfg["target_duration_sec"] + 4)
        if not any(j["type"] == "hold_complete" for j in rig.out):
            bad.append(eid)
    assert not bad, f"hold never counted from the front: {bad}"


def test_standing_at_rest_is_not_a_hold_from_the_front():
    bad = []
    for eid in timed_exercises():
        rig = ViewRig(eid, 90)
        rest, _ = endpoints(rig.cfg)
        rig.hold(rest, rig.cfg["target_duration_sec"] + 10)
        if any(j["type"] == "hold_complete" for j in rig.out):
            bad.append(eid)
    assert not bad, f"rest counted as a hold from the front: {bad}"


def test_a_side_view_calibration_scores_front_view_reps():
    bad = []
    for eid in rep_exercises():
        if LIB[eid]["tracking"] != "scored":
            continue
        template = view_template(eid)
        good = [j["score"] for j in run_view_reps(eid, 70, template, n=3, seed=7).reps_done() if j["score"] is not None]
        shallow = [j["score"] for j in run_view_reps(eid, 70, template, n=3, depth=0.65, seed=7).reps_done()
                   if j["score"] is not None]
        if len(good) != 3 or min(good) < 80:
            bad.append((eid, "good", good))
        elif shallow and max(shallow) >= 80:
            bad.append((eid, "shallow", shallow))
    assert not bad, f"cross-view scoring problems: {bad}"
