"""Tests for the status light rules, presence tracking and the event bus."""
import json, os, sys, threading, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server.live import LiveBus, PresenceTracker, compute_light, REST_AFTER, PRESENCE_TIMEOUT


def light(**kw):
    """The light name for a person who is present and recently scored well, with any changes passed in."""
    base = dict(present=True, now=100.0, last_rep_at=99.0, recent_scores=[95, 92, 90])
    base.update(kw)
    return compute_light(**base)[0]


def test_light_rules():
    assert light(present=False) == "not_detected"
    assert light(last_rep_at=None) == "resting"
    assert light(last_rep_at=100 - REST_AFTER - 1) == "resting"
    assert light() == "on_track"
    assert light(recent_scores=[95, 70, 72]) == "drifting"  # average below 80
    assert light(recent_scores=[95, 95, 40]) == "drifting"  # one flagged rep
    assert light(recent_scores=[45, 95, 40]) == "needs_help"  # two flagged reps
    assert light(recent_scores=[30, 40, 45]) == "needs_help"  # average below 50
    assert light(recent_scores=[None, None]) == "on_track"  # count-only exercises
    assert light(recent_scores=[10, 10, 95, 95, 95]) == "on_track"  # only the last 3 count


def test_light_reasons_are_readable():
    assert "Good form" in compute_light(True, 100, 99, [95])[1]
    assert "no form score" in compute_light(True, 100, 99, [None])[1]


def test_presence_tracks_identified_and_anonymous_people():
    p = PresenceTracker()
    p.update("cam1", [{"patient_id": "P-1", "track_key": "a", "id_source": "tag"},
                      {"patient_id": None, "track_key": "b"}], now=10.0)
    p.update("cam2", [{"patient_id": "P-1", "track_key": "c", "id_source": "reid"}], now=11.0)
    seen = p.patients(now=12.0)
    assert seen["P-1"]["cameras"] == ["cam1", "cam2"] and seen["P-1"]["last_seen"] == 11.0
    assert p.anonymous(now=12.0) == [{"camera_id": "cam1", "track_key": "b", "last_seen": 10.0}]
    assert set(p.cameras(now=12.0)) == {"cam1", "cam2"}


def test_presence_expires():
    p = PresenceTracker()
    p.update("cam1", [{"patient_id": "P-1"}], now=10.0)
    assert "P-1" in p.patients(now=10 + PRESENCE_TIMEOUT)
    assert p.patients(now=10 + PRESENCE_TIMEOUT + 0.1) == {}
    assert p.anonymous(now=100) == [] and p.cameras(now=100) == {}


def _take(gen, n):
    """The first n real events from a stream, skipping comment lines."""
    out = []
    for chunk in gen:
        if not chunk.startswith(":"):
            out.append(chunk)
        if len(out) >= n:
            break
    return out


def test_stream_sends_initial_snapshot_then_new_events():
    bus = LiveBus()
    gen = bus.stream({"status"}, initial=[("status", {"n": 0})], heartbeat=0.2)
    assert next(gen).startswith(": connected")
    first = next(gen)
    assert "event: status" in first and '"n":0' in first
    threading.Timer(0.1, lambda: bus.publish("status", {"n": 1})).start()
    nxt = _take(gen, 1)[0]
    assert '"n":1' in nxt and "id: 1" in nxt


def test_stream_filters_by_topic_and_key_and_skips_to_latest():
    bus = LiveBus()
    gen = bus.stream({"calibration"}, key="job1", heartbeat=0.2)
    next(gen)
    bus.publish("status", {"ignored": True})
    bus.publish("calibration", {"v": 1}, key="job2")  # another job
    bus.publish("calibration", {"v": 2}, key="job1")
    bus.publish("calibration", {"v": 3}, key="job1")  # supersedes v2 for a slow reader
    got = _take(gen, 1)
    assert len(got) == 1 and '"v":3' in got[0]


def test_unkeyed_events_reach_keyed_subscribers():
    bus = LiveBus()
    gen = bus.stream({"status", "calibration"}, key="job1", heartbeat=0.2)
    next(gen)
    bus.publish("status", {"s": 1})
    assert "event: status" in _take(gen, 1)[0]


def test_idle_stream_sends_keepalives_and_stops_on_request():
    bus = LiveBus()
    stop = threading.Event()
    gen = bus.stream({"status"}, heartbeat=0.05, stop=stop)
    chunks = [next(gen) for _ in range(3)]
    assert chunks[0].startswith(": connected") and chunks[1].startswith(": keep-alive")
    stop.set()
    assert list(gen) == [] or all(c.startswith(":") for c in gen)


def test_ring_buffer_is_bounded():
    bus = LiveBus(history=10)
    for i in range(500):
        bus.publish("status", {"i": i})
    assert len(bus._events) == 10 and bus.seq == 500


def test_event_payload_is_valid_json():
    bus = LiveBus()
    gen = bus.stream({"status"}, initial=[("status", {"a": [1, 2], "b": "x"})])
    next(gen)
    data = next(gen).split("data: ", 1)[1].strip()
    assert json.loads(data) == {"a": [1, 2], "b": "x"}


if __name__ == "__main__":
    failed = 0
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            try: fn(); print("PASS ", n)
            except AssertionError as e: failed += 1; print("FAIL ", n, e)
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED"); sys.exit(1 if failed else 0)


def test_holding_counts_as_active_not_resting():
    light, reason = compute_light(True, 100, None, [], holding=True, hold_seconds=12)
    assert light == "on_track" and "12s" in reason
    assert compute_light(True, 100, None, [])[0] == "resting"
