import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from werkzeug.serving import make_server

from server.hub import HubCore, create_app
from formcheck.hub_client import HubLink


class RunningHub:
    def __init__(self, port=0, core=None):
        self.core = core or HubCore()
        self.srv = make_server("127.0.0.1", port, create_app(self.core), threaded=True)
        self.port = self.srv.server_port
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.port}"

    def stop(self):
        self.srv.shutdown()


def judgment(t0, t1, score=92.0):
    return {"t_start": t0, "t_end": t1, "score": score, "label": "good_form", "coverage": 1.0,
            "issues": [], "partial_return": False, "rom": 70.0, "rep_index": 1}


def test_clock_sync_corrects_a_skewed_laptop():
    hub = RunningHub()
    try:
        link = HubLink(hub.url, "cam-skew", clock=lambda: time.time() + 7.5)  # clock 7.5 s fast
        off = link.sync_clock()
        assert off is not None and abs(off - (-7.5)) < 0.1, off
        assert abs(link.now() - time.time()) < 0.1
    finally:
        hub.stop()


def test_two_skewed_laptops_still_dedupe_the_same_rep():
    hub = RunningHub()
    try:
        a = HubLink(hub.url, "camA", clock=lambda: time.time() + 4.0)
        b = HubLink(hub.url, "camB", clock=lambda: time.time() - 3.0)
        a.sync_clock(); b.sync_clock()
        t = time.time()
        for i in range(5):
            # each laptop reports the rep in ITS OWN (wrong) local time
            a.send_rep(judgment(t - 30 + 3 * i + 4.0, t - 28 + 3 * i + 4.0), "p1", 1, "squat")
            b.send_rep(judgment(t - 29.9 + 3 * i - 3.0, t - 27.9 + 3 * i - 3.0), "p1", 1, "squat")
        assert a.flush() and b.flush()
        s = hub.core.patient_summary("p1")["exercises"]["squat"]
        assert s["total_reps"] == 5 and s["total_sets"] == 1
    finally:
        hub.stop()


def test_events_buffer_while_hub_is_down_and_arrive_once_after():
    hub = RunningHub()
    port = hub.port
    core = hub.core
    link = HubLink(hub.url, "cam1", timeout=0.5)
    link.sync_clock()
    hub.stop()
    time.sleep(0.2)
    t = time.time()
    for i in range(3):
        link.send_rep(judgment(t + 3 * i, t + 3 * i + 2), "p1", 1, "squat")
    assert link.flush() is False and link.pending() == 3 and link.online is False
    hub2 = RunningHub(port=port, core=core)  # hub comes back
    try:
        assert link.flush() is True and link.pending() == 0
        assert link.flush() is True  # nothing left; no double send
        assert core.patient_summary("p1")["exercises"]["squat"]["total_reps"] == 3
    finally:
        hub2.stop()


def test_retry_after_lost_response_does_not_double_count():
    hub = RunningHub()
    try:
        link = HubLink(hub.url, "cam1")
        t = time.time()
        link.send_rep(judgment(t, t + 2), "p1", 1, "squat")
        batch = list(link._buf)
        # simulate: hub processed the batch but the response was lost -> client resends it
        link._session.post(f"{hub.url}/api/events", json={"camera_id": "cam1", "events": batch})
        assert link.flush()
        assert hub.core.patient_summary("p1")["exercises"]["squat"]["total_reps"] == 1
    finally:
        hub.stop()


def test_background_thread_delivers_and_polls_assignments():
    hub = RunningHub()
    try:
        link = HubLink(hub.url, "cam1", flush_interval=0.1, poll_interval=0.2).start()
        hub.core.store.set_assignment("p1", "lunge")
        t = time.time()
        link.send_rep(judgment(t, t + 2), "p1", 1, "lunge")
        deadline = time.time() + 3
        while time.time() < deadline and (link.pending() or link.assigned_exercise("p1") is None):
            time.sleep(0.05)
        assert link.pending() == 0
        assert link.assigned_exercise("p1") == "lunge"
        assert link.assigned_exercise("nobody", "default") == "default"
        link.close()
    finally:
        hub.stop()


def test_template_push_fetch():
    hub = RunningHub()
    try:
        link = HubLink(hub.url, "cam1")
        assert link.fetch_template("p1", "squat") is None
        tpl = {"version": 2, "calibration_reps": [{"samples": [{"timestamp": 0.0, "angle": 170.0}]}]}
        assert link.push_template("p1", "squat", tpl) is True
        assert link.fetch_template("p1", "squat") == tpl
    finally:
        hub.stop()


def test_unreachable_hub_never_raises():
    link = HubLink("http://127.0.0.1:9", "cam1", timeout=0.2)
    assert link.sync_clock(2) is None
    link.poll_state()
    assert link.fetch_template("p", "e") is None and link.push_template("p", "e", {"a": 1}) is False
    link.send_bind(1, "p1")
    assert link.flush() is False


def test_bind_event_reaches_hub():
    hub = RunningHub()
    try:
        link = HubLink(hub.url, "camB")
        t = time.time()
        for i in range(3):
            link.send_rep(judgment(t + 3 * i, t + 3 * i + 2), None, 5, "squat")
        link.flush()
        assert len(hub.core.unassigned()) == 3
        link.send_bind(5, "p4")
        link.flush()
        assert hub.core.unassigned() == []
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
                failed += 1; print(f"ERROR {name}: {type(e).__name__}: {e}")
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED")
    sys.exit(1 if failed else 0)
