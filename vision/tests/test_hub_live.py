"""Tests for the live features of the hub: the board, sessions, auto advance, presence, calibration jobs and the event stream."""
import json, os, sys, tempfile, threading, time
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import requests
from server.hub import HubCore, create_app, default_exercise_config_path
from test_calibration_manager import real_reps
from test_hub_client import RunningHub

CONFIG = default_exercise_config_path()


def make(clock=None, db=":memory:"):
    """A test client, the hub core and a fake clock that tests can move forward."""
    now = [1000.0]
    core = HubCore(db, exercise_config_path=CONFIG, clock=clock or (lambda: now[0]))
    return create_app(core).test_client(), core, now


def plan(*items):
    """A plan with one goblet squat item. Keyword arguments override its fields."""
    return [dict({"exercise_id": "goblet_squat", "name": "Goblet squats", "tracking": "scored", "sets": 2, "reps": 3}, **i)
            for i in (items or ({},))]


def person(pid="P-0001", name="Ana K.", **kw):
    """A session participant with a default plan."""
    return {"patient_id": pid, "board_name": name, "plan": plan(*kw.get("items", ()))}


def start(c, participants=None, auto=False):
    """Start a session and return its state."""
    r = c.put("/api/session", json={"participants": participants or [person()], "auto_advance": auto})
    assert r.status_code == 200, r.json
    return r.json


def rep(t0, score=95.0, pid="P-0001", ex="goblet_squat", cam="cam1", label=None, eid=None):
    """A rep event. The label follows the score unless one is given."""
    label = label or ("good_form" if score >= 80 else "needs_correction" if score >= 50 else "flag_for_instructor")
    return {"type": "rep", "event_id": eid or f"{cam}-{pid}-{t0}", "patient_id": pid, "track_key": f"{cam}-1",
            "exercise": ex, "t_start": t0, "t_end": t0 + 2.0, "score": score, "label": label, "coverage": 1.0, "issues": []}


def with_rom(ev, rom):
    """Copy of a rep event with a range of motion added."""
    return {**ev, "rom": rom}


def post_reps(c, *reps, cam="cam1"):
    """Post rep events from one camera."""
    r = c.post("/api/events", json={"camera_id": cam, "events": list(reps)})
    assert r.status_code == 200, r.json
    return r.json


def present(c, pid="P-0001", cam="cam1"):
    """Report that a camera can see the patient."""
    assert c.post("/api/presence", json={"camera_id": cam, "people": [
        {"patient_id": pid, "track_key": f"{cam}-1", "id_source": "tag", "exercise": "goblet_squat"}]}).status_code == 200


def snap(c):
    """The live snapshot."""
    return c.get("/api/live").json


def p0(c):
    """The first participant on the board."""
    return snap(c)["participants"][0]



def test_no_session_means_empty_snapshot():
    c, *_ = make()
    s = snap(c)
    assert s["session"] is None and s["participants"] == [] and s["unidentified"] == []


def test_starting_a_session_assigns_the_first_exercise_to_cameras():
    c, core, now = make()
    start(c, [person(), person("P-0002", "Bo L.", items=[{"exercise_id": "lunge", "name": "Lunges"}])])
    a = c.get("/api/state").json["assignments"]
    assert a["P-0001"]["exercise"] == "goblet_squat" and a["P-0002"]["exercise"] == "lunge"
    assert [p["board_name"] for p in snap(c)["participants"]] == ["Ana K.", "Bo L."]


def test_session_validation_and_single_session_rule():
    c, *_ = make()
    assert c.put("/api/session", json={"participants": []}).status_code == 400
    assert c.put("/api/session", json={}).status_code == 400
    start(c)
    r = c.put("/api/session", json={"participants": [person()]})
    assert r.status_code == 409 and r.json["code"] == "conflict"


def test_light_follows_presence_and_form():
    c, core, now = make()
    start(c)
    assert p0(c)["light"] == "not_detected" and p0(c)["present"] is False
    present(c)
    assert (p0(c)["light"], p0(c)["present"], p0(c)["cameras"]) == ("resting", True, ["cam1"])
    now[0] = 1010.0
    present(c)
    post_reps(c, rep(1001), rep(1004), rep(1007))
    assert p0(c)["light"] == "on_track" and p0(c)["recent_scores"] == [95.0] * 3
    now[0] = 1013.0
    present(c)
    post_reps(c, rep(1010, score=85.0))
    assert p0(c)["light"] == "on_track"  # [95, 95, 85]: still good
    post_reps(c, rep(1013, score=40.0))
    assert p0(c)["light"] == "drifting"  # [95, 85, 40]: one flagged rep
    post_reps(c, rep(1016, score=45.0))
    assert p0(c)["light"] == "needs_help"
    now[0] += 30.0  # nobody has done a rep for a while
    present(c)
    assert p0(c)["light"] == "resting"
    now[0] += 20.0  # and the camera stopped seeing them
    assert p0(c)["light"] == "not_detected"


