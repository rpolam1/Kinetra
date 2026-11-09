import os, sys
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from client import CameraPipeline, PersonSession
from server.holds import HoldLog
from test_hub_live import make, person, plan, post_reps, start


def hold(cam="A", t0=10.0, t1=22.0, pid="P-0001", seconds=12.0, completed=False, track=None, ex="wall_sit"):
    return {"camera_id": cam, "track_key": track or f"{cam}-1", "patient_id": pid, "exercise": ex,
            "t_start": t0, "t_end": t1, "seconds": seconds, "target_seconds": 30.0, "completed": completed}


def test_two_cameras_seeing_one_hold_count_once_with_the_longer_time():
    log = HoldLog()
    log.add(hold("A", 10, 22, seconds=12.0))
    log.add(hold("B", 10.3, 23, seconds=12.7))
    items = log.for_patient("P-0001")
    assert len(items) == 1 and items[0]["seconds"] == 12.7 and items[0]["cameras"] == {"A", "B"}


def test_separate_holds_from_one_camera_stay_separate():
    log = HoldLog()
    log.add(hold("A", 10, 22))
    log.add(hold("A", 40, 55, seconds=15.0))
    assert len(log.for_patient("P-0001")) == 2


def test_completed_wins_when_any_camera_saw_it_complete():
    log = HoldLog()
    log.add(hold("A", 10, 40, seconds=30.0, completed=True))
    log.add(hold("B", 10, 38, seconds=28.0, completed=False))
    assert log.for_patient("P-0001")[0]["completed"] is True


def test_anonymous_hold_is_claimed_by_a_later_bind_and_filters_work():
    log = HoldLog()
    log.add(hold("A", 10, 22, pid=None, track="A-7"))
    assert log.for_patient("P-0001") == []
    log.bind("A-7", "P-0001")
    assert len(log.for_patient("P-0001")) == 1
    assert log.for_patient("P-0001", exercise="plank") == []
    assert log.for_patient("P-0001", since=100.0) == []


def hold_event(t0, seconds, completed=False, cam="cam1", pid="P-0001"):
    return {"type": "hold", "event_id": f"{cam}-{pid}-{t0}", "patient_id": pid, "track_key": f"{cam}-1",
            "exercise": "wall_sit", "t_start": t0, "t_end": t0 + seconds, "seconds": seconds,
            "target_seconds": 30, "completed": completed}


def test_session_summary_reports_hold_statistics():
    c, core, now = make()
    start(c, [person(items=({"exercise_id": "wall_sit", "name": "Wall sit", "tracking": "timed", "sets": 1, "reps": None},))])
    now[0] = 1200.0
    post_reps(c, hold_event(1001, 12.0), hold_event(1030, 31.0, completed=True), hold_event(1070, 20.0))
    ex = c.post("/api/session/end").json["summary"]["participants"][0]["exercises"][0]
    assert ex["hold_attempts"] == 3
    assert ex["holds_completed"] == 1
    assert ex["best_hold_seconds"] == 31.0
    assert ex["avg_hold_seconds"] == 21.0


def test_summary_has_empty_hold_stats_for_rep_exercises():
    c, core, now = make()
    start(c)
    now[0] = 1100.0
    ex = c.post("/api/session/end").json["summary"]["participants"][0]["exercises"][0]
    assert ex["hold_attempts"] == 0 and ex["best_hold_seconds"] is None


def test_holds_are_rebuilt_from_the_event_log_after_a_restart():
    import tempfile
    from server.hub import HubCore, default_exercise_config_path
    db = os.path.join(tempfile.mkdtemp(), "hub.db")
    first = HubCore(db, exercise_config_path=default_exercise_config_path())
    first.ingest("cam1", [hold_event(1001, 12.0), hold_event(1030, 31.0, completed=True)])
    first.close()
    second = HubCore(db, exercise_config_path=default_exercise_config_path())
    items = second.holds.for_patient("P-0001", "wall_sit")
    assert sorted(h["seconds"] for h in items) == [12.0, 31.0]
    second.close()


def test_junk_hold_events_are_rejected():
    c, core, now = make()
    r = post_reps(c, {**hold_event(1001, 12.0), "seconds": -4}, {**hold_event(1002, 12.0), "seconds": "x"},
                  {**hold_event(1003, 12.0), "exercise": ""})
    assert r["accepted"] == 0
    assert core.holds.items == []


class FakeLink:
    camera_id = "c"

    def __init__(self):
        self.holds, self.reps = [], []

    def send_hold(self, hold, patient_id, track_id, exercise, id_source=None):
        self.holds.append((hold, patient_id, track_id, exercise))

    def send_rep(self, judgment, patient_id, track_id, exercise, id_source=None):
        self.reps.append((judgment, exercise))


def pipeline(link):
    return CameraPipeline({"wall_sit": {"target_duration_sec": 30}}, None, link)


def progress(holding, seconds, t):
    return {"type": "hold_progress", "holding": holding, "elapsed_seconds": seconds, "t": t}


PERSON = {"patient_id": "P-0001", "track_id": 3, "id_source": "tag"}


def drive(pipe, sess, steps):
    for j in steps:
        pipe._on_judgment(sess, PERSON, j)


def test_camera_reports_a_hold_that_ends_before_the_target():
    link = FakeLink()
    pipe, sess = pipeline(link), PersonSession(3)
    sess.exercise = "wall_sit"
    drive(pipe, sess, [progress(True, 2.0, 102.0), progress(True, 8.0, 108.0), progress(False, 0.0, 109.0)])
    assert len(link.holds) == 1
    hold, pid, tid, ex = link.holds[0]
    assert (pid, tid, ex) == ("P-0001", 3, "wall_sit")
    assert hold["seconds"] == 8.0 and hold["completed"] is False and hold["target_seconds"] == 30
    assert abs(hold["t_end"] - hold["t_start"] - 8.0) < 1e-6


def test_camera_ignores_a_wobble_shorter_than_three_seconds():
    link = FakeLink()
    pipe, sess = pipeline(link), PersonSession(3)
    sess.exercise = "wall_sit"
    drive(pipe, sess, [progress(True, 1.5, 101.5), progress(False, 0.0, 102.0)])
    assert link.holds == []


def test_camera_reports_the_full_length_of_a_completed_hold_once():
    link = FakeLink()
    pipe, sess = pipeline(link), PersonSession(3)
    sess.exercise = "wall_sit"
    drive(pipe, sess, [progress(True, 29.0, 129.0), {"type": "hold_complete", "elapsed_seconds": 30.0, "t_end": 130.0},
                       progress(True, 41.0, 141.0), progress(False, 0.0, 142.0)])
    assert len(link.reps) == 1 and link.reps[0][0]["label"] == "hold"
    assert len(link.holds) == 1
    assert link.holds[0][0]["seconds"] == 41.0 and link.holds[0][0]["completed"] is True


def test_camera_closes_a_hold_when_the_person_leaves_the_frame():
    link = FakeLink()
    pipe, sess = pipeline(link), PersonSession(3)
    sess.exercise = "wall_sit"
    drive(pipe, sess, [progress(True, 6.0, 106.0)])
    pipe._finish_hold(sess)
    assert len(link.holds) == 1 and link.holds[0][0]["seconds"] == 6.0
    pipe._finish_hold(sess)
    assert len(link.holds) == 1
