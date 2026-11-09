import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from formcheck.paths import EXERCISES_PATH
from formcheck.angle_utils import ANGLE_JOINTS
from formcheck.feature_extractor import FeatureExtractor

LIB = json.load(open(EXERCISES_PATH))
JOINTS = set(ANGLE_JOINTS) | {"spine_lean", "thigh_lean"}
CATS = {"mobility", "squat_lunge", "push", "hinge", "pull", "carry", "core", "stretch", "cardio"}


def test_every_entry_is_well_formed():
    for eid, e in LIB.items():
        assert eid == eid.lower() and " " not in eid, eid
        assert e["category"] in CATS and e["name"], eid
        assert e["tracking"] in ("scored", "count_only", "timed", "manual"), eid
        assert e["position"] in ("standing", "seated", "floor", "wall"), eid
        assert e["default_sets"] >= 1, eid
        if e["tracking"] in ("scored", "count_only"):
            assert e["mode"] == "rep_based" and e["angle_joint"] in JOINTS, eid
            assert "default_reps" in e, eid
        elif e["tracking"] == "timed":
            assert e["mode"] == "hold_duration" and e["angle_joint"] in JOINTS and e["target_duration_sec"] > 0, eid
        else:
            assert e["mode"] == "manual" and "angle_joint" not in e, eid
        if "rest_direction" in e:
            assert e["rest_direction"] in ("high", "low"), eid
        if e["tracking"] == "timed":
            assert e.get("rest_direction") in ("high", "low"), f"{eid}: a hold needs a rest direction"


def test_every_category_from_the_clinic_list_is_covered():
    present = {e["category"] for e in LIB.values()}
    assert present == CATS
    for cat in CATS - {"cardio"}:
        assert sum(e["category"] == cat for e in LIB.values()) >= 2, cat
    assert sum(e["tracking"] == "scored" for e in LIB.values()) >= 30


def test_every_trackable_exercise_builds_a_feature_extractor():
    for eid, e in LIB.items():
        if e["tracking"] != "manual":
            FeatureExtractor(e)  # raises on an unknown joint


def test_previously_existing_ids_are_unchanged():
    for eid in ("goblet_squat", "lunge", "wall_sit", "push_up", "shoulder_press", "romanian_deadlift",
                "glute_bridge", "bent_over_row", "bicep_curl", "plank", "hamstring_stretch", "arm_rainbows"):
        assert eid in LIB


if __name__ == "__main__":
    for n, fn in list(globals().items()):
        if n.startswith("test_"): fn(); print("PASS ", n)
    print("\nALL PASSED")