def test_progress_counts_reps_and_sets():
    c, core, now = make()
    start(c)
    present(c)
    now[0] = 1050.0
    post_reps(c, rep(1001), rep(1004), rep(1007), rep(1040), rep(1043))  # a set of 3, a rest, then 2 more
    present(c)
    pr = p0(c)["progress"]
    assert (pr["reps_done"], pr["sets_done"], pr["set_number"], pr["current_set_reps"], pr["target_met"]) == (5, 1, 2, 2, False)
    assert p0(c)["exercise"]["name"] == "Goblet squats" and p0(c)["exercise"]["total"] == 1


def test_only_reps_for_the_current_exercise_since_it_started_count():
    c, core, now = make()
    start(c, [person(items=[{"exercise_id": "push_up", "name": "Push-ups", "tracking": "scored"}])])
    now[0] = 1020.0
    post_reps(c, rep(990, ex="push_up"), rep(1005, ex="lunge"))  # before the session / wrong exercise
    assert p0(c)["progress"]["reps_done"] == 0
    post_reps(c, rep(1010, ex="push_up"))
    assert p0(c)["progress"]["reps_done"] == 1


def test_two_cameras_seeing_one_rep_count_once():
    c, core, now = make()
    start(c)
    now[0] = 1010.0
    post_reps(c, rep(1001, cam="camA"), cam="camA")
    post_reps(c, rep(1001.2, cam="camB"), cam="camB")
    assert p0(c)["progress"]["reps_done"] == 1


def test_auto_advance_moves_on_when_the_target_is_met_and_updates_the_camera_assignment():
    c, core, now = make()
    start(c, [person(items=[{}, {"exercise_id": "push_up", "name": "Push-ups", "tracking": "scored", "sets": 1, "reps": 3}])], auto=True)
    # plan = [goblet_squat 2x3, push_up 1x3]; the first target is 6 reps
    now[0] = 1100.0
    post_reps(c, rep(1001), rep(1004), rep(1007))
    assert p0(c)["exercise"]["id"] == "goblet_squat"
    post_reps(c, rep(1040), rep(1043), rep(1046))  # second set (past the set gap) -> target met
    assert p0(c)["exercise"]["id"] == "push_up" and p0(c)["progress"]["reps_done"] == 0
    assert c.get("/api/state").json["assignments"]["P-0001"]["exercise"] == "push_up"


def test_without_auto_advance_the_instructor_moves_people_on():
    c, core, now = make()
    start(c)
    now[0] = 1100.0
    post_reps(c, rep(1001), rep(1004), rep(1007), rep(1040), rep(1043), rep(1046))
    assert p0(c)["progress"]["target_met"] is True and p0(c)["exercise"]["id"] == "goblet_squat"
    assert c.post("/api/session/advance", json={"patient_id": "P-0001"}).status_code == 200
    assert p0(c)["finished"] is True and p0(c)["light"] == "finished" and p0(c)["exercise"] is None
    assert "P-0001" not in c.get("/api/state").json["assignments"]
    assert c.post("/api/session/advance", json={"patient_id": "P-0001"}).status_code == 409
    assert c.post("/api/session/advance", json={"patient_id": "ghost"}).status_code == 404
    assert c.post("/api/session/advance", json={}).status_code == 400


def test_toggling_auto_advance():
    c, *_ = make()
    assert c.post("/api/session/auto-advance", json={"enabled": True}).status_code == 409  # no session yet
    start(c)
    assert c.post("/api/session/auto-advance", json={"enabled": True}).status_code == 200
    assert snap(c)["session"]["auto_advance"] is True


def test_unidentified_people_are_listed_without_a_patient():
    c, *_ = make()
    c.post("/api/presence", json={"camera_id": "cam2", "people": [{"patient_id": None, "track_key": "cam2-7"}]})
    assert snap(c)["unidentified"] == [{"camera_id": "cam2", "track_key": "cam2-7"}]
    assert {"id": "cam2", "online": True} in snap(c)["cameras"]


