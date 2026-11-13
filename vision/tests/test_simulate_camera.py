"""Runs the simulated camera tool against a hub in a separate process and checks what the hub sees."""
import os, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import requests
from server.hub import HubCore, default_exercise_config_path
from test_hub_client import RunningHub

ROOT = os.path.join(os.path.dirname(__file__), "..")


def run_tool(hub, *extra, duration=16):
    """Run the tool for a number of seconds and return the finished process."""
    return subprocess.run([sys.executable, "tools/simulate_camera.py", "--hub", hub.url, "--duration", str(duration), *extra],
                          cwd=ROOT, capture_output=True, text=True, timeout=duration + 30)


def test_people_are_identified_by_their_tag_and_their_reps_counted():
    hub = RunningHub(core=HubCore(exercise_config_path=default_exercise_config_path()))
    try:
        requests.put(hub.url + "/api/tags/4", json={"patient_id": "P-0001", "display_name": "Ana K."})
        requests.put(hub.url + "/api/tags/9", json={"patient_id": "P-0002", "display_name": "Bo L."})
        plan = [{"exercise_id": "goblet_squat", "name": "Goblet squats", "tracking": "scored", "sets": 2, "reps": 3}]
        requests.put(hub.url + "/api/session", json={"participants": [
            {"patient_id": "P-0001", "board_name": "Ana K.", "plan": plan},
            {"patient_id": "P-0002", "board_name": "Bo L.", "plan": plan}]})
        out = run_tool(hub, "--camera-id", "sim-a", "--patients", "P-0001,P-0002")
        assert out.returncode == 0, out.stderr[-500:]
        live = requests.get(hub.url + "/api/live").json()
        reps = {p["patient_id"]: p["progress"]["reps_done"] for p in live["participants"]}
        assert all(n >= 2 for n in reps.values()), reps
        assert "sim-a" in [c["id"] for c in live["cameras"]]
    finally:
        hub.stop()


def test_a_person_without_a_tag_stays_unidentified_and_a_bad_script_is_rejected():
    hub = RunningHub(core=HubCore(exercise_config_path=default_exercise_config_path()))
    try:
        out = run_tool(hub, "--camera-id", "sim-b", "--no-tag", duration=5)
        assert out.returncode == 0
        live = requests.get(hub.url + "/api/live").json()
        assert live["unidentified"] and live["unidentified"][0]["camera_id"] == "sim-b"
        tool = os.path.abspath(os.path.join(ROOT, "tools", "simulate_camera.py"))
        # An empty working directory has no cached hub address to fall back on.
        empty = tempfile.mkdtemp()
        bad = subprocess.run([sys.executable, tool, "--script", "nonsense"], cwd=empty, capture_output=True, text=True)
        assert bad.returncode != 0 and "unknown rep kind" in (bad.stderr + bad.stdout)
        nohub = subprocess.run([sys.executable, tool, "--hub", "http://127.0.0.1:9", "--duration", "1"],
                               cwd=empty, capture_output=True, text=True, timeout=90,
                               env={**os.environ, "HUB_URL": ""})
        assert nohub.returncode != 0 and "No hub found" in (nohub.stderr + nohub.stdout)
    finally:
        hub.stop()


if __name__ == "__main__":
    failed = 0
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            try: fn(); print("PASS ", n)
            except AssertionError as e: failed += 1; print("FAIL ", n, e)
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED"); sys.exit(1 if failed else 0)
