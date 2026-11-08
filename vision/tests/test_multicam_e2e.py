import os
import random
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import test_form_scorer as T
from test_hub_client import RunningHub
from client import CameraPipeline, load_exercise_configs
from formcheck.paths import EXERCISES_PATH
from formcheck.hub_client import HubLink
from formcheck.template_manager import TemplateManager

H, W = T.SHAPE[:2]
FPS = T.FPS
T0 = 1_000_000.0  # simulated epoch (hub time)


def shifted(lms, dx, rng, jitter):
    return [T.LM(l.x + dx + rng.gauss(0, jitter), l.y + rng.gauss(0, jitter), l.visibility) for l in lms]


def chest_px(lms):
    return ((lms[11].x + lms[12].x) / 2 * W, (lms[11].y + lms[12].y) / 2 * H)


def build_scene():
    rng = random.Random(5)
    good = lambda: dict(T.good(rng))
    a_specs = [good() for _ in range(6)]
    b_specs = [good(), good(), dict(good(), theta_min=148), dict(good(), theta_min=150)]
    a = T.frames(a_specs, seed=11)
    b = T.frames(b_specs, seed=12)
    return a, b


def run_scene(hub, tag_schedule, skews, seed_base=0):
    cfgs = load_exercise_configs(EXERCISES_PATH)
    # calibration template for both patients, stored on the hub
    cal_reps, _ = T.calibration()
    template = T.to_template(cal_reps)
    admin = HubLink(hub.url, "admin")
    for pid in ("p001", "p002"):
        assert admin.push_template(pid, "goblet_squat", template)

    a_frames, b_frames = build_scene()
    delay_b = int(1.5 * FPS)
    n_frames = max(len(a_frames), len(b_frames) + delay_b) + 5

    cams = []
    for i, skew in enumerate(skews):
        link = HubLink(hub.url, f"cam{i + 1}", clock=lambda s=skew: time.time() + s)
        link.offset = -skew  # as if sync_clock() had measured the skew
        pipe = CameraPipeline(cfgs, TemplateManager(tempfile.mkdtemp()), link,
                              default_exercise="goblet_squat")
        cams.append((pipe, link, random.Random(seed_base + 100 + i), skew))

    for k in range(n_frames):
        sim_t = T0 + k / FPS
        la = a_frames[min(k, len(a_frames) - 1)][1]
        lb = b_frames[min(max(k - delay_b, 0), len(b_frames) - 1)][1]
        for ci, (pipe, link, rng, skew) in enumerate(cams):
            pa, pb = shifted(la, -0.2, rng, 0.0012), shifted(lb, +0.2, rng, 0.0012)
            tags = []
            for (cam_i, who, k0, k1) in tag_schedule:
                if cam_i == ci and k0 <= k < k1:
                    cx, cy = chest_px(pa if who == 1 else pb)
                    tags.append({"tag_id": who, "center": (cx, cy - 10), "size": 40})
            pipe.step([pa, pb], tags, T.SHAPE, sim_t + skew)
    for _, link, _, _ in cams:
        assert link.flush()
    return cams


def test_three_cameras_two_people_counted_once_and_identified():
    hub = RunningHub()
    try:
        schedule = [(0, 1, 5, 25), (0, 2, 40, 60),  # cam1 sees both tags early
                    (1, 1, 140, 160)]  # cam2 sees A's tag only late; cam3 never
        run_scene(hub, schedule, skews=[4.0, -3.0, 0.5])
        core = hub.core
        a = core.patient_summary("p001")["exercises"]["goblet_squat"]
        b = core.patient_summary("p002")["exercises"]["goblet_squat"]
        print("\np001:", a["total_reps"], "reps,", a["total_sets"], "set(s), avg", a["avg_score"],
              "cameras/rep:", [r["n_cameras"] for r in a["reps"]])
        print("p002:", b["total_reps"], "reps, labels:", [r["label"] for r in b["reps"]])
        print("unassigned:", len(core.unassigned()))
        assert a["total_reps"] == 6 and a["total_sets"] == 1
        assert b["total_reps"] == 4 and b["total_sets"] == 1
        assert all(r["n_cameras"] >= 2 for r in a["reps"] + b["reps"])
        assert core.unassigned() == []
        assert all(r["label"] == "good_form" for r in a["reps"])
        assert [r["label"] for r in b["reps"]][:2] == ["good_form", "good_form"]
        assert all(r["label"] != "good_form" for r in b["reps"][2:])
    finally:
        hub.stop()


def test_works_with_a_single_camera_and_no_hub_dedupe_needed():
    hub = RunningHub()
    try:
        run_scene(hub, [(0, 1, 5, 25), (0, 2, 40, 60)], skews=[0.0])
        a = hub.core.patient_summary("p001")["exercises"]["goblet_squat"]
        b = hub.core.patient_summary("p002")["exercises"]["goblet_squat"]
        assert a["total_reps"] == 6 and b["total_reps"] == 4
    finally:
        hub.stop()


def test_tag_never_seen_anywhere_leaves_reps_unassigned_but_counted_once():
    hub = RunningHub()
    try:
        run_scene(hub, [], skews=[1.0, -2.0])
        un = hub.core.unassigned()
        # both cameras anonymous: their reps merge with each other (same moment, different cameras)
        assert len(un) == 10, len(un)
    finally:
        hub.stop()


def test_per_camera_template_is_preferred_over_shared():
    hub = RunningHub()
    try:
        cfgs = load_exercise_configs(EXERCISES_PATH)
        cal_reps, _ = T.calibration()
        shared = T.to_template(cal_reps)
        own = dict(T.to_template(cal_reps), marker="camera-specific")
        admin = HubLink(hub.url, "admin")
        admin.push_template("p001", "goblet_squat", shared)
        admin.push_template("p001", "goblet_squat@cam1", own)
        link = HubLink(hub.url, "cam1")
        p1 = CameraPipeline(cfgs, TemplateManager(tempfile.mkdtemp()), link, default_exercise="goblet_squat")
        assert p1._template_for("p001", "goblet_squat", 0.0).get("marker") == "camera-specific"
        link2 = HubLink(hub.url, "cam2")  # no own template -> shared fallback
        p2 = CameraPipeline(cfgs, TemplateManager(tempfile.mkdtemp()), link2, default_exercise="goblet_squat")
        assert "marker" not in p2._template_for("p001", "goblet_squat", 0.0)
    finally:
        hub.stop()


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"PASS  {name}")
            except AssertionError as e:
                failed += 1; print(f"FAIL  {name}: {e}")
            except Exception as e:
                import traceback; traceback.print_exc()
                failed += 1; print(f"ERROR {name}: {type(e).__name__}: {e}")
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED")
    sys.exit(1 if failed else 0)
