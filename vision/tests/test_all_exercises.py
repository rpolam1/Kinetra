import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from formcheck.feature_extractor import FeatureExtractor
from formcheck.paths import EXERCISES_PATH
from formcheck.quality_judge import QualityJudge

LIB = json.load(open(EXERCISES_PATH))
SHAPE = (480, 640, 3)
FPS = 20
RANGE = {"knee": (85, 172), "hip_hinge": (80, 172), "elbow": (45, 168), "shoulder": (20, 150),
         "thigh_lean": (3, 55), "spine_lean": (3, 60)}
REPS = 5


class LM:
    def __init__(self, x=0.5, y=0.5, v=0.0):
        self.x, self.y, self.visibility = x, y, v


def _rot_up(theta):
    a = math.radians(theta)
    return (math.sin(a), -math.cos(a))


def _rot_down(theta):
    a = math.radians(theta)
    return (math.sin(a), math.cos(a))


def pose(joint, theta):
    lm = [LM() for _ in range(33)]
    for side, (shift, names) in enumerate(((0, (11, 13, 15, 23, 25, 27)), (60, (12, 14, 16, 24, 26, 28)))):
        sh, el, wr, hp, kn, an = names
        pts = {sh: (290 + shift, 120), el: (270 + shift, 190), wr: (265 + shift, 245),
               hp: (300 + shift, 240), kn: (300 + shift, 335), an: (300 + shift, 430)}
        if joint == "knee":
            k = pts[kn]
            pts[hp] = (k[0], k[1] - 95)
            d = _rot_up(theta)
            pts[an] = (k[0] + 95 * d[0], k[1] + 95 * d[1])
        elif joint == "hip_hinge":
            h = pts[hp]
            pts[sh] = (h[0], h[1] - 120)
            d = _rot_up(theta)
            pts[kn] = (h[0] + 95 * d[0], h[1] + 95 * d[1])
            pts[an] = (pts[kn][0], pts[kn][1] + 95)
        elif joint == "elbow":
            e = pts[el]
            pts[sh] = (e[0], e[1] - 70)
            d = _rot_up(theta)
            pts[wr] = (e[0] + 60 * d[0], e[1] + 60 * d[1])
        elif joint == "shoulder":
            s = pts[sh]
            pts[hp] = (s[0], s[1] + 120)
            d = _rot_down(theta)
            pts[el] = (s[0] + 65 * d[0], s[1] + 65 * d[1])
            pts[kn] = (pts[hp][0], pts[hp][1] + 95)
            pts[an] = (pts[kn][0], pts[kn][1] + 95)
        elif joint == "thigh_lean":
            h = pts[hp]
            a = math.radians(theta)
            pts[kn] = (h[0] + 95 * math.sin(a), h[1] + 95 * math.cos(a))
            pts[an] = (pts[kn][0], pts[kn][1] + 95)
        elif joint == "spine_lean":
            h = pts[hp]
            a = math.radians(theta)
            pts[sh] = (h[0] + 120 * math.sin(a), h[1] - 120 * math.cos(a))
        for idx, (x, y) in pts.items():
            lm[idx] = LM(x / 640.0, y / 480.0, 0.99)
    return lm


def endpoints(cfg):
    lo, hi = RANGE[cfg["angle_joint"]]
    rest_high = cfg.get("rest_direction") == "high"
    return (hi, lo) if rest_high else (lo, hi)


class Rig:
    def __init__(self, eid, template=None, seed=1, noise=1.2):
        self.cfg = LIB[eid]
        self.judge = QualityJudge(self.cfg, template)
        self.ext = FeatureExtractor(self.cfg)
        self.rng = random.Random(seed)
        self.noise = noise
        self.t = 0.0
        self.out = []

    def feed(self, theta):
        f = self.ext.extract(pose(self.cfg["angle_joint"], theta + self.rng.gauss(0, self.noise)), SHAPE)
        assert f is not None, "extractor returned nothing for a fully visible pose"
        f["timestamp"] = self.t
        self.t += 1.0 / FPS
        self.out.extend(self.judge.process_feature(f))

    def hold(self, theta, seconds):
        for _ in range(int(seconds * FPS)):
            self.feed(theta)

    def rep(self, rest, peak, dur=2.0):
        n = int(dur * FPS)
        for i in range(n):
            self.feed(rest + (peak - rest) * math.sin(math.pi * i / (n - 1)) ** 2)

    def reps_done(self):
        return [j for j in self.out if j["type"] == "rep"]


