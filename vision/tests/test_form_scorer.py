import copy
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from formcheck.paths import EXERCISES_PATH
from formcheck.feature_extractor import FeatureExtractor
from formcheck.rep_segmenter import RepSegmenter
from formcheck.quality_judge import QualityJudge
from formcheck.form_scorer import (build_profile, score_rep, calibration_warnings,
                                extract_rep_features)

FPS = 20  # a CPU webcam + pose model is often ~20 fps
SHAPE = (480, 640, 3)
ANGLE_NOISE = 2.5  # deg of per-frame jitter on every joint angle
_cfg_path = EXERCISES_PATH
CFG = json.load(open(_cfg_path))["goblet_squat"]
CFG_SYM = dict(CFG, symmetry_check=True)  # for left/right asymmetry tests


from formcheck.simulation import LM, frames, make_landmarks  # noqa: E402,F401  (shared with the demo camera)


def good(rng):
    return dict(theta_min=rng.uniform(95, 125), lean=rng.uniform(20, 32), dur=rng.uniform(1.3, 2.2))


def segment(specs, seed=0, cfg=CFG):
    ext, seg = FeatureExtractor(cfg), RepSegmenter(mode="rep_based")
    for ts, lm in frames(specs, seed):
        f = ext.extract(lm, SHAPE)
        assert f is not None
        f["timestamp"] = ts
        seg.add_sample(f)
    return seg.extract_completed_reps(flush_pending=True)


def to_template(reps):
    return {"calibration_reps": [{"samples": [
        {"timestamp": s["timestamp"] - r[0]["timestamp"], "angle": s["angle"],
         "aux": s["aux"], "signals": s["signals"]} for s in r]} for r in reps]}


_cache = {}


def calibration(cfg=CFG):
    key = id(cfg)
    if key not in _cache:
        rng = random.Random(1)
        reps = segment([good(rng) for _ in range(5)], seed=1, cfg=cfg)
        assert len(reps) == 5, len(reps)
        _cache[key] = (reps, build_profile(to_template(reps), cfg))
    return _cache[key]


def score(spec, seed, cfg=CFG):
    reps = segment([spec], seed=seed, cfg=cfg)
    assert len(reps) == 1, f"expected 1 rep, segmenter found {len(reps)}"
    _, profile = calibration(cfg)
    return score_rep(reps[0], profile)


def scores_for(spec_fn, n=5, cfg=CFG):
    rng = random.Random(7)
    out = []
    for i in range(n):
        r = score(spec_fn(rng), 300 + i, cfg)
        assert r["score"] is not None
        out.append(r)
    return out


def show(name, results):
    print(f"\n{name:26s} scores={[r['score'] for r in results]}  e.g. {results[0]['issues'][:2]}")


def test_calibration_durations_are_consistent():
    reps, _ = calibration()
    durs = [extract_rep_features(r)[0]["duration"] for r in reps]
    print("\ncalibration durations:", [round(d, 2) for d in durs])
    assert max(durs) / min(durs) < 1.9, durs


def test_hip_travel_is_stable_despite_torso_foreshortening():
    spec = dict(theta_min=110, lean=26, dur=1.7)
    reps = segment([spec] * 6, seed=3)
    roms = [extract_rep_features(r)[0]["hip_y.rom"] for r in reps]
    print("\nhip travel, fixed-depth reps (standing torso-lengths):", [round(x, 2) for x in roms])
    assert max(roms) / min(roms) < 1.35, roms


def test_calibration_warnings_are_informational():
    _, profile = calibration()
    warns = calibration_warnings(profile)
    print("\ncalibration warnings:", warns)
    assert isinstance(warns, list)


def test_similar_reps_are_good():
    res = scores_for(good, n=30)
    passing = sum(r["score"] >= 80 for r in res)
    print(f"\ngood reps passing: {passing}/30  min={min(r['score'] for r in res)}")
    assert passing >= 26
    assert min(r["score"] for r in res) >= 45


def test_shallow_squat_is_flagged():
    res = scores_for(lambda r: dict(good(r), theta_min=145))
    show("shallow (145 deg)", res)
    assert all(r["score"] < 80 for r in res)


def test_very_shallow_squat_is_flagged_hard():
    res = scores_for(lambda r: dict(good(r), theta_min=152))
    show("very shallow (152 deg)", res)
    assert all(r["score"] < 80 for r in res)


