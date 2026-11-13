"""Tests for the hub side calibration manager: validation, claiming, deduplication and template building."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from formcheck.paths import EXERCISES_PATH
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server.calibration import CalibrationError, CalibrationManager, MIN_KEPT, JOB_IDLE_EXPIRY
import test_form_scorer as T

CONFIGS = json.load(open(EXERCISES_PATH))


def real_reps(n=5, seed=1):
    """Reps in the shape a camera uploads them, made from simulated good squats."""
    rng = random.Random(seed)
    reps = T.segment([T.good(rng) for _ in range(n)], seed=seed)
    out = []
    for r in reps:
        t0 = r[0]["timestamp"]
        out.append({"samples": [{"timestamp": s["timestamp"] - t0, "angle": s["angle"], "aux": s["aux"],
                                 "signals": s["signals"]} for s in r],
                    "frames": [{"t": 0.0, "p": [0.5, 0.5, 0.9] * 33}], "rom": 70.0, "partial_return": False})
    return out


def started(mgr=None, camera="cam1", **kw):
    """A manager with one job that a camera has already claimed."""
    mgr = mgr or CalibrationManager(CONFIGS)
    job = mgr.create("P-0001", "goblet_squat", **kw)
    mgr.claim(job["id"], camera)
    return mgr, job


def raises(code, fn, *a, **k):
    """Check that the call raises a CalibrationError with the given code."""
    try:
        fn(*a, **k)
    except CalibrationError as e:
        assert e.code == code, (e.code, e.message)
        return
    raise AssertionError(f"expected CalibrationError({code})")


def test_create_validates_inputs():
    m = CalibrationManager(CONFIGS)
    raises("invalid", m.create, "", "goblet_squat")
    raises("invalid", m.create, "P-1", "nope")
    raises("invalid", m.create, "P-1", "plank")  # timed hold: not form-scored
    raises("invalid", m.create, "P-1", "goblet_squat", target_reps=2)
    raises("invalid", m.create, "P-1", "goblet_squat", target_reps=11)
    raises("invalid", m.create, "P-1", "goblet_squat", camera_id="  ")
    j = m.create("P-1", "goblet_squat")
    assert (j["status"], j["camera_id"], j["target_reps"]) == ("pending", None, 5)


def test_claim_rules():
    m = CalibrationManager(CONFIGS)
    j = m.create("P-1", "goblet_squat")
    m.claim(j["id"], "camA")
    assert m.get(j["id"])["status"] == "active"
    m.claim(j["id"], "camA")  # idempotent for the same camera
    raises("conflict", m.claim, j["id"], "camB")
    raises("not_found", m.claim, "missing", "camA")
    j2 = m.create("P-2", "lunge", camera_id="camC")
    raises("conflict", m.claim, j2["id"], "camD")  # reserved for camC


def test_new_job_replaces_old_one_for_same_patient_exercise_or_camera():
    m = CalibrationManager(CONFIGS)
    a = m.create("P-1", "goblet_squat", camera_id="cam1")
    b = m.create("P-1", "goblet_squat", camera_id="cam1")
    assert m.get(a["id"])["status"] == "cancelled" and m.get(b["id"])["status"] == "pending"
    c = m.create("P-9", "lunge", camera_id="cam1")  # same camera, different patient
    assert m.get(b["id"])["status"] == "cancelled" and c["status"] == "pending"
    assert [j["id"] for j in m.active_jobs()] == [c["id"]]


def test_reps_need_the_claiming_camera_and_are_deduplicated():
    m, j = started()
    rep = real_reps(1)[0]
    raises("conflict", m.add_rep, j["id"], "other-cam", dict(rep, event_id="e1"))
    assert m.add_rep(j["id"], "cam1", dict(rep, event_id="e1")) == (1, False)
    assert m.add_rep(j["id"], "cam1", dict(rep, event_id="e1")) == (1, True)  # a retry changes nothing
    assert len(m.get(j["id"])["reps"]) == 1
    assert m.add_rep(j["id"], "cam1", dict(rep, event_id="e2")) == (2, False)


def test_malformed_reps_are_rejected():
    m, j = started()
    good = real_reps(1)[0]
    raises("invalid", m.add_rep, j["id"], "cam1", dict(good, samples=good["samples"][:3]))
    raises("invalid", m.add_rep, j["id"], "cam1", dict(good, samples=[{"timestamp": "x", "angle": 1}] * 10))
    raises("invalid", m.add_rep, j["id"], "cam1", dict(good, frames=[{"t": 0, "p": [1, 2]}]))
    raises("invalid", m.add_rep, j["id"], "cam1", dict(good, frames=[{"t": 0, "p": [0.1] * 300}]))
    raises("invalid", m.add_rep, j["id"], "cam1", dict(good, frames="nope"))
    same_time = [dict(s, timestamp=1.0) for s in good["samples"]]
    raises("invalid", m.add_rep, j["id"], "cam1", dict(good, samples=same_time))
    assert m.get(j["id"])["reps"] == []


def test_decisions_and_summary():
    m, j = started()
    for i, rep in enumerate(real_reps(4)):
        m.add_rep(j["id"], "cam1", dict(rep, event_id=f"e{i}"))
    m.decide(j["id"], 1, "keep"); m.decide(j["id"], 2, "discard"); m.decide(j["id"], 3, "keep")
    s = m.summary(m.get(j["id"]))
    assert (s["kept"], s["discarded"], s["pending"]) == (2, 1, 1)
    assert [r["status"] for r in s["reps"]] == ["kept", "discarded", "kept", "pending"]
    m.decide(j["id"], 2, "keep")  # changing your mind is fine
    assert m.summary(m.get(j["id"]))["kept"] == 3
    raises("invalid", m.decide, j["id"], 1, "maybe")
    raises("not_found", m.decide, j["id"], 9, "keep")
    text = json.dumps(s)
    assert '"samples"' not in text and '"frames"' not in text  # summaries stay small


def test_rep_detail_includes_frames_for_replay():
    m, j = started()
    m.add_rep(j["id"], "cam1", real_reps(1)[0])
    d = m.rep_detail(j["id"], 1)
    assert d["frames"] and d["samples"] and d["status"] == "pending"


def test_finish_needs_enough_kept_reps_and_builds_a_usable_per_camera_template():
    m, j = started(camera="lab-2")
    for i, rep in enumerate(real_reps(5)):
        m.add_rep(j["id"], "lab-2", dict(rep, event_id=f"e{i}"))
    raises("too_few", m.finish, j["id"])
    for i in range(1, MIN_KEPT):
        m.decide(j["id"], i, "keep")
    raises("too_few", m.finish, j["id"])
    for i in range(3, 6):
        m.decide(j["id"], i, "keep")
    result = m.finish(j["id"])
    assert result["slot"] == "goblet_squat@lab-2" and result["kept"] == 5
    t = result["template"]
    assert t["version"] == 2 and t["patient_id"] == "P-0001" and len(t["calibration_reps"]) == 5
    assert isinstance(result["warnings"], list)
    assert m.get(j["id"])["status"] == "finished"
    raises("conflict", m.add_rep, j["id"], "lab-2", real_reps(1)[0])  # no more reps after finishing
    raises("conflict", m.finish, j["id"])


def test_finish_requires_a_camera_and_only_uses_kept_reps():
    m = CalibrationManager(CONFIGS)
    j = m.create("P-1", "goblet_squat")
    raises("too_few", m.finish, j["id"])
    m2, j2 = started()
    for i, rep in enumerate(real_reps(5)):
        m2.add_rep(j2["id"], "cam1", dict(rep, event_id=f"e{i}"))
    for i in (1, 2, 3):
        m2.decide(j2["id"], i, "keep")
    assert len(m2.finish(j2["id"])["template"]["calibration_reps"]) == 3  # discarded/pending reps are left out


def test_live_frame_is_validated_and_kept_only_while_active():
    m, j = started()
    m.set_frame(j["id"], "cam1", {"landmarks": [[0.5, 0.5, 0.9]] * 33, "status": "ok"})
    assert m.get(j["id"])["last_frame"]["status"] == "ok"
    raises("invalid", m.set_frame, j["id"], "cam1", {"landmarks": [[1, 2]]})
    raises("invalid", m.set_frame, j["id"], "cam1", "x")
    raises("conflict", m.set_frame, j["id"], "intruder", {"landmarks": []})
    m.cancel(j["id"])
    assert m.get(j["id"])["last_frame"] is None
    raises("conflict", m.set_frame, j["id"], "cam1", {"landmarks": []})


def test_idle_jobs_expire_and_old_ones_are_forgotten():
    now = [1000.0]
    m = CalibrationManager(CONFIGS, clock=lambda: now[0])
    j = m.create("P-1", "goblet_squat")
    now[0] += JOB_IDLE_EXPIRY + 1
    assert m.active_jobs() == [] and m.get(j["id"])["status"] == "cancelled"
    now[0] += JOB_IDLE_EXPIRY + 1
    m.expire()
    raises("not_found", m.get, j["id"])


def test_works_without_exercise_configs():
    m = CalibrationManager(None)
    j = m.create("P-1", "anything")
    m.claim(j["id"], "cam1")
    for i, rep in enumerate(real_reps(3)):
        m.add_rep(j["id"], "cam1", dict(rep, event_id=f"e{i}")); m.decide(j["id"], i + 1, "keep")
    assert m.finish(j["id"])["slot"] == "anything@cam1"


if __name__ == "__main__":
    failed = 0
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            try: fn(); print("PASS ", n)
            except AssertionError as e: failed += 1; print("FAIL ", n, e)
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED"); sys.exit(1 if failed else 0)
