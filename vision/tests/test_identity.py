import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from formcheck.identity import PersonTracker, TagDetector

SHAPE = (480, 640, 3)
H, W = SHAPE[:2]


class LM:
    def __init__(self, x=0.0, y=0.0, v=0.99):
        self.x, self.y, self.visibility = x, y, v


def make_pose(cx, cy, scale=0.16, shoulder_w=0.8, thigh=1.0, shank=1.0, vis=0.99):
    lm = [LM(0, 0, 0.0) for _ in range(33)]
    tl = scale * H
    def put(i, x, y, v=vis): lm[i] = LM(x / W, y / H, v)
    put(0, cx, cy - tl * 0.9)
    put(11, cx - shoulder_w * tl / 2, cy - tl / 2); put(12, cx + shoulder_w * tl / 2, cy - tl / 2)
    put(13, cx - shoulder_w * tl / 2 - 10, cy); put(14, cx + shoulder_w * tl / 2 + 10, cy)
    put(15, cx - shoulder_w * tl / 2 - 10, cy + tl / 2); put(16, cx + shoulder_w * tl / 2 + 10, cy + tl / 2)
    put(23, cx - 0.2 * tl, cy + tl / 2); put(24, cx + 0.2 * tl, cy + tl / 2)
    put(25, cx - 0.2 * tl, cy + tl / 2 + thigh * tl); put(26, cx + 0.2 * tl, cy + tl / 2 + thigh * tl)
    put(27, cx - 0.2 * tl, cy + tl / 2 + (thigh + shank) * tl); put(28, cx + 0.2 * tl, cy + tl / 2 + (thigh + shank) * tl)
    return lm


def tag_at(patient, x, y):
    return {"tag_id": patient, "patient_id": f"p{patient:03d}", "center": (x, y), "size": 40}


def test_tag_detector_reads_a_real_apriltag():
    img = np.full((480, 640, 3), 255, np.uint8)
    tag = TagDetector.make_tag_image(7, 160)
    tag3 = np.dstack([tag] * 3)
    img[100:100 + tag3.shape[0], 300:300 + tag3.shape[1]] = tag3
    found = TagDetector().detect(img)
    assert [t["tag_id"] for t in found] == [7], found
    cx, cy = found[0]["center"]
    assert abs(cx - (300 + tag3.shape[1] / 2)) < 6 and abs(cy - (100 + tag3.shape[0] / 2)) < 6


def test_tag_detector_finds_two_tags():
    img = np.full((480, 640, 3), 255, np.uint8)
    for tid, x in ((3, 40), (12, 380)):
        t = np.dstack([TagDetector.make_tag_image(tid, 120)] * 3)
        img[40:40 + t.shape[0], x:x + t.shape[1]] = t
    assert sorted(t["tag_id"] for t in TagDetector().detect(img)) == [3, 12]


def test_tracker_keeps_ids_stable_for_two_people():
    tr = PersonTracker()
    ids = {}
    for k in range(60):
        now = k * 0.05
        poses = [make_pose(150 + 2 * k, 250), make_pose(480 - 2 * k, 250)]
        people = tr.update(poses, SHAPE, now=now)
        assert len(people) == 2
        for p in people:
            side = "L" if p["centroid"][0] < 320 else "R"
            ids.setdefault(side, set()).add(p["track_id"])
    # people never cross here -> exactly one id per person
    assert all(len(v) == 1 for v in ids.values()), ids


def test_tag_binds_patient_and_binding_survives_when_tag_is_covered():
    tr = PersonTracker()
    for k in range(20):  # tag visible on the left person
        now = k * 0.05
        people = tr.update([make_pose(150, 250), make_pose(480, 250)], SHAPE,
                           tags=[tag_at(1, 150, 235)], now=now)
    left = [p for p in people if p["centroid"][0] < 320][0]
    assert left["patient_id"] == "p001" and left["id_source"] == "tag"
    for k in range(20, 100):  # tag now covered; people move a bit
        now = k * 0.05
        people = tr.update([make_pose(150 + (k - 20), 250), make_pose(480, 250)], SHAPE, now=now)
    left = [p for p in people if p["centroid"][0] < 320][0]
    right = [p for p in people if p["centroid"][0] >= 320][0]
    assert left["patient_id"] == "p001" and left["id_source"] == "continuity"
    assert right["patient_id"] is None