def test_excessive_forward_lean_is_flagged():
    res = scores_for(lambda r: dict(good(r), lean=62))
    show("lean 62 deg", res)
    assert all(r["score"] < 80 for r in res)


def test_fast_bounce_is_flagged():
    res = scores_for(lambda r: dict(good(r), dur=0.55))
    show("bounce 0.55s", res)
    assert all(r["score"] < 80 for r in res)


def test_slower_than_calibration_is_not_penalised():
    res = scores_for(lambda r: dict(good(r), dur=r.uniform(3.2, 4.5)))
    show("much slower than calib", res)
    assert all(r["score"] >= 80 for r in res)


def _fast_calibration():
    rng = random.Random(3)
    specs = [dict(good(rng), dur=rng.uniform(0.9, 1.2)) for _ in range(5)]
    reps = segment(specs, seed=3)
    return build_profile(to_template(reps), CFG), specs


def test_fast_calibration_then_normal_speed_reps_are_good():
    prof, cal_specs = _fast_calibration()
    rng = random.Random(9)
    for label, dur, flat in (("2x slower", (1.8, 2.4), 0.0),
                             ("3x slower", (3.0, 3.6), 0.0),
                             ("slow + pause at bottom", (2.4, 3.2), 0.6)):
        res = []
        for i in range(5):
            base = cal_specs[i % len(cal_specs)]
            spec = dict(base, dur=rng.uniform(*dur), flat=flat)
            res.append(score_rep(segment([spec], seed=900 + i)[0], prof))
        print(f"\nfast calib -> {label:24s}", [r["score"] for r in res], res[0]["issues"][:2])
        assert all(r["score"] >= 80 for r in res), label


def test_fast_calibration_still_catches_bounce():
    prof, cal_specs = _fast_calibration()
    res = [score_rep(segment([dict(cal_specs[i % 5], dur=0.4)], seed=950 + i)[0], prof)
           for i in range(5)]
    print("\nfast calib -> bounce 0.4s", [r["score"] for r in res])
    assert all(r["score"] < 80 for r in res)


def test_one_knee_much_shallower_is_flagged_when_symmetry_matters():
    res = scores_for(lambda r: dict(good(r), theta_min=100, theta_r_min=150), cfg=CFG_SYM)
    show("one knee shallow (sym)", res)
    assert all(r["score"] < 80 for r in res)


def test_mixed_session_through_quality_judge():
    _, _ = calibration()
    rng = random.Random(11)
    plan = [("good", good(rng)), ("good", good(rng)), ("good", good(rng)),
            ("bad", dict(good(rng), theta_min=146)), ("bad", dict(good(rng), theta_min=150)),
            ("good", good(rng)), ("bad", dict(good(rng), lean=63)), ("good", good(rng)),
            ("tail", good(rng))]  # tail rep so the last real rep is confirmed
    template = to_template(calibration()[0])
    judge = QualityJudge(CFG, template, debug=True)

    ext = FeatureExtractor(CFG)
    judgments = []
    for ts, lm in frames([s for _, s in plan], seed=21):
        f = ext.extract(lm, SHAPE)
        f["timestamp"] = ts
        judgments.extend(judge.process_feature(f))

    labels = [(j["label"], j["score"]) for j in judgments]
    print("\nlive judge labels:", labels)
    expected = [k for k, _ in plan][:len(judgments)]
    assert len(judgments) >= 7
    wrong = []
    for i, (kind, j) in enumerate(zip(expected, judgments)):
        if kind == "good" and j["score"] is not None and j["score"] < 50:
            wrong.append((i, "good flagged hard", j["score"]))
        if kind == "bad" and (j["score"] is None or j["score"] >= 80):
            wrong.append((i, "bad passed", j["score"]))
    assert not wrong, wrong


def test_old_format_template_is_rejected_gracefully():
    old = {"calibration_reps": [{"angles": [170, 120, 170], "aux": [], "duration_sec": 2.0}] * 3}
    assert build_profile(old, CFG) is None


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS  {name}")
            except AssertionError as e:
                failed += 1
                print(f"FAIL  {name}: {e}")
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED")
    sys.exit(1 if failed else 0)