def test_presence_validation():
    c, *_ = make()
    assert c.post("/api/presence", json={"people": []}).status_code == 400
    assert c.post("/api/presence", json={"camera_id": "c", "people": "x"}).status_code == 400
    assert c.post("/api/presence", json={"camera_id": "c", "people": ["x"]}).status_code == 400
    assert c.post("/api/presence", json={"camera_id": "c", "people": []}).status_code == 200


def test_end_of_session_summary():
    c, core, now = make()
    start(c)
    now[0] = 1100.0
    post_reps(c, rep(1001, 95.0), rep(1004, 60.0), rep(1007, 30.0))
    r = c.post("/api/session/end").json
    ex = r["summary"]["participants"][0]["exercises"][0]
    assert (ex["reps"], ex["good"], ex["needs_correction"], ex["flagged"], ex["avg_score"], ex["sets"]) == (3, 1, 1, 1, 61.7, 1)
    assert snap(c)["session"]["active"] is False and snap(c)["participants"] == []
    assert c.post("/api/session/end").status_code == 409
    start(c)  # a new one can start afterwards


def test_session_summary_reports_rom_and_tempo():
    c, core, now = make()
    start(c)
    now[0] = 1100.0
    post_reps(c, with_rom(rep(1001, 95.0), 80.0), with_rom(rep(1004, 90.0), 70.0), rep(1007, 85.0))
    ex = c.post("/api/session/end").json["summary"]["participants"][0]["exercises"][0]
    assert ex["avg_rom"] == 75.0
    assert ex["avg_rep_seconds"] == 2.0


def test_session_summary_rom_is_null_without_data():
    c, core, now = make()
    start(c)
    now[0] = 1100.0
    post_reps(c, rep(1001, 95.0))
    ex = c.post("/api/session/end").json["summary"]["participants"][0]["exercises"][0]
    assert ex["avg_rom"] is None


def test_snapshot_is_published_only_when_it_changes():
    c, core, now = make()
    start(c)
    seq = core.live.bus.seq
    for _ in range(5):
        assert core.live.publish_live() is False
    assert core.live.bus.seq == seq
    present(c)
    assert core.live.bus.seq == seq + 1
    present(c)  # a repeat heartbeat changes nothing
    assert core.live.bus.seq == seq + 1


def test_session_survives_a_hub_restart():
    path = os.path.join(tempfile.mkdtemp(), "hub.db")
    c, core, now = make(db=path)
    start(c, auto=True)
    c.post("/api/session/advance", json={"patient_id": "P-0001"})
    core.close()
    c2, core2, _ = make(db=path)
    s = c2.get("/api/session").json["session"]
    assert s["auto_advance"] is True and s["participants"]["P-0001"]["finished"] is True



def new_job(c, camera="camA", exercise="goblet_squat", **kw):
    """Create a calibration job and return its id."""
    r = c.post("/api/calibration", json=dict({"patient_id": "P-0001", "exercise": exercise, "camera_id": camera}, **kw))
    assert r.status_code == 201, r.json
    return r.json["id"]


def upload(c, job_id, camera, reps):
    """Upload calibration reps as events from a camera."""
    for i, rep_payload in enumerate(reps):
        r = c.post("/api/events", json={"camera_id": camera, "events": [dict(
            rep_payload, type="calibration_rep", event_id=f"{job_id}-{i}", job_id=job_id)]})
        assert r.json.get("accepted") == 1, r.json


def test_cameras_discover_calibration_jobs_through_state():
    c, *_ = make()
    job = new_job(c, camera=None)
    jobs = c.get("/api/state").json["calibration"]
    assert jobs == [{"id": job, "patient_id": "P-0001", "exercise": "goblet_squat", "camera_id": None,
                     "status": "pending", "target_reps": 5}]
    assert c.post(f"/api/calibration/{job}/claim", json={"camera_id": "camB"}).json["camera_id"] == "camB"
    assert c.get("/api/state").json["calibration"][0]["status"] == "active"
    assert c.post(f"/api/calibration/{job}/claim", json={"camera_id": "camC"}).status_code == 409


