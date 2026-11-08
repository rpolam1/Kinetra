import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server.calibration import CalibrationManager, MIN_KEPT
from formcheck.paths import EXERCISES_PATH
from formcheck import simulation as sim
from formcheck.calibration_session import (CalibrationRunner, LIVE_POST_INTERVAL, MAX_REPLAY_FRAMES,
                                        REPLAY_PAD, subsample)

CONFIGS = json.load(open(EXERCISES_PATH))
JOB = {"id": "job1", "patient_id": "P-0001", "exercise": "goblet_squat", "target_reps": 5}


class FakeSender:
    def __init__(self):
        self.frames, self.reps = [], []

    def post_calibration_frame(self, job_id, frame):
        self.frames.append((job_id, frame))

    def send_calibration_rep(self, job_id, payload):
        self.reps.append((job_id, payload))


def person(track=1, pid=None, lm=None, source="unknown"):
    return {"track_id": track, "patient_id": pid, "id_source": source, "landmarks": lm}


def run(frames, people_for, job=JOB):
    sender = FakeSender()
    runner = CalibrationRunner(job, CONFIGS[job["exercise"]], sender)
    handled = []
    for ts, lm in frames:
        handled.append(runner.step(people_for(lm), sim.FRAME_SHAPE, 1000.0 + ts))
    return runner, sender, handled


def squats(n=5, seed=3):
    rng = random.Random(seed)
    return sim.frames([sim.good_spec(rng) for _ in range(n)], seed=seed)


def test_captures_every_rep_with_replay_frames():
    frames = squats(5)
    runner, sender, handled = run(frames, lambda lm: [person(1, None, lm)])
    assert runner.reps_sent == 5 and len(sender.reps) == 5
    for job_id, rep in sender.reps:
        assert job_id == "job1"
        assert rep["samples"][0]["timestamp"] == 0.0 and rep["samples"][-1]["timestamp"] > 0.5
        assert 2 <= len(rep["frames"]) <= MAX_REPLAY_FRAMES
        assert all(len(f["p"]) == 99 for f in rep["frames"])
        assert rep["frames"][0]["t"] >= 0 and rep["frames"][-1]["t"] > rep["samples"][-1]["timestamp"] * 0.8
        assert rep["rom"] > 30 and rep["partial_return"] is False
    assert all(h == 1 for h in handled[10:])  # the person is "being calibrated" throughout


def test_replay_includes_context_before_and_after_the_rep():
    _, sender, _ = run(squats(2), lambda lm: [person(1, None, lm)])
    rep = sender.reps[0][1]
    duration = rep["samples"][-1]["timestamp"]
    span = rep["frames"][-1]["t"] - rep["frames"][0]["t"]
    assert span >= duration  # the replay covers the whole rep, plus context


def test_uploaded_reps_are_accepted_by_the_hub_and_make_a_usable_template():
    _, sender, _ = run(squats(5), lambda lm: [person(1, None, lm)])
    mgr = CalibrationManager(CONFIGS)
    job = mgr.create("P-0001", "goblet_squat", camera_id="camA")
    mgr.claim(job["id"], "camA")
    for i, (_, rep) in enumerate(sender.reps):
        index, dup = mgr.add_rep(job["id"], "camA", dict(rep, event_id=f"e{i}"))
        mgr.decide(job["id"], index, "keep")
    result = mgr.finish(job["id"])
    assert result["kept"] == 5 and result["slot"] == "goblet_squat@camA"


def test_live_frames_are_throttled_and_carry_status():
    frames = squats(2)
    _, sender, _ = run(frames, lambda lm: [person(1, None, lm)])
    duration = frames[-1][0]
    assert duration / 0.3 <= len(sender.frames) <= duration / LIVE_POST_INTERVAL + 2  # ~4-5 per second, not every video frame
    live = sender.frames[5][1]
    assert live["status"] == "ok" and len(live["landmarks"]) == 33 and live["aspect"] == 1.333
    assert live["phase"] in ("rest", "out", "back") and isinstance(live["angle"], float)
    assert {f["phase"] for _, f in sender.frames} >= {"rest", "out"}  # the phase follows the movement


