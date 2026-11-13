"""Tests for how the segmenter measures timed holds such as a wall sit."""
from formcheck.rep_segmenter import RepSegmenter


def feed(seg, angle_at, seconds, fps=10):
    """Feed simulated samples for a number of seconds, with the angle given by angle_at."""
    for i in range(int(seconds * fps)):
        t = i / fps
        seg.add_sample({"timestamp": t, "primary_angle": angle_at(t), "aux_signal": None, "signals": {}})


def make():
    """A segmenter set up for holds."""
    return RepSegmenter(mode="hold_duration", rest_direction="high")


def test_standing_still_is_not_a_hold():
    seg = make()
    feed(seg, lambda t: 170, 10)
    assert seg.hold_state()[0] is False
    assert seg.check_hold(5)[0] is False


def test_wall_sit_counts_seconds_once_in_position():
    seg = make()
    t0 = []
    def angle(t):
        return 170 if t < 3 else 95 + (1 if int(t * 10) % 2 else -1)
    feed(seg, angle, 15)
    holding, held = seg.hold_state()
    assert holding and 10 < held < 12.5
    assert seg.check_hold(10)[0] is True
    assert seg.check_hold(30)[0] is False


def test_moving_out_of_position_restarts_the_hold():
    seg = make()
    feed(seg, lambda t: 170 if t < 2 else (95 if t < 8 else 170), 10)
    assert seg.hold_state()[0] is False