def test_two_people_crossing_paths_keep_their_identities():
    tr = PersonTracker()
    for k in range(10):
        tr.update([make_pose(100 + 3 * k, 250), make_pose(540 - 3 * k, 250, shoulder_w=1.1)], SHAPE,
                  tags=[tag_at(1, 100 + 3 * k, 235), tag_at(2, 540 - 3 * k, 235)], now=k * 0.05)
    for k in range(10, 100):  # no tags: they walk through each other
        now = k * 0.05
        a = make_pose(100 + 3 * k, 250 + 10 * np.sin(k / 6))
        b = make_pose(540 - 3 * k, 250 - 10 * np.sin(k / 6), shoulder_w=1.1)
        people = tr.update([a, b], SHAPE, now=now)
    by = {p["patient_id"]: p for p in people}
    assert by["p001"]["centroid"][0] > 320 and by["p002"]["centroid"][0] < 320, \
        {k: v["centroid"] for k, v in by.items()}


def test_wrong_guess_is_corrected_when_the_tag_reappears():
    tr = PersonTracker()
    for k in range(10):
        tr.update([make_pose(150, 250), make_pose(480, 250)], SHAPE,
                  tags=[tag_at(1, 150, 235), tag_at(2, 480, 235)], now=k * 0.05)
    # force a swap, then show tags again at the true positions
    for t in tr.tracks:
        t.patient_id = "p002" if t.centroid[0] < 320 else "p001"
    people = tr.update([make_pose(150, 250), make_pose(480, 250)], SHAPE,
                       tags=[tag_at(1, 150, 235), tag_at(2, 480, 235)], now=1.0)
    by = {p["patient_id"]: p for p in people}
    assert by["p001"]["centroid"][0] < 320 and by["p002"]["centroid"][0] > 320


def test_reid_after_leaving_and_returning_without_tag():
    tr = PersonTracker(max_missing_sec=1.0)
    for k in range(20):
        tr.update([make_pose(300, 250)], SHAPE, tags=[tag_at(5, 300, 235)], now=k * 0.05)
    for k in range(20, 80):  # person disappears for ~3 s
        tr.update([], SHAPE, now=k * 0.05)
    people = tr.update([make_pose(320, 255)], SHAPE, now=4.2)
    assert len(people) == 1
    assert people[0]["patient_id"] == "p005" and people[0]["id_source"] == "reid"


def test_reid_does_not_guess_when_ambiguous():
    tr = PersonTracker(max_missing_sec=1.0)
    for k in range(20):
        tr.update([make_pose(200, 250), make_pose(440, 250)], SHAPE,
                  tags=[tag_at(1, 200, 235), tag_at(2, 440, 235)], now=k * 0.05)
    for k in range(20, 60):
        tr.update([], SHAPE, now=k * 0.05)
    # someone reappears exactly between the two lost people
    people = tr.update([make_pose(320, 250)], SHAPE, now=3.2)
    assert people[0]["patient_id"] is None


def test_unknown_person_stays_unknown():
    tr = PersonTracker()
    for k in range(30):
        people = tr.update([make_pose(300, 250)], SHAPE, now=k * 0.05)
    assert people[0]["patient_id"] is None and people[0]["id_source"] == "unknown"


def test_tag_far_from_everyone_is_ignored():
    tr = PersonTracker()
    people = tr.update([make_pose(150, 250)], SHAPE, tags=[tag_at(9, 600, 60)], now=0.0)
    assert people[0]["patient_id"] is None


def test_ambiguous_tag_between_two_people_waits():
    tr = PersonTracker()
    people = tr.update([make_pose(260, 250), make_pose(380, 250)], SHAPE,
                       tags=[tag_at(9, 320, 150)], now=0.0)
    assert all(p["patient_id"] is None for p in people)


def test_bind_events_are_reported_once():
    tr = PersonTracker()
    for k in range(5):
        tr.update([make_pose(300, 250)], SHAPE, tags=[tag_at(3, 300, 235)], now=k * 0.05)
    ev = tr.pop_events()
    assert len(ev) == 1 and ev[0]["patient_id"] == "p003"
    assert tr.pop_events() == []


def test_pose_with_hidden_torso_is_ignored_not_crashed():
    lm = [LM(0.5, 0.5, 0.05) for _ in range(33)]
    assert PersonTracker().update([lm], SHAPE, now=0.0) == []


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print(f"PASS  {name}")
            except AssertionError as e:
                failed += 1; print(f"FAIL  {name}: {e}")
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED")
    sys.exit(1 if failed else 0)
