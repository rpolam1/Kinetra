"""Tests for session validation, progress, advancing and saving to the store."""
import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server.session import SessionError, SessionManager, exercise_progress, normalize_participants
from server.store import Store


def item(eid="goblet_squat", **kw):
    """A plan item. Keyword arguments override its fields."""
    return dict({"exercise_id": eid, "name": eid, "tracking": "scored", "sets": 2, "reps": 5}, **kw)


def person(pid="P-1", plan=None, name="Ana K."):
    """A participant with a two exercise plan."""
    return {"patient_id": pid, "board_name": name, "plan": plan or [item(), item("push_up")]}


def raises(code, fn, *a, **k):
    """Check that the call raises a SessionError with the given code."""
    try:
        fn(*a, **k)
    except SessionError as e:
        assert e.code == code, (e.code, e.message); return
    raise AssertionError(f"expected SessionError({code})")


_ids = iter(range(1, 10_000))


def rep(t0, t1, score=90.0):
    """A combined rep with a unique id."""
    return {"id": next(_ids), "t_start": t0, "t_end": t1, "score": score, "label": "good_form"}


def test_validation():
    raises("invalid", normalize_participants, [])
    raises("invalid", normalize_participants, "x")
    raises("invalid", normalize_participants, [person(), person()])  # duplicate patient
    raises("invalid", normalize_participants, [dict(person(), board_name="")])
    raises("invalid", normalize_participants, [dict(person(), plan=[])])
    raises("invalid", normalize_participants, [dict(person(), plan=[item(sets=0)])])
    raises("invalid", normalize_participants, [dict(person(), plan=[item(tracking="magic")])])
    raises("invalid", normalize_participants, [dict(person(), plan=[item(reps=0)])])
    raises("invalid", normalize_participants, [dict(person(), plan=[{"name": "no id"}])])
    clean = normalize_participants([person(plan=[{"exercise_id": "plank", "tracking": "timed", "seconds": 30}])])
    assert clean[0]["plan"][0]["name"] == "plank" and clean[0]["plan"][0]["sets"] == 1


def test_start_end_lifecycle():
    now = [100.0]
    m = SessionManager(clock=lambda: now[0])
    assert not m.active and m.state() is None
    s = m.start([person("P-1"), person("P-2", name="Bo L.")])
    assert m.active and s["order"] == ["P-1", "P-2"] and m.current_item("P-2")["exercise_id"] == "goblet_squat"
    raises("conflict", m.start, [person()])  # one session at a time
    now[0] = 200.0
    m.end()
    assert not m.active and m.state()["ended_at"] == 200.0
    raises("conflict", m.end)
    raises("conflict", m.advance, "P-1")
    m.start([person("P-3")])  # a new one can follow
    assert m.order() == ["P-3"]


def test_advance_through_the_plan():
    now = [0.0]
    m = SessionManager(clock=lambda: now[0])
    m.start([person()])
    now[0] = 50.0
    p = m.advance("P-1")
    assert p["index"] == 1 and p["exercise_started_at"] == 50.0 and p["done"][0]["exercise_id"] == "goblet_squat"
    assert m.current_item("P-1")["exercise_id"] == "push_up"
    p = m.advance("P-1")
    assert p["finished"] and m.current_item("P-1") is None and len(p["done"]) == 2
    raises("conflict", m.advance, "P-1")  # nothing left
    raises("not_found", m.advance, "P-9")


def test_jump_back_and_forward():
    m = SessionManager()
    m.start([person(plan=[item("a"), item("b"), item("c")])])
    m.advance("P-1"); m.advance("P-1"); m.advance("P-1")
    assert m.participant("P-1")["finished"]
    m.advance("P-1", to_index=0)
    p = m.participant("P-1")
    assert p["index"] == 0 and not p["finished"]
    raises("invalid", m.advance, "P-1", 5)
    raises("invalid", m.advance, "P-1", -1)


def test_done_is_not_duplicated_when_revisiting():
    m = SessionManager()
    m.start([person(plan=[item("a"), item("b")])])
    m.advance("P-1"); m.advance("P-1", to_index=0); m.advance("P-1")
    assert [d["index"] for d in m.participant("P-1")["done"]] == [0]


def test_auto_advance_flag():
    m = SessionManager()
    m.start([person()])
    assert m.state()["auto_advance"] is False
    m.set_auto_advance(True)
    assert m.state()["auto_advance"] is True


def test_progress_counts_sets_and_reps():
    it = item(sets=2, reps=5)
    assert exercise_progress(it, [], 20, now=100)["reps_done"] == 0
    first = [rep(i * 3, i * 3 + 2) for i in range(5)]  # a full set of 5
    p = exercise_progress(it, first, 20, now=16)
    assert (p["sets_done"], p["reps_done"], p["target_met"], p["current_set_reps"]) == (1, 5, False, 0)
    mid = first + [rep(60 + i * 3, 62 + i * 3) for i in range(3)]  # 3 reps into set two
    p = exercise_progress(it, mid, 20, now=70)
    assert (p["sets_done"], p["set_number"], p["current_set_reps"], p["target_met"]) == (1, 2, 3, False)
    full = first + [rep(60 + i * 3, 62 + i * 3) for i in range(5)]
    p = exercise_progress(it, full, 20, now=80)
    assert (p["sets_done"], p["target_met"], p["reps_done"]) == (2, True, 10)


def test_progress_while_resting_between_sets():
    it = item(sets=2, reps=5)
    first = [rep(i * 3, i * 3 + 2) for i in range(5)]
    p = exercise_progress(it, first, 20, now=200)  # long after the set ended
    assert (p["sets_done"], p["set_number"], p["current_set_reps"]) == (1, 2, 0)


def test_progress_for_exercises_without_a_rep_target():
    it = {"exercise_id": "plank", "tracking": "timed", "sets": 2, "reps": None, "seconds": 30}
    p = exercise_progress(it, [], 20, now=0)
    assert p["target_reps"] is None and p["target_met"] is False


def test_persistence_across_a_restart():
    path = os.path.join(tempfile.mkdtemp(), "hub.db")
    store = Store(path)
    m = SessionManager(store)
    m.start([person(), person("P-2", name="Bo L.")], auto_advance=True)
    m.advance("P-1")
    store.close()
    m2 = SessionManager(Store(path))
    assert m2.active and m2.order() == ["P-1", "P-2"]
    assert m2.participant("P-1")["index"] == 1 and m2.state()["auto_advance"] is True


if __name__ == "__main__":
    failed = 0
    for n, fn in list(globals().items()):
        if n.startswith("test_"):
            try: fn(); print("PASS ", n)
            except AssertionError as e: failed += 1; print("FAIL ", n, e)
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED"); sys.exit(1 if failed else 0)
