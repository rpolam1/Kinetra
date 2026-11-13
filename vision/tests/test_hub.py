"""Tests for the hub's HTTP API and its in-memory state, using Flask's test client."""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server.hub import HubCore, create_app


def rep(eid, t0, t1, patient="p1", track="A-1", score=90.0, ex="goblet_squat"):
    """A rep event as a camera sends it."""
    return {"type": "rep", "event_id": eid, "patient_id": patient, "track_key": track,
            "exercise": ex, "t_start": t0, "t_end": t1, "score": score,
            "label": "good_form", "coverage": 1.0, "issues": []}


def client(core=None, key=None):
    """A test client and the hub core behind it."""
    app = create_app(core or HubCore(), api_key=key)
    return app.test_client(), app.config["core"]


def post(c, cam, events, headers=None):
    """Post events to the hub as one camera."""
    return c.post("/api/events", json={"camera_id": cam, "events": events}, headers=headers or {})


def test_health_and_time():
    c, _ = client()
    h = c.get("/api/health")
    assert h.json["ok"] is True and h.json["service"] == "exercise-hub" and h.json["started_at"] > 0
    assert h.headers["X-Hub"] == "exercise-hub"
    assert abs(c.get("/api/time").json["t"] - time.time()) < 2


def test_two_cameras_one_set_counted_once():
    c, _ = client()
    now = time.time()
    for i in range(6):
        post(c, "cam1", [rep(f"a{i}", now - 60 + 3 * i, now - 58 + 3 * i)])
        post(c, "cam2", [rep(f"b{i}", now - 59.8 + 3 * i, now - 57.9 + 3 * i, track="B-4")])
    s = c.get("/api/patients/p1/summary").json["exercises"]["goblet_squat"]
    assert s["total_reps"] == 6 and s["total_sets"] == 1
    assert all(r["n_cameras"] == 2 for r in s["reps"])


def test_retried_events_are_idempotent():
    c, core = client()
    ev = [rep("x1", 10, 12)]
    assert post(c, "cam1", ev).json == {"accepted": 1, "duplicates": 0}
    assert post(c, "cam1", ev).json == {"accepted": 0, "duplicates": 1}
    assert len(core.fusion.canonical_reps()) == 1


def test_state_survives_restart(tmp=None):
    path = os.path.join(tempfile.mkdtemp(), "hub.db")
    c, core = client(HubCore(path))
    now = time.time()
    for i in range(4):
        post(c, "cam1", [rep(f"a{i}", now - 30 + 3 * i, now - 28 + 3 * i)])
        post(c, "cam2", [rep(f"b{i}", now - 29.9 + 3 * i, now - 27.9 + 3 * i, patient=None, track="B-2")])
    post(c, "cam2", [{"type": "bind", "event_id": "bind1", "track_key": "B-2", "patient_id": "p1"}])
    before = c.get("/api/patients/p1/summary").json
    core.store.close()
    c2, _ = client(HubCore(path))  # "restart"
    after = c2.get("/api/patients/p1/summary").json
    assert before["exercises"]["goblet_squat"]["total_reps"] == 4
    assert after["exercises"]["goblet_squat"]["total_reps"] == 4


def test_anonymous_camera_gets_identified_by_other_camera_and_later_bind():
    c, _ = client()
    now = time.time()
    for i in range(5):
        post(c, "cam1", [rep(f"a{i}", now - 40 + 3 * i, now - 38 + 3 * i, patient="p7")])
        post(c, "cam2", [rep(f"b{i}", now - 39.9 + 3 * i, now - 37.8 + 3 * i, patient=None, track="B-9")])
    assert c.get("/api/unassigned").json == []
    s = c.get("/api/patients/p7/summary").json["exercises"]["goblet_squat"]
    assert s["total_reps"] == 5


def test_unassigned_then_bound():
    c, _ = client()
    now = time.time()
    post(c, "cam2", [rep(f"b{i}", now - 20 + 3 * i, now - 18 + 3 * i, patient=None, track="B-1") for i in range(3)])
    assert len(c.get("/api/unassigned").json) == 3
    post(c, "cam2", [{"type": "bind", "event_id": "bd", "track_key": "B-1", "patient_id": "p3"}])
    assert c.get("/api/unassigned").json == []
    assert c.get("/api/patients/p3/summary").json["exercises"]["goblet_squat"]["total_reps"] == 3


def test_current_set_is_reported_while_ongoing():
    c, _ = client()
    now = time.time()
    post(c, "cam1", [rep("a1", now - 8, now - 6), rep("a2", now - 5, now - 3)])
    s = c.get("/api/patients/p1/summary").json["exercises"]["goblet_squat"]
    assert s["current_set"] is not None and s["current_set"]["reps"] == 2


def test_assignment_and_state():
    c, _ = client()
    assert c.post("/api/assign", json={"patient_id": "p1", "exercise": "lunge"}).json == {"ok": True}
    st = c.get("/api/state").json
    assert st["assignments"]["p1"]["exercise"] == "lunge" and st["set_gap_seconds"] > 0
    assert c.post("/api/assign", json={"patient_id": "p1"}).status_code == 400


def test_template_roundtrip():
    c, _ = client()
    assert c.get("/api/templates/p1/goblet_squat").status_code == 404
    tpl = {"version": 2, "calibration_reps": [{"samples": [{"timestamp": 0, "angle": 170}]}]}
    assert c.put("/api/templates/p1/goblet_squat", json=tpl).json == {"ok": True}
    assert c.get("/api/templates/p1/goblet_squat").json == tpl
    assert c.put("/api/templates/p1/goblet_squat", json={"bad": 1}).status_code == 400


def test_bad_payloads_are_rejected_not_crashed():
    c, _ = client()
    assert c.post("/api/events", json={"events": []}).status_code == 400
    assert c.post("/api/events", data="garbage").status_code == 400
    r = post(c, "cam1", [{"type": "rep", "event_id": "z", "t_start": 5, "t_end": 4, "exercise": "x"}])
    assert r.json["accepted"] == 0  # invalid rep ignored


def test_api_key_enforced_when_configured():
    c, _ = client(key="secret")
    assert c.get("/api/state").status_code == 401
    assert c.get("/api/state", headers={"X-API-Key": "secret"}).status_code == 200
    assert c.get("/api/health").status_code == 200  # open, so discovery can recognise the hub


def test_patient_listing():
    c, _ = client()
    post(c, "cam1", [rep("a", 10, 12, patient="p1"), rep("b", 30, 32, patient="p2")])
    assert {p["patient_id"] for p in c.get("/api/patients").json} == {"p1", "p2"}


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"PASS  {name}")
            except AssertionError as e:
                failed += 1; print(f"FAIL  {name}: {e}")
            except Exception as e:
                failed += 1; print(f"ERROR {name}: {type(e).__name__}: {e}")
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED")
    sys.exit(1 if failed else 0)