def test_no_one_in_view():
    runner, sender, handled = run([(0.0, None), (0.3, None)], lambda lm: [])
    assert handled == [None, None]
    assert sender.frames[0][1]["status"] == "no_person" and sender.frames[0][1]["landmarks"] is None


def test_several_unidentified_people_asks_for_the_tag():
    lm = squats(1)[0][1]
    runner, sender, handled = run([(0.0, lm)], lambda lm: [person(1, None, lm), person(2, None, lm)])
    assert handled == [None] and sender.frames[0][1]["status"] == "ambiguous"
    assert "tag" in sender.frames[0][1]["message"]


def test_someone_elses_tag_is_not_calibrated():
    lm = squats(1)[0][1]
    _, sender, handled = run([(0.0, lm)], lambda lm: [person(1, "P-0099", lm, "tag")])
    assert handled == [None] and sender.frames[0][1]["status"] == "wrong_person"


def test_the_patients_own_tag_wins_over_other_people():
    frames = squats(1)
    _, sender, handled = run(frames[:30], lambda lm: [person(1, None, lm), person(2, "P-0001", lm, "tag"), person(3, "P-0077", lm, "tag")])
    assert set(handled) == {2}


def test_the_person_being_tracked_is_sticky():
    frames = squats(1)[:40]
    runner = CalibrationRunner(JOB, CONFIGS["goblet_squat"], FakeSender())
    runner.step([person(1, None, frames[0][1])], sim.FRAME_SHAPE, 1000.0)
    assert runner.track_id == 1
    # another unknown walks in, still the first one
    r = runner.step([person(1, None, frames[1][1]), person(2, None, frames[1][1])], sim.FRAME_SHAPE, 1000.05)
    assert r == 1
    # first one leaves, re-target the remaining one
    assert runner.step([person(2, None, frames[2][1])], sim.FRAME_SHAPE, 1000.1) == 2


def test_hidden_joints_are_explained_and_the_skeleton_is_still_shown():
    lm = squats(1)[0][1]
    for i in (25, 27, 26, 28):  # knees and ankles not visible
        lm[i].visibility = 0.0
    runner, sender, handled = run([(0.0, lm)], lambda l: [person(1, None, l)])
    f = sender.frames[0][1]
    assert f["status"] == "joints_hidden" and "step back" in f["message"] and f["landmarks"] and f["angle"] is None
    assert sender.reps == [] and handled == [1]


def test_sloppy_partial_reps_are_flagged_not_hidden():
    rng = random.Random(1)
    spec = dict(sim.good_spec(rng), theta_min=105)
    frames = sim.frames([spec, spec, spec], seed=1)
    cut = [(t, lm) for t, lm in frames]
    _, sender, _ = run(cut, lambda lm: [person(1, None, lm)])
    assert len(sender.reps) == 3 and all("partial_return" in r for _, r in sender.reps)


def test_subsample_keeps_ends_and_respects_the_limit():
    assert subsample(list(range(5)), 10) == [0, 1, 2, 3, 4]
    s = subsample(list(range(200)), 60)
    assert len(s) == 60 and s[0] == 0 and s[-1] == 199 and s == sorted(s)


def test_each_rep_payload_is_small_enough():
    _, sender, _ = run(squats(3), lambda lm: [person(1, None, lm)])
    biggest = max(len(json.dumps(r)) for _, r in sender.reps)
    assert biggest < 120_000, biggest


if __name__ == "__main__":
    failed = 0
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            try: fn(); print("PASS ", n)
            except AssertionError as e: failed += 1; print("FAIL ", n, e)
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED"); sys.exit(1 if failed else 0)
