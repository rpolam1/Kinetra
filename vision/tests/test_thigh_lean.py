"""Tests for the thigh lean angle, which measures how far a leg swings sideways."""
import math, os, random, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from formcheck.feature_extractor import FeatureExtractor
from formcheck.rep_segmenter import RepSegmenter
from formcheck.form_scorer import build_profile, score_rep
FPS, SHAPE = 20, (480, 640, 3)
CFG = {"mode": "rep_based", "angle_joint": "thigh_lean", "rest_direction": "low"}


class LM:
    def __init__(self, x=0.5, y=0.5, v=0.0): self.x, self.y, self.visibility = x, y, v


def pose(lift_deg_l, lift_deg_r=0.0):
    """A standing pose with each leg swung out by the given number of degrees."""
    lm = [LM() for _ in range(33)]
    def put(i, x, y): lm[i] = LM(x, y, 0.99)
    put(11, 0.46, 0.25); put(12, 0.54, 0.25)
    for hip_i, knee_i, ank_i, x0, lift in ((23, 25, 27, 0.47, lift_deg_l), (24, 26, 28, 0.53, lift_deg_r)):
        put(hip_i, x0, 0.50)
        a = math.radians(lift)  # leg swings sideways by `lift`
        W, H, L = 640, 480, 105.0  # build in PIXELS so angles are true
        put(knee_i, x0 + L * math.sin(a) / W, 0.50 + L * math.cos(a) / H)
        put(ank_i, x0 + 2 * L * math.sin(a) / W, 0.50 + 2 * L * math.cos(a) / H)
    return lm


def session(peaks, dur=1.8, rest=0.8, seed=1, noise=1.5):
    """Simulate a person lifting a leg to each peak in turn and return the reps found."""
    rng, ext, seg, out, t = random.Random(seed), FeatureExtractor(CFG), RepSegmenter(
        rest_direction="low"), [], 0.0
    def feed(l, r):
        nonlocal t
        f = ext.extract(pose(l + rng.gauss(0, noise), r), SHAPE); f["timestamp"] = t; t += 1 / FPS
        seg.add_sample(f); out.extend(seg.extract_completed_reps_with_meta())
    for _ in range(int(1.0 * FPS)): feed(2, 0)
    for p in peaks:
        n = int(dur * FPS)
        for i in range(n): feed(2 + (p - 2) * math.sin(math.pi * i / (n - 1)) ** 2, 0)
        for _ in range(int(rest * FPS)): feed(2, 0)
    return out


def test_extractor_reports_thigh_angle_from_vertical():
    ext = FeatureExtractor(CFG)
    assert ext.extract(pose(0), SHAPE)["primary_angle"] < 1.0
    assert abs(ext.extract(pose(40), SHAPE)["primary_angle"] - 40) < 2.0
    f = ext.extract(pose(30, 10), SHAPE)
    assert abs(f["signals"]["thigh_l"] - 30) < 2 and abs(f["signals"]["thigh_r"] - 10) < 2
    assert abs(f["signals"]["sym_gap"] - 20) < 3


def test_leg_lifts_are_counted_and_scored():
    reps = session([45] * 5)
    assert len(reps) == 5, len(reps)
    tpl = {"calibration_reps": [{"samples": [{"timestamp": s["timestamp"] - r[0]["timestamp"], "angle": s["angle"],
            "aux": None, "signals": s["signals"]} for s in r]} for r, _ in reps]}
    prof = build_profile(tpl, dict(CFG, symmetry_check=False))
    assert prof is not None
    good = score_rep(session([45], seed=9)[0][0], prof)
    low = score_rep(session([22], seed=9)[0][0], prof)
    assert good["score"] >= 80, good
    assert low["score"] < 80, low


if __name__ == "__main__":
    for n, fn in list(globals().items()):
        if n.startswith("test_"): fn(); print("PASS ", n)
    print("\nALL PASSED")
