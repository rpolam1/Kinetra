import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from client import CameraPipeline, PersonSession
from formcheck import simulation as sim
from formcheck.calibration_session import CalibrationRunner
from formcheck.identity import PersonTracker
from formcheck.landmarks import is_visible
from formcheck.paths import EXERCISES_PATH
from formcheck.rep_segmenter import RepSegmenter
from test_calibration_runner import FakeSender, person, squats
from test_identity import H, SHAPE, W, LM, make_pose, tag_at

CONFIGS = json.load(open(EXERCISES_PATH))
JOB = {"id": "job1", "patient_id": "P-0001", "exercise": "goblet_squat", "target_reps": 5}


def feed(seg, angles, fps=20, t0=0.0):
    out = []
    for i, a in enumerate(angles):
        seg.add_sample({"timestamp": t0 + i / fps, "primary_angle": a, "signals": {}})
        out.extend(seg.extract_completed_reps_with_meta())
    return out


def test_pure_jitter_is_never_a_rep():
    rng = random.Random(4)
    angles = [120 + rng.uniform(-12, 12) for _ in range(600)]
    assert feed(RepSegmenter(min_angle_range_deg=15.0), angles) == []


def test_slow_wander_with_noise_is_never_a_rep():
    rng = random.Random(9)
    angles = [120 + 9 * (1 if (i // 3) % 2 else -1) + rng.gauss(0, 3) for i in range(600)]
    assert feed(RepSegmenter(min_angle_range_deg=15.0), angles) == []


def test_a_different_body_taking_over_the_signal_is_not_a_rep():
    seg = RepSegmenter(min_angle_range_deg=15.0, rest_direction="high")
    angles = [172.0] * 40 + [95.0] * 60 + [172.0] * 40
    assert feed(seg, angles) == []


def test_a_real_rep_after_a_jump_is_still_counted():
    seg = RepSegmenter(min_angle_range_deg=15.0, rest_direction="high")
    rep = [172 - 77 * (0.5 - 0.5 * __import__("math").cos(3.14159 * k / 20)) for k in range(1, 21)]
    angles = [172.0] * 40 + [95.0] * 40 + [172.0] * 40 + rep + rep[::-1] + [172.0] * 20
    assert len(feed(seg, angles)) == 1


def test_a_rep_cannot_span_a_tracking_dropout():
    seg = RepSegmenter(min_angle_range_deg=15.0, rest_direction="high")
    down = [172 - 3 * k for k in range(0, 26)]
    out = feed(seg, [172.0] * 30 + down)
    resumed = feed(seg, [172 - 75 + 3 * k for k in range(0, 26)] + [172.0] * 20, t0=10.0)
    assert out == [] and resumed == []


def test_landmarks_outside_the_frame_are_not_visible():
    lms = [LM(0.5, 0.5, 0.99) for _ in range(33)]
    lms[27] = LM(0.5, 1.2, 0.99)
    assert is_visible(lms, "hip") and not is_visible(lms, "ankle")


def test_walker_does_not_take_a_tag_held_by_someone_else():
    tr = PersonTracker()
    holder = 200.0
    for k in range(10):
        tr.update([make_pose(holder, 250)], SHAPE, [tag_at(1, 242, 250)], now=k * 0.05)
    holder_id = tr.tracks[0].id
    for k in range(10, 30):
        now = k * 0.05
        poses = [make_pose(holder, 250), make_pose(330, 250)]
        tr.update(poses, SHAPE, [tag_at(1, 272, 250)], now=now)
    bound = [t for t in tr.tracks if t.patient_id == "p001"]
    assert [t.id for t in bound] == [holder_id]


def test_a_much_bigger_pose_does_not_inherit_a_track():
    tr = PersonTracker()
    for k in range(10):
        tr.update([make_pose(300, 250, scale=0.12)], SHAPE, now=k * 0.05)
    first = tr.tracks[0].id
    people = tr.update([make_pose(300, 250, scale=0.30)], SHAPE, now=0.6)
    assert people and people[0]["track_id"] != first


class StubJudge:
    resets = 0

    def reset_motion(self):
        self.resets += 1


def test_a_sudden_jump_between_frames_resets_the_session():
    pipe = CameraPipeline({}, None)
    sess = PersonSession(1)
    sess.judge = StubJudge()
    p = {"centroid": (100.0, 200.0), "scale": 60.0}
    pipe._guard_jump(sess, p, 1.0)
    pipe._guard_jump(sess, dict(p, centroid=(110.0, 205.0)), 1.1)
    assert sess.judge.resets == 0
    pipe._guard_jump(sess, dict(p, centroid=(400.0, 205.0)), 1.2)
    assert sess.judge.resets == 1


def test_calibration_ignores_someone_too_close_to_the_camera():
    sender = FakeSender()
    runner = CalibrationRunner(JOB, CONFIGS[JOB["exercise"]], sender)
    last = None
    for ts, lm in squats(5):
        p = dict(person(1, None, lm), scale=0.6 * sim.FRAME_SHAPE[0])
        runner.step([p], sim.FRAME_SHAPE, 1000.0 + ts)
        last = sender.frames[-1][1] if sender.frames else last
    assert runner.reps_sent == 0 and last["status"] == "too_close"