def test_full_calibration_flow_stores_a_per_camera_template():
    c, core, _ = make()
    job = new_job(c)
    c.post(f"/api/calibration/{job}/claim", json={"camera_id": "camA"})
    upload(c, job, "camA", real_reps(5))
    s = c.get(f"/api/calibration/{job}").json
    assert s["pending"] == 5 and len(s["reps"]) == 5 and "samples" not in json.dumps(s)
    d = c.get(f"/api/calibration/{job}/reps/1").json
    assert d["frames"] and d["samples"]
    assert c.post(f"/api/calibration/{job}/finish").status_code == 422  # nothing kept yet
    for i in (1, 2, 4, 5):
        assert c.post(f"/api/calibration/{job}/reps/{i}/decision", json={"decision": "keep"}).status_code == 200
    assert c.post(f"/api/calibration/{job}/reps/3/decision", json={"decision": "discard"}).json["discarded"] == 1
    out = c.post(f"/api/calibration/{job}/finish").json
    assert out["slot"] == "goblet_squat@camA" and out["kept"] == 4 and len(out["reps"]) == 4
    tpl = c.get("/api/templates/P-0001/goblet_squat@camA").json
    assert tpl["version"] == 2 and len(tpl["calibration_reps"]) == 4
    assert c.get("/api/state").json["calibration"] == []
    assert c.post(f"/api/calibration/{job}/finish").status_code == 409


def test_calibration_errors_map_to_clear_statuses():
    c, *_ = make()
    assert c.post("/api/calibration", json={"patient_id": "P-1", "exercise": "plank"}).json["code"] == "invalid"
    assert c.post("/api/calibration", json={"patient_id": "P-1", "exercise": "nope"}).status_code == 400
    assert c.post("/api/calibration", json={}).status_code == 400
    assert c.get("/api/calibration/missing").status_code == 404
    assert c.post("/api/calibration/missing/finish").status_code == 404
    job = new_job(c)
    assert c.post(f"/api/calibration/{job}/reps/1/decision", json={"decision": "keep"}).status_code == 404
    assert c.post(f"/api/calibration/{job}/claim", json={}).status_code == 400


def test_reps_from_the_wrong_camera_or_malformed_reps_are_rejected_and_retries_are_idempotent():
    c, *_ = make()
    job = new_job(c)
    c.post(f"/api/calibration/{job}/claim", json={"camera_id": "camA"})
    rep0 = real_reps(1)[0]
    r = c.post("/api/events", json={"camera_id": "intruder", "events": [dict(rep0, type="calibration_rep", event_id="x", job_id=job)]})
    assert r.json == {"accepted": 0, "duplicates": 0, "rejected": 1}
    bad = c.post("/api/events", json={"camera_id": "camA", "events": [dict(rep0, type="calibration_rep", event_id="y", job_id=job, samples=[])]})
    assert bad.json["rejected"] == 1
    ev = dict(rep0, type="calibration_rep", event_id="z", job_id=job)
    assert c.post("/api/events", json={"camera_id": "camA", "events": [ev]}).json["accepted"] == 1
    assert c.post("/api/events", json={"camera_id": "camA", "events": [ev]}).json["duplicates"] == 1
    assert len(c.get(f"/api/calibration/{job}").json["reps"]) == 1


def test_calibration_reps_are_not_written_to_the_event_log():
    c, core, _ = make()
    job = new_job(c)
    c.post(f"/api/calibration/{job}/claim", json={"camera_id": "camA"})
    upload(c, job, "camA", real_reps(2))
    assert core.store.all_events() == []


def test_live_frame_endpoint_and_cancel():
    c, *_ = make()
    job = new_job(c)
    c.post(f"/api/calibration/{job}/claim", json={"camera_id": "camA"})
    frame = {"landmarks": [[0.5, 0.5, 0.9]] * 33, "status": "ok", "angle": 120.5}
    assert c.post(f"/api/calibration/{job}/frame", json={"camera_id": "camA", "frame": frame}).status_code == 200
    assert c.get(f"/api/calibration/{job}").json["frame"]["angle"] == 120.5
    assert c.post(f"/api/calibration/{job}/frame", json={"camera_id": "other", "frame": frame}).status_code == 409
    assert c.post(f"/api/calibration/{job}/frame", json={"camera_id": "camA", "frame": {"landmarks": [[1]]}}).status_code == 400
    assert c.post(f"/api/calibration/{job}/cancel").json["status"] == "cancelled"
    assert c.post(f"/api/calibration/{job}/frame", json={"camera_id": "camA", "frame": frame}).status_code == 409



