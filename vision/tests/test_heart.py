import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server import heart
from server.hub import HubCore, create_app
from test_hub_live import CONFIG, make, person, rep, start

ZONE = {"resting": 60, "max": 180, "low": 108, "high": 132}


def zone_person(pid="P-0001", name="Ana K.", zone=ZONE, **kw):
    return {**person(pid, name, **kw), "heart_zone": zone}


def post(c, pid, samples, **kw):
    return c.post("/api/vitals", json={"patient_id": pid, "samples": samples, **kw})


def test_zone_status_covers_each_band_and_the_high_alert():
    z = heart.normalize_zone(ZONE)
    assert [heart.classify(b, z) for b in (90, 108, 120, 132, 133, 155, 162, 175)] == [
        "below", "in_zone", "in_zone", "in_zone", "above", "above", "high", "high"]
    assert heart.classify(100, None) == "no_target"
    assert heart.classify(150, heart.normalize_zone({**ZONE, "reliable": False})) == "unreliable"


def test_bad_zones_are_rejected():
    for bad in ({"resting": 60, "max": 180, "low": 140, "high": 130}, {"resting": 60, "max": 120, "low": 100, "high": 130},
                {"resting": 60, "max": 180, "low": 100}, "x"):
        try:
            heart.normalize_zone(bad)
        except heart.HeartError:
            continue
        raise AssertionError(f"accepted {bad}")


def test_samples_are_validated_against_range_and_clock():
    now = 1000.0
    assert heart.parse_samples([{"t": 999.0, "bpm": 100}, {"t": 990.0, "bpm": 99}], now)[0]["t"] == 990.0
    for bad in ([], "x", [{"t": 999, "bpm": 10}], [{"t": 999, "bpm": 300}], [{"t": 1e9, "bpm": 100}],
                [{"t": 9000, "bpm": 100}], [{"t": 999}], [{"t": 999, "bpm": True}], [{"t": 999, "bpm": float("nan")}]):
        try:
            heart.parse_samples(bad, now)
        except heart.HeartError:
            continue
        raise AssertionError(f"accepted {bad}")


def test_posting_heart_rate_returns_the_status_for_the_watch():
    c, core, now = make()
    start(c, [zone_person()])
    r = post(c, "P-0001", [{"t": now[0] - 1, "bpm": 120}])
    assert r.status_code == 200 and r.json["accepted"] == 1
    assert r.json["status"]["status"] == "in_zone" and r.json["status"]["bpm"] == 120
    assert post(c, "P-0001", [{"t": now[0], "bpm": 150}]).json["status"]["status"] == "above"


def test_without_a_session_the_status_has_no_target():
    c, core, now = make()
    r = post(c, "P-0001", [{"t": now[0], "bpm": 100}])
    assert r.json["status"]["status"] == "no_target" and r.json["status"]["zone"] is None


def test_live_board_shows_heart_rate_and_flags_a_very_high_rate():
    c, core, now = make()
    start(c, [zone_person()])
    post(c, "P-0001", [{"t": now[0], "bpm": 125}])
    p = c.get("/api/live").json["participants"][0]
    assert p["heart_rate"]["bpm"] == 125 and p["heart_rate"]["status"] == "in_zone"
    post(c, "P-0001", [{"t": now[0] + 0.5, "bpm": 168}])
    now[0] += 1
    p = c.get("/api/live").json["participants"][0]
    assert p["light"] == "needs_help" and "168" in p["reason"] and p["heart_rate"]["status"] == "high"


def test_a_stale_reading_becomes_no_signal_and_does_not_alert():
    c, core, now = make()
    start(c, [zone_person()])
    post(c, "P-0001", [{"t": now[0], "bpm": 170}])
    now[0] += heart.STALE_SECONDS + 5
    p = c.get("/api/live").json["participants"][0]
    assert p["heart_rate"]["status"] == "no_signal" and p["light"] != "needs_help"


def test_a_participant_with_no_watch_has_no_signal():
    c, core, now = make()
    start(c, [zone_person()])
    assert c.get("/api/live").json["participants"][0]["heart_rate"]["status"] == "no_signal"


def test_a_session_with_a_bad_zone_is_refused():
    c, core, now = make()
    r = c.put("/api/session", json={"participants": [zone_person(zone={"resting": 60, "max": 180, "low": 140, "high": 130})]})
    assert r.status_code == 400


def test_bad_posts_are_refused():
    c, core, now = make()
    assert c.post("/api/vitals", json={"samples": [{"t": now[0], "bpm": 100}]}).status_code == 400
    assert post(c, "P-0001", [{"t": now[0], "bpm": 5}]).status_code == 400
    assert c.post("/api/vitals", data="nope").status_code == 400


def test_session_summary_has_time_in_zone_and_per_exercise_heart_rate():
    c, core, now = make()
    start(c, [zone_person()])
    t0 = now[0]
    c.post("/api/events", json={"camera_id": "cam1", "events": [rep(t0 + 10), rep(t0 + 14)]})
    samples = [{"t": t0 + i, "bpm": b} for i, b in enumerate([90] * 5 + [120] * 10 + [145] * 5, start=1)]
    post_time = now[0]
    now[0] = t0 + 30
    assert post(c, "P-0001", samples).status_code == 200
    now[0] = post_time + 30
    s = c.post("/api/session/end").json["summary"]["participants"][0]
    h = s["heart"]
    assert h["samples"] == 20 and h["min_bpm"] == 90 and h["max_bpm"] == 145
    assert h["seconds_in_zone"] == 10 and h["seconds_below"] == 5 and h["seconds_above"] == 5
    assert h["zone"] == {"low": 108, "high": 132, "max": 180, "resting": 60}
    ex = s["exercises"][0]
    assert ex["avg_hr"] == 124 and ex["peak_hr"] == 145


def test_heart_data_survives_a_hub_restart():
    path = os.path.join(tempfile.mkdtemp(), "hub.db")
    c, core, now = make(db=path)
    post(c, "P-0001", [{"t": now[0] - 2, "bpm": 111}, {"t": now[0] - 1, "bpm": 113}])
    core.close()
    core2 = HubCore(path, exercise_config_path=CONFIG, clock=lambda: now[0])
    assert core2.heart.latest("P-0001")["bpm"] == 113
    assert len(core2.heart.between("P-0001", 0)) == 2
    core2.close()


def test_roster_lists_registered_tags_with_session_people_first():
    c, core, now = make()
    c.put("/api/tags/9", json={"patient_id": "P-0002", "display_name": "Ben"})
    c.put("/api/tags/4", json={"patient_id": "P-0001", "display_name": "Ana K."})
    start(c, [zone_person("P-0002", "Ben")])
    post(c, "P-0002", [{"t": now[0], "bpm": 100}])
    r = c.get("/api/watch/roster").json
    assert r["session_active"] and [p["tag_id"] for p in r["people"]] == [9, 4]
    assert r["people"][0]["in_session"] and r["people"][0]["watch_connected"]
    assert not r["people"][1]["in_session"] and not r["people"][1]["watch_connected"]


def test_the_api_key_protects_the_vitals_routes():
    core = HubCore(":memory:", exercise_config_path=CONFIG)
    c = create_app(core, api_key="secret").test_client()
    body = {"patient_id": "P", "samples": [{"t": 1, "bpm": 100}]}
    assert c.post("/api/vitals", json=body).status_code == 401
    assert c.get("/api/watch/roster").status_code == 401
    assert c.get("/api/watch/roster", headers={"X-API-Key": "secret"}).status_code == 200