def run_reps(eid, template=None, n=REPS, depth=1.0, seed=1):
    rig = Rig(eid, template, seed)
    rest, peak = endpoints(rig.cfg)
    rig.hold(rest, 1.5)
    for _ in range(n):
        rig.rep(rest, rest + (peak - rest) * depth)
        rig.hold(rest, 1.0)
    rig.hold(rest, 1.0)
    return rig


def template_from(rig_eid):
    rig = Rig(rig_eid)
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


def rep_exercises():
    return [e for e, c in LIB.items() if c["tracking"] in ("scored", "count_only")]


def timed_exercises():
    return [e for e, c in LIB.items() if c["tracking"] == "timed"]


def test_every_rep_exercise_counts_every_rep():
    bad = []
    for eid in rep_exercises():
        got = len(run_reps(eid).reps_done())
        if got != REPS:
            bad.append((eid, got))
    assert not bad, f"wrong rep counts: {bad}"


def test_every_scored_exercise_scores_good_reps_high_and_shallow_reps_lower():
    bad = []
    for eid in rep_exercises():
        if LIB[eid]["tracking"] != "scored":
            continue
        template = template_from(eid)
        good = [j["score"] for j in run_reps(eid, template, n=3, seed=7).reps_done() if j["score"] is not None]
        shallow = [j["score"] for j in run_reps(eid, template, n=3, depth=0.65, seed=7).reps_done() if j["score"] is not None]
        if len(good) != 3 or min(good) < 80:
            bad.append((eid, "good", good))
        elif shallow and max(shallow) >= 80:
            bad.append((eid, "shallow", shallow))
    assert not bad, f"scoring problems: {bad}"


def test_standing_or_sitting_at_rest_never_counts_as_a_hold():
    bad = []
    for eid in timed_exercises():
        rig = Rig(eid)
        rest, _ = endpoints(rig.cfg)
        rig.hold(rest, rig.cfg["target_duration_sec"] + 15)
        if any(j["type"] == "hold_complete" for j in rig.out) or any(j.get("holding") for j in rig.out):
            bad.append(eid)
    assert not bad, f"counted rest as a hold: {bad}"


def test_every_hold_completes_once_when_the_position_is_held():
    bad = []
    for eid in timed_exercises():
        rig = Rig(eid)
        rest, peak = endpoints(rig.cfg)
        target = rig.cfg["target_duration_sec"]
        rig.hold(rest, 2.0)
        n = int(1.0 * FPS)
        for i in range(n):
            rig.feed(rest + (peak - rest) * i / (n - 1))
        rig.hold(peak, target + 4)
        done = [j for j in rig.out if j["type"] == "hold_complete"]
        if not done:
            bad.append((eid, "never completed"))
        elif done[0]["elapsed_seconds"] < target:
            bad.append((eid, "early", done[0]["elapsed_seconds"]))
    assert not bad, f"hold problems: {bad}"

def test_a_hold_counts_when_the_person_is_already_in_position_at_start():
    bad = []
    for eid in timed_exercises():
        rig = Rig(eid)
        _, peak = endpoints(rig.cfg)
        target = rig.cfg["target_duration_sec"]
        rig.hold(peak, target + 4)
        if not any(j["type"] == "hold_complete" for j in rig.out):
            bad.append(eid)
    assert not bad, f"hold never counted when already in position: {bad}"


def test_a_calibration_overrides_a_wrong_rest_direction_in_the_config():
    template = template_from("goblet_squat")
    wrong = dict(LIB["goblet_squat"], rest_direction="low")
    rig = Rig("goblet_squat", template)
    rig.cfg = wrong
    rig.judge = QualityJudge(wrong, template)
    rest, peak = endpoints(LIB["goblet_squat"])
    rig.hold(rest, 1.5)
    for _ in range(3):
        rig.rep(rest, peak)
        rig.hold(rest, 1.0)
    assert len(rig.reps_done()) == 3


if __name__ == "__main__":
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            fn()
            print("PASS ", n)
    print("\nALL PASSED")