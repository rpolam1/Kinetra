import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from formcheck.rep_segmenter import RepSegmenter

FPS = 20


def stream(reps, rest=175.0, noise=2.5, seed=0, lead=1.0, tail=1.0, spikes=0, fps=FPS,
           start_mid=False):
    rng = random.Random(seed)
    vals = []

    def hold(sec, v):
        vals.extend([v] * max(int(sec * fps), 0))

    def move(a, b, sec):
        n = max(int(sec * fps), 2)
        vals.extend(a + (b - a) * (0.5 - 0.5 * math.cos(math.pi * k / n)) for k in range(1, n + 1))

    if not start_mid:
        hold(lead, rest)
    cur = rest
    for i, r in enumerate(reps):
        peak, dur = r["peak"], r["dur"]
        move(cur, peak, dur / 2)
        hold(r.get("hold", 0), peak)
        if r.get("bounce"):
            move(peak, peak + (rest - peak) * 0.35, dur * 0.12)
            move(peak + (rest - peak) * 0.35, peak, dur * 0.12)
        back_to = r.get("partial", rest)
        move(peak, back_to, dur / 2)
        cur = back_to
        hold(r.get("pause_after", 0.5), cur)
    hold(tail, cur)
    out = []
    for i, v in enumerate(vals):
        n = rng.gauss(0, noise)
        if spikes and rng.random() < spikes:
            n += rng.choice([-1, 1]) * rng.uniform(40, 70)
        out.append({"timestamp": i / fps, "primary_angle": v + n, "signals": {}})
    return out


def run(feats, **kw):
    seg = RepSegmenter(**kw)
    emitted = []
    for f in feats:
        seg.add_sample(f)
        emitted.extend(seg.extract_completed_reps_with_meta())
    return seg, emitted


def reps_of(peak, n, dur=2.0, pause=0.6, **kw):
    return [dict(peak=peak, dur=dur, pause_after=pause, **kw) for _ in range(n)]


def test_squat_counts_all_reps_without_flush():
    _, out = run(stream(reps_of(90, 10)))
    assert len(out) == 10, len(out)


def test_rep_emitted_promptly_after_return():
    feats = stream(reps_of(90, 1, pause=2.0), tail=2.0)
    seg = RepSegmenter()
    t_done = None
    for f in feats:
        seg.add_sample(f)
        if seg.extract_completed_reps_with_meta():
            t_done = f["timestamp"]
            break
    assert t_done is not None
    # motion = 1.0 + 2.0 s; rep must be reported within ~0.6 s of getting back to rest
    assert t_done <= 1.0 + 2.0 + 0.6, t_done


def test_rest_at_low_angle_raise_exercise():
    _, out = run(stream(reps_of(150, 8), rest=30.0))
    assert len(out) == 8, len(out)


def test_continuous_reps_without_pause():
    _, out = run(stream(reps_of(60, 8, dur=1.6, pause=0.0), rest=170.0))
    assert len(out) == 8, len(out)


def test_jitter_while_standing_makes_no_reps():
    seg, out = run(stream([], noise=4.0, lead=40.0, tail=0.0))
    assert len(out) == 0
    seg2, out2 = run(stream([], noise=3.0, lead=40.0, tail=0.0), rest_direction="high")
    assert len(out2) == 0


def test_heavy_noise_still_counts_reps():
    _, out = run(stream(reps_of(95, 8), noise=4.0, seed=3))
    assert len(out) == 8, len(out)


def test_shallow_reps_are_still_detected_for_the_scorer_to_judge():
    reps = reps_of(90, 3) + reps_of(150, 3) + reps_of(90, 3)  # ROM 85 / 25 / 85
    _, out = run(stream(reps))
    assert len(out) == 9, len(out)
    roms = sorted(round(m["rom"]) for _, m in out)
    assert roms[0] < 40 and roms[-1] > 70


def test_tiny_motion_is_ignored():
    _, out = run(stream(reps_of(167, 6)))  # ROM 8 deg
    assert len(out) == 0, len(out)


