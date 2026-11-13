"""End to end calibration through a real hub and camera pipeline. A camera picks up a job, uploads reps and uses the template afterwards."""
import os, random, sys, tempfile, time
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import requests
from client import CameraPipeline, load_exercise_configs
from server.hub import HubCore, default_exercise_config_path
from test_hub_client import RunningHub
from formcheck import simulation as sim
from formcheck.hub_client import HubLink
from formcheck.template_manager import TemplateManager

CFG_PATH = default_exercise_config_path()


def sync(link):
    """Push the link's pending state to the hub and read the hub's state back."""
    link.poll_state()
    link._flush_latest()
    link.flush()


def make_camera(hub, camera_id="camA", exercise="goblet_squat"):
    """A camera link and pipeline that talk to the given hub."""
    link = HubLink(hub.url, camera_id, log=lambda *_: None)
    link.sync_clock(1)
    pipeline = CameraPipeline(load_exercise_configs(CFG_PATH), TemplateManager(tempfile.mkdtemp()), link,
                              default_exercise=exercise)
    return link, pipeline


def create_job(hub, camera="camA", patient="P-0001", exercise="goblet_squat", **kw):
    """Ask the hub to start a calibration job and return its id."""
    r = requests.post(hub.url + "/api/calibration", json=dict(
        {"patient_id": patient, "exercise": exercise, "camera_id": camera}, **kw))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def activate(link, pipeline, hub, job):
    """Step the pipeline until the camera has claimed the job."""
    lm = sim.make_landmarks(175, 175, 8, 0.0)
    sync(link)
    pipeline.step([lm], [], sim.FRAME_SHAPE, time.time())
    for _ in range(40):  # the claim is sent off-thread
        time.sleep(0.05)
        sync(link)
        status = requests.get(f"{hub.url}/api/calibration/{job}").json()["status"]
        if status == "active":
            return
    raise AssertionError("camera never claimed the job")


def play(link, pipeline, frames, base=0.0):
    """Play frames through the pipeline and sync with the hub along the way."""
    for i, (ts, lm) in enumerate(frames):
        pipeline.step([lm], [], sim.FRAME_SHAPE, base + ts)
        if i % 5 == 0:
            sync(link)
    sync(link)


def job_state(hub, job):
    """The hub's view of a job."""
    return requests.get(f"{hub.url}/api/calibration/{job}").json()


def test_a_camera_picks_up_a_job_and_uploads_every_rep():
    hub = RunningHub(core=HubCore(exercise_config_path=CFG_PATH))
    try:
        link, pipeline = make_camera(hub)
        job = create_job(hub)
        activate(link, pipeline, hub, job)
        rng = random.Random(4)
        base = time.time()
        play(link, pipeline, sim.frames([sim.good_spec(rng) for _ in range(5)], seed=4), base)
        s = job_state(hub, job)
        assert len(s["reps"]) == 5 and s["pending"] == 5 and s["camera_id"] == "camA"
        assert s["frame"]["status"] == "ok" and len(s["frame"]["landmarks"]) == 33  # live skeleton arrived
        rep = requests.get(f"{hub.url}/api/calibration/{job}/reps/1").json()
        assert rep["frames"] and rep["samples"] and rep["rom"] > 30
        assert hub.core.fusion.canonical_reps() == []  # calibration reps are not exercise reps
        assert hub.core.store.all_events() == []
    finally:
        hub.stop()


def test_keep_discard_finish_stores_a_template_the_camera_can_then_use():
    hub = RunningHub(core=HubCore(exercise_config_path=CFG_PATH))
    try:
        link, pipeline = make_camera(hub)
        job = create_job(hub)
        activate(link, pipeline, hub, job)
        rng = random.Random(5)
        play(link, pipeline, sim.frames([sim.good_spec(rng) for _ in range(6)], seed=5), time.time())
        for i in (1, 2, 4, 5, 6):
            assert requests.post(f"{hub.url}/api/calibration/{job}/reps/{i}/decision", json={"decision": "keep"}).status_code == 200
        requests.post(f"{hub.url}/api/calibration/{job}/reps/3/decision", json={"decision": "discard"})
        done = requests.post(f"{hub.url}/api/calibration/{job}/finish").json()
        assert done["slot"] == "goblet_squat@camA" and done["kept"] == 5
        # camera finds that template for this patient
        sync(link)
        template = pipeline._template_for("P-0001", "goblet_squat", time.time())
        assert template is not None and len(template["calibration_reps"]) == 5
        assert link.calibration_jobs() == []  # job no longer offered
    finally:
        hub.stop()


