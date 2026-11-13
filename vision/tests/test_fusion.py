"""Tests for merging reps seen by several cameras and for grouping reps into sets."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server.fusion import RepFusion, compute_sets


def obs(cam, t0, t1, patient="p1", track=None, score=90.0, cov=1.0, ex="squat", issues=None):
    """One rep observation from a camera."""
    return {"event_id": f"{cam}-{t0}", "camera_id": cam, "track_key": track or f"{cam}-1",
            "patient_id": patient, "exercise": ex, "t_start": t0, "t_end": t1,
            "score": score, "label": None, "coverage": cov, "issues": issues or [],
            "partial_return": False}


def n_reps(f, patient="__any__"):
    """Number of combined reps."""
    return len(f.canonical_reps(patient))


def test_same_rep_seen_by_two_cameras_counts_once():
    f = RepFusion()
    f.add_rep(obs("A", 10.0, 12.0))
    f.add_rep(obs("B", 10.2, 12.3))
    assert n_reps(f) == 1
    assert f.canonical_reps()[0]["cameras"] == {"A", "B"}


def test_three_cameras_one_rep():
    f = RepFusion()
    for cam, d in (("A", 0.0), ("B", 0.2), ("C", -0.15)):
        f.add_rep(obs(cam, 10 + d, 12 + d))
    assert n_reps(f) == 1 and len(f.canonical_reps()[0]["cameras"]) == 3


def test_a_full_set_seen_by_two_cameras_is_one_set_of_n():
    f = RepFusion()
    for i in range(8):
        f.add_rep(obs("A", 10 + 3 * i, 12 + 3 * i))
        f.add_rep(obs("B", 10.25 + 3 * i, 12.2 + 3 * i))
    reps = f.canonical_reps("p1")
    sets = compute_sets(reps, 20)
    assert len(reps) == 8 and len(sets) == 1 and sets[0]["reps"] == 8


def test_consecutive_reps_from_one_camera_are_not_merged():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12))
    f.add_rep(obs("A", 12.2, 14.2))
    assert n_reps(f) == 2


def test_reps_at_different_times_from_different_cameras_stay_separate():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12))
    f.add_rep(obs("B", 20, 22))
    assert n_reps(f) == 2


def test_two_different_patients_at_the_same_time_are_not_merged():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12, patient="p1"))
    f.add_rep(obs("B", 10, 12, patient="p2"))
    assert n_reps(f, "p1") == 1 and n_reps(f, "p2") == 1


def test_anonymous_view_is_attached_to_the_person_another_camera_identified():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12, patient="p1"))
    f.add_rep(obs("B", 10.1, 12.1, patient=None))  # B's tag was covered
    assert n_reps(f) == 1
    assert n_reps(f, None) == 0 and n_reps(f, "p1") == 1


def test_anonymous_observation_arriving_first_still_merges():
    f = RepFusion()
    f.add_rep(obs("B", 10.1, 12.1, patient=None))
    f.add_rep(obs("A", 10, 12, patient="p1"))
    assert n_reps(f) == 1 and f.canonical_reps()[0]["patient_id"] == "p1"


def test_anonymous_observation_is_not_guessed_between_two_known_people():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12, patient="p1"))
    f.add_rep(obs("C", 10, 12, patient="p2"))
    f.add_rep(obs("B", 10.05, 12.05, patient=None))
    assert n_reps(f, None) == 1  # stays unassigned
    assert n_reps(f, "p1") == 1 and n_reps(f, "p2") == 1


def test_late_tag_binding_reassigns_and_dedupes_earlier_reps():
    f = RepFusion()
    for i in range(5):  # A knows p1 the whole time
        f.add_rep(obs("A", 10 + 3 * i, 12 + 3 * i, patient="p1"))
    for i in range(5):  # B can't see the tag at first
        f.add_rep(obs("B", 10.2 + 3 * i, 12.2 + 3 * i, patient=None, track="B-7"))
    # (they already merged with A's reps by time overlap) -> still 5
    assert n_reps(f, "p1") == 5 and n_reps(f) == 5
    f.bind("B-7", "p1")
    assert n_reps(f) == 5


def test_late_binding_alone_assigns_without_other_camera():
    f = RepFusion()
    for i in range(4):
        f.add_rep(obs("B", 10 + 3 * i, 12 + 3 * i, patient=None, track="B-3"))
    assert n_reps(f, None) == 4
    f.bind("B-3", "p9")
    assert n_reps(f, "p9") == 4 and n_reps(f, None) == 0


def test_future_reps_of_a_bound_track_are_attributed_automatically():
    f = RepFusion()
    f.bind("B-3", "p9")
    f.add_rep(obs("B", 10, 12, patient=None, track="B-3"))
    assert n_reps(f, "p9") == 1


def test_score_is_coverage_weighted():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12, score=90, cov=0.9))
    f.add_rep(obs("B", 10, 12, score=40, cov=0.1))
    s = f.canonical_reps()[0]["score"]
    assert 80 < s < 90, s


def test_missing_score_from_one_camera_does_not_break_merge():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12, score=None))
    f.add_rep(obs("B", 10, 12, score=70))
    assert f.canonical_reps()[0]["score"] == 70


def test_different_exercises_do_not_merge():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12, ex="squat"))
    f.add_rep(obs("B", 10, 12, ex="lunge"))
    assert n_reps(f) == 2


def test_sets_split_on_rest_gap():
    f = RepFusion()
    for i in range(5):
        f.add_rep(obs("A", 10 + 3 * i, 12 + 3 * i))
    for i in range(4):
        f.add_rep(obs("A", 80 + 3 * i, 82 + 3 * i))
    sets = compute_sets(f.canonical_reps("p1"), 20)
    assert [s["reps"] for s in sets] == [5, 4]


def test_out_of_order_arrival_gives_same_result():
    import random
    all_obs = []
    for i in range(6):
        all_obs.append(obs("A", 10 + 3 * i, 12 + 3 * i))
        all_obs.append(obs("B", 10.2 + 3 * i, 12.1 + 3 * i))
        all_obs.append(obs("C", 9.9 + 3 * i, 11.9 + 3 * i))
    for seed in range(10):
        random.Random(seed).shuffle(all_obs)
        f = RepFusion()
        for o in all_obs:
            f.add_rep(o)
        assert n_reps(f) == 6, (seed, n_reps(f))


def test_identity_is_inferred_from_repeated_agreement_with_another_camera():
    f = RepFusion()
    for i in range(3):  # B anonymous, A identifies p1
        f.add_rep(obs("A", 10 + 3 * i, 12 + 3 * i, patient="p1"))
        f.add_rep(obs("B", 10.1 + 3 * i, 12.1 + 3 * i, patient=None, track="B-5"))
    assert "B-5" in f.inferred
    # A can no longer see the person; B's reps are still attributed to p1
    for i in range(3, 6):
        f.add_rep(obs("B", 10.1 + 3 * i, 12.1 + 3 * i, patient=None, track="B-5"))
    assert n_reps(f, "p1") == 6 and n_reps(f, None) == 0


def test_identity_not_inferred_from_a_single_or_contradictory_match():
    f = RepFusion()
    f.add_rep(obs("A", 10, 12, patient="p1"))
    f.add_rep(obs("B", 10, 12, patient=None, track="B-5"))
    assert "B-5" not in f.inferred  # one match is not enough
    f.add_rep(obs("B", 20, 22, patient=None, track="B-5"))
    assert n_reps(f, None) == 1  # so the lone later rep stays unassigned
    g = RepFusion()
    for i, p in enumerate(["p1", "p2", "p1", "p2"]):  # track matches different people
        g.add_rep(obs("A", 10 + 3 * i, 12 + 3 * i, patient=p))
        g.add_rep(obs("B", 10 + 3 * i, 12 + 3 * i, patient=None, track="B-6"))
    assert "B-6" not in g.inferred


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


def test_merged_rep_averages_range_of_motion_by_coverage():
    f = RepFusion()
    f.add_rep({**obs("A", 10.0, 12.0, cov=1.0), "rom": 80.0})
    f.add_rep({**obs("B", 10.1, 12.1, cov=0.5), "rom": 50.0})
    assert f.canonical_reps()[0]["rom"] == 70.0


def test_rep_without_range_of_motion_reports_none():
    f = RepFusion()
    f.add_rep(obs("A", 10.0, 12.0))
    assert f.canonical_reps()[0]["rom"] is None