def test_slow_and_fast_reps():
    _, slow = run(stream(reps_of(90, 4, dur=6.0)))
    assert len(slow) == 4, len(slow)
    _, fast = run(stream(reps_of(90, 6, dur=0.9, pause=0.4)))
    assert len(fast) == 6, len(fast)


def test_single_frame_tracking_glitches_do_not_create_or_break_reps():
    _, out = run(stream(reps_of(90, 8), spikes=0.02, seed=5))
    assert len(out) == 8, len(out)
    _, idle = run(stream([], spikes=0.03, lead=30.0, tail=0.0, seed=6))
    assert len(idle) == 0, len(idle)


def test_bounce_at_bottom_is_one_rep():
    _, out = run(stream(reps_of(90, 5, bounce=True)))
    assert len(out) == 5, len(out)


def test_pause_at_bottom_is_one_rep():
    _, out = run(stream(reps_of(90, 5, hold=2.0)))
    assert len(out) == 5, len(out)


def test_incomplete_return_is_flagged_partial():
    feats = stream([dict(peak=90, dur=2.0, partial=140, pause_after=2.5)], tail=1.0)
    _, out = run(feats)
    assert len(out) == 1, len(out)
    assert out[0][1]["partial_return"] is True


def test_starting_mid_motion_with_known_orientation():
    feats = stream(reps_of(90, 6), start_mid=True)
    _, out = run(feats, rest_direction="high")
    assert len(out) >= 5, len(out)


def test_orientation_is_learned_without_config():
    _, out = run(stream(reps_of(120, 6), rest=40.0))  # rest low, peak high
    assert len(out) == 6, len(out)


def test_rep_times_and_rom_metadata():
    _, out = run(stream(reps_of(90, 3, dur=2.0, pause=1.0)))
    for samples, m in out:
        assert 1.5 <= m["t_end"] - m["t_start"] <= 3.0
        assert 70 <= m["rom"] <= 95
        assert m["t_start"] < m["t_peak"] < m["t_end"]


def test_long_idle_then_reps_survives_buffer_trimming():
    feats = stream(reps_of(90, 4), lead=60.0)  # 1200 idle frames first
    _, out = run(feats)
    assert len(out) == 4, len(out)


def test_two_sets_with_rest_between():
    reps = reps_of(90, 5) + [dict(peak=90, dur=2.0, pause_after=25.0)] + reps_of(90, 5)
    _, out = run(stream(reps))
    assert len(out) == 11, len(out)


def test_flush_recovers_a_rep_cut_off_at_the_end():
    feats = stream(reps_of(90, 3, pause=0.0), tail=0.0)
    seg = RepSegmenter()
    n = 0
    for f in feats:
        seg.add_sample(f)
        n += len(seg.extract_completed_reps_with_meta())
    n += len(seg.extract_completed_reps_with_meta(flush_pending=True))
    assert n == 3, n


def test_random_fuzz_counts_are_correct():
    rng = random.Random(123)
    bad = []
    for trial in range(40):
        n = rng.randint(3, 10)
        rest_high = rng.random() < 0.5
        rest = 175.0 if rest_high else 25.0
        rom = rng.uniform(45, 110)
        peak = rest - rom if rest_high else rest + rom
        reps = [dict(peak=peak + rng.uniform(-8, 8), dur=rng.uniform(0.9, 4.0),
                     pause_after=rng.choice([0.0, 0.3, 1.0, 3.0]),
                     bounce=rng.random() < 0.15) for _ in range(n)]
        _, out = run(stream(reps, noise=rng.uniform(1.0, 4.0), seed=trial,
                            spikes=rng.choice([0, 0, 0.01])))
        if len(out) != n:
            bad.append((trial, n, len(out)))
    print("\nfuzz mismatches:", bad)
    assert len(bad) <= 2, bad


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS  {name}")
            except AssertionError as e:
                failed += 1
                print(f"FAIL  {name}: {e}")
    print("\nALL PASSED" if not failed else f"\n{failed} FAILED")
    sys.exit(1 if failed else 0)