def test_a_job_open_to_any_camera_is_claimed_by_exactly_one():
    hub = RunningHub(core=HubCore(exercise_config_path=CFG_PATH))
    try:
        link_a, pipe_a = make_camera(hub, "camA")
        link_b, pipe_b = make_camera(hub, "camB")
        job = create_job(hub, camera=None)
        lm = sim.make_landmarks(175, 175, 8, 0.0)
        for link, pipe in ((link_a, pipe_a), (link_b, pipe_b)):
            sync(link)
            pipe.step([lm], [], sim.FRAME_SHAPE, time.time())
        time.sleep(0.4)
        owner = job_state(hub, job)["camera_id"]
        assert owner in ("camA", "camB")
        for link in (link_a, link_b):
            sync(link)
        assert [j["camera_id"] for j in link_a.calibration_jobs()] == [owner] or link_a.calibration_jobs() == []
        assert job_state(hub, job)["status"] == "active"
    finally:
        hub.stop()


def test_the_calibrated_person_is_not_scored_as_normal_reps_meanwhile():
    hub = RunningHub(core=HubCore(exercise_config_path=CFG_PATH))
    try:
        link, pipeline = make_camera(hub)
        job = create_job(hub)
        activate(link, pipeline, hub, job)
        sent = []
        pipeline.on_rep = lambda *a: sent.append(a)
        rng = random.Random(6)
        play(link, pipeline, sim.frames([sim.good_spec(rng) for _ in range(3)], seed=6), time.time())
        assert sent == [] and len(job_state(hub, job)["reps"]) == 3
    finally:
        hub.stop()


def test_cancelling_stops_the_camera_working_on_it():
    hub = RunningHub(core=HubCore(exercise_config_path=CFG_PATH))
    try:
        link, pipeline = make_camera(hub)
        job = create_job(hub)
        activate(link, pipeline, hub, job)
        requests.post(f"{hub.url}/api/calibration/{job}/cancel")
        sync(link)
        pipeline.step([sim.make_landmarks(175, 175, 8, 0.0)], [], sim.FRAME_SHAPE, time.time())
        assert pipeline._calibrations == {} and link.calibration_jobs() == []
    finally:
        hub.stop()


def test_presence_heartbeats_reach_the_hub_and_make_the_person_visible():
    hub = RunningHub(core=HubCore(exercise_config_path=CFG_PATH))
    try:
        link, pipeline = make_camera(hub)
        requests.put(hub.url + "/api/session", json={"participants": [{
            "patient_id": "P-0001", "board_name": "Ana K.",
            "plan": [{"exercise_id": "goblet_squat", "name": "Goblet squats", "tracking": "scored", "sets": 2, "reps": 5}]}]})
        lm = sim.make_landmarks(175, 175, 8, 0.0)
        tag = {"tag_id": 3, "center": sim.chest_px(lm), "size": 40}
        requests.put(hub.url + "/api/tags/3", json={"patient_id": "P-0001", "display_name": "Ana K."})
        sync(link)  # the camera learns tag 3 = P-0001
        pipeline.step([lm], [tag], sim.FRAME_SHAPE, time.time())
        sync(link)
        p = requests.get(hub.url + "/api/live").json()["participants"][0]
        assert p["present"] is True and p["cameras"] == ["camA"]
    finally:
        hub.stop()


if __name__ == "__main__":
    failed = 0
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            try: fn(); print("PASS ", n)
            except AssertionError as e: failed += 1; print("FAIL ", n, e)
            except Exception as e:
                import traceback; traceback.print_exc(); failed += 1; print("ERROR", n, type(e).__name__, e)
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED"); sys.exit(1 if failed else 0)