class Reader(threading.Thread):
    """Reads the server sent event stream in a background thread and collects the events."""

    def __init__(self, url):
        super().__init__(daemon=True)
        self.url, self.events, self.error = url, [], None
        self._r = None

    def run(self):
        """Read events until the connection closes."""
        try:
            self._r = requests.get(self.url, stream=True, timeout=(3, 30))
            event = {}
            for line in self._r.iter_lines(decode_unicode=True):
                if line is None:
                    continue
                if line == "":
                    if event.get("event"):
                        self.events.append(event)
                    event = {}
                elif not line.startswith(":"):
                    k, _, v = line.partition(": ")
                    event[k] = json.loads(v) if k == "data" else v
        except Exception as e:  # the connection is closed deliberately at the end
            self.error = e

    def close(self):
        if self._r is not None:
            self._r.close()

    def wait_for(self, predicate, timeout=6.0):
        """Wait for an event that matches the predicate."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            for e in list(self.events):
                if predicate(e):
                    return e
            time.sleep(0.05)
        raise AssertionError(f"timed out; saw {[ (e['event'], e.get('id')) for e in self.events]}")


def test_sse_delivers_the_snapshot_then_live_changes():
    hub = RunningHub(core=HubCore(exercise_config_path=CONFIG))
    reader = Reader(hub.url + "/api/stream?topics=status")
    reader.start()
    try:
        first = reader.wait_for(lambda e: e["event"] == "status")
        assert first["data"]["participants"] == [] and first["data"]["session"] is None
        requests.put(hub.url + "/api/session", json={"participants": [person()]})
        e = reader.wait_for(lambda e: e["event"] == "status" and e["data"]["participants"])
        assert e["data"]["participants"][0]["board_name"] == "Ana K."
        requests.post(hub.url + "/api/presence", json={"camera_id": "cam1", "people": [{"patient_id": "P-0001"}]})
        e = reader.wait_for(lambda e: e["event"] == "status" and e["data"]["participants"] and e["data"]["participants"][0]["present"])
        assert e["data"]["participants"][0]["light"] == "resting"
    finally:
        reader.close(); hub.stop()


def test_sse_calibration_stream_is_scoped_to_its_job_and_frames_are_throttled():
    hub = RunningHub(core=HubCore(exercise_config_path=CONFIG))
    reader = None
    try:
        job = requests.post(hub.url + "/api/calibration", json={"patient_id": "P-0001", "exercise": "goblet_squat", "camera_id": "camA"}).json()["id"]
        other = requests.post(hub.url + "/api/calibration", json={"patient_id": "P-0002", "exercise": "lunge", "camera_id": "camB"}).json()["id"]
        reader = Reader(f"{hub.url}/api/stream?topics=calibration,skeleton&job={job}")
        reader.start()
        first = reader.wait_for(lambda e: e["event"] == "calibration")
        assert first["data"]["id"] == job
        requests.post(f"{hub.url}/api/calibration/{other}/claim", json={"camera_id": "camB"})  # not our job
        requests.post(f"{hub.url}/api/calibration/{job}/claim", json={"camera_id": "camA"})
        reader.wait_for(lambda e: e["event"] == "calibration" and e["data"]["status"] == "active")
        for i in range(40):  # a camera sending far faster than needed
            requests.post(f"{hub.url}/api/calibration/{job}/frame", json={"camera_id": "camA", "frame": {"landmarks": [[0.5, 0.5, 0.9]] * 33, "n": i}})
        time.sleep(0.2)  # a real camera keeps sending: the next frame is the latest
        requests.post(f"{hub.url}/api/calibration/{job}/frame", json={"camera_id": "camA", "frame": {"landmarks": [[0.5, 0.5, 0.9]] * 33, "n": 99}})
        reader.wait_for(lambda e: e["event"] == "skeleton" and e["data"]["n"] == 99)
        skeleton = [e for e in reader.events if e["event"] == "skeleton"]
        assert 2 <= len(skeleton) < 41, len(skeleton)  # far fewer than the 41 sent
        assert all(e["data"]["job_id"] == job for e in skeleton)
        assert all(e["data"].get("id") != other for e in reader.events if e["event"] == "calibration")
    finally:
        if reader:
            reader.close()
        hub.stop()


def test_sse_rejects_bad_requests():
    c, *_ = make()
    assert c.get("/api/stream?topics=nonsense").status_code == 400
    assert c.get("/api/stream?topics=calibration&job=missing").status_code == 404


def test_stream_requires_the_api_key_when_one_is_set():
    app = create_app(HubCore(exercise_config_path=CONFIG), api_key="k")
    c = app.test_client()
    assert c.get("/api/stream").status_code == 401
    assert c.get("/api/live").status_code == 401
    assert c.get("/api/live", headers={"X-API-Key": "k"}).status_code == 200


if __name__ == "__main__":
    failed = 0
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            try: fn(); print("PASS ", n)
            except AssertionError as e: failed += 1; print("FAIL ", n, e)
            except Exception as e:
                import traceback; traceback.print_exc(); failed += 1; print("ERROR", n, type(e).__name__, e)
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED"); sys.exit(1 if failed else 0)
