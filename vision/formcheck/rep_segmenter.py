"""Splits a stream of joint-angle samples into reps, or tracks how long a position is held. A rep is a move away from the resting angle that reaches a minimum range and comes back."""
from collections import deque

import numpy as np

WINDOW = 8  # samples used to define the resting dwell
PRE_ROLL = 6  # samples kept before the detected onset
POST_ROLL = 3  # samples kept after the return is detected
RETURN_FRAC = 0.25  # back = within 25% of the peak excursion
MAX_BUFFER = 600
KEEP_AFTER_TRIM = 200


def _median3(vals):
    """Median of the last three values, which removes single-frame spikes."""
    last = sorted(vals[-3:])
    return last[len(last) // 2]

# Hold angles are averaged over this window so one noisy frame does not break a hold
HOLD_SMOOTH_SECONDS = 0.8


class RepSegmenter:
    """Detects reps from the primary angle with idle, out and back states. In hold mode it measures how long the angle stays steady while away from the rest position."""
    def __init__(self, mode="rep_based", min_rep_seconds=0.3, min_angle_range_deg=15.0,
                 smoothing_window=3, max_rep_seconds=20.0, rest_direction=None,
                 start_threshold_deg=None, rest_angle=None):
        self.mode = mode
        self.rest_angle = rest_angle
        self.min_rep_seconds = min_rep_seconds
        self.min_rom = float(min_angle_range_deg)
        self.min_angle_range_deg = self.min_rom  # backwards-compatible name
        self.smoothing_window = smoothing_window
        self.max_rep_seconds = max_rep_seconds
        self.fixed_delta = start_threshold_deg
        # 'high' rest means the angle drops moving out
        self._init_orientation = {"high": -1, "low": +1}.get(rest_direction)
        self.reset()

    def reset(self):
        self._buffer = []  # list of {"timestamp","angle","aux","signals"}
        self._base = 0  # absolute index of _buffer[0]
        self._raw_angles = []
        self._smooth_angles = []
        self._raw_aux_history = []
        self._signal_history = {}
        self._noise = 1.5  # EMA of idle jitter (deg, ~1 sigma)
        self._d = self._init_orientation  # +1: outward = angle increases; -1: decreases
        self._state = "idle"
        self._win = deque(maxlen=WINDOW)
        self._pending = []
        self._completed = []
        self.rejected_count = 0  # motions seen but discarded (diagnostics)
        self._hold_win = deque()
        self._run = None  # current steady stretch for holds: [t_start, lo, hi]
        self._rest_ref = self.rest_angle if self._init_orientation is not None else None

    def add_sample(self, feature):
        """Add one frame's feature. The angle is despiked and smoothed first, then passed to the rep state machine or the hold tracker depending on the mode."""
        if feature is None:
            return

        self._raw_angles.append(feature["primary_angle"])
        self._raw_angles = self._raw_angles[-5:]
        despiked = _median3(self._raw_angles)
        self._smooth_angles.append(despiked)
        self._smooth_angles = self._smooth_angles[-self.smoothing_window:]
        smoothed_angle = sum(self._smooth_angles) / len(self._smooth_angles)

        aux_val = feature.get("aux_signal")
        smoothed_aux = None
        if aux_val is not None:
            self._raw_aux_history.append(aux_val)
            self._raw_aux_history = self._raw_aux_history[-self.smoothing_window:]
            smoothed_aux = sum(self._raw_aux_history) / len(self._raw_aux_history)

        smoothed_signals = {}
        for name, val in (feature.get("signals") or {}).items():
            if val is None:
                smoothed_signals[name] = None
                continue
            hist = self._signal_history.setdefault(name, [])
            hist.append(val)
            if len(hist) > self.smoothing_window:
                hist.pop(0)
            smoothed_signals[name] = sum(hist) / len(hist)

        self._buffer.append({
            "timestamp": feature["timestamp"],
            "angle": smoothed_angle,
            "aux": smoothed_aux,
            "signals": smoothed_signals,
        })

        if self.mode == "rep_based":
            self._step(len(self._buffer) - 1)
        else:
            self._buffer = self._buffer[-300:]
            self._track_hold(feature["timestamp"], smoothed_angle)

    @property
    def _delta(self):
        """Movement needed to count as leaving rest. Scales with the measured jitter, within limits, and never exceeds 60% of the minimum range."""
        if self.fixed_delta is not None:
            return float(self.fixed_delta)
        d = min(max(4.0 * self._noise, 6.0), 14.0)
        return min(d, 0.6 * self.min_rom)

    @property
    def _min_rom_eff(self):
        """Minimum range for a rep, raised when the signal is noisy so jitter is not counted as reps."""
        return max(self.min_rom, 8.0 * self._noise)

    def _ang(self, i):
        return self._buffer[i]["angle"]

    def _ts(self, i):
        return self._buffer[i]["timestamp"]

    def _step(self, i):
        self._process_pending()
        a = self._ang(i)
        {"idle": self._step_idle, "out": self._step_out, "back": self._step_back}[self._state](i, a)
        self._maybe_trim()

    def _step_idle(self, i, a):
        """Waiting at rest. Leaves idle when the angle moves a delta away from the recent window, and keeps a running jitter estimate while resting. Until the direction of movement is known, a steady dwell is needed first."""
        win = self._win
        if len(win) >= 6:
            lo, hi = min(win), max(win)
            spread = hi - lo
            delta = self._delta
            up = (a - lo) if self._d in (None, +1) else 0.0
            down = (hi - a) if self._d in (None, -1) else 0.0
            older = list(win)[:-3]  # samples BEFORE any departure drift
            dwelling = len(older) >= 4 and (max(older) - min(older)) <= max(0.8 * delta, 3.5 * self._noise)
            if self._d is None and not dwelling:
                up = down = 0.0  # orientation unknown: need a clear dwell first
            if max(up, down) >= delta:
                d = +1 if up >= down else -1
                self._begin(i, d, lo if d == +1 else hi)
                return
        if len(win) == WINDOW:
            # MAD jitter estimate, ignores outliers
            arr = np.asarray(win, dtype=float)
            sigma = 1.4826 * float(np.median(np.abs(arr - np.median(arr))))
            self._noise = 0.97 * self._noise + 0.03 * min(sigma, 8.0)
        win.append(a)

    def _begin(self, i, d, start_val):
        """Start a rep. Walks back to where the movement actually began and keeps a few extra samples before it."""
        delta = self._delta
        j = i
        while j > 0 and (i - j) < 60 and d * (self._ang(j - 1) - start_val) > 0.25 * delta:
            j -= 1
        self._d_cur = d
        self._start_val = start_val
        self._onset_local = max(j - PRE_ROLL, 0)
        self._onset_abs = self._base + self._onset_local
        self._t_onset = self._ts(j)
        self._peak = max(d * (self._ang(i) - start_val), 0.0)
        self._peak_abs = self._base + i
        self._back_min = None
        self._state = "out"
        self._win.clear()

    def _exc(self, a):
        return self._d_cur * (a - self._start_val)

    def _abort(self, i):
        """Drop a motion that never became a rep and count it for diagnostics."""
        self.rejected_count += 1
        self._reseed(i)
        self._state = "idle"

    def _reseed(self, i):
        self._win.clear()
        for k in range(max(0, i - WINDOW + 1), i + 1):
            self._win.append(self._ang(k))

    def _step_out(self, i, a):
        """Moving away from rest. Tracks the peak, switches to back once the angle has returned by 30% of the peak or a delta, and gives up when the rep takes too long or never gets big enough."""
        delta = self._delta
        exc = self._exc(a)
        if exc > self._peak:
            self._peak = exc
            self._peak_abs = self._base + i
        if self._ts(i) - self._t_onset > self.max_rep_seconds:
            return self._abort(i)
        if self._peak >= self._min_rom_eff:
            if exc <= self._peak - max(0.3 * self._peak, delta):
                self._state = "back"
                self._back_min = exc
        else:
            if exc <= 0.3 * delta or exc <= -delta:
                self._abort(i)  # jitter / too-small motion, never became a rep

    def _step_back(self, i, a):
        """Returning to rest. A rep completes when the angle is back within 25% of the peak, or counts as a partial return if it stalls below 60%. A new push outward continues the same rep."""
        delta = self._delta
        exc = self._exc(a)
        self._back_min = min(self._back_min, exc)
        if self._ts(i) - self._t_onset > self.max_rep_seconds:
            return self._abort(i)
        if exc >= self._back_min + max(0.3 * self._peak, delta):
            self._state = "out"  # bounce / re-descent: still the same rep
            if exc > self._peak:
                self._peak, self._peak_abs = exc, self._base + i
            return
        if exc <= RETURN_FRAC * self._peak:
            return self._complete(i, partial=False)
        if exc <= 0.6 * self._peak and self._stationary(i, 0.5):
            return self._complete(i, partial=True)

    def _stationary(self, i, seconds):
        """True when the angle has stayed within a small band for the given number of seconds."""
        t_now = self._ts(i)
        vals = []
        k = i
        while k >= 0 and t_now - self._ts(k) <= seconds:
            vals.append(self._ang(k))
            k -= 1
        return len(vals) >= 4 and (max(vals) - min(vals)) <= 0.8 * self._delta

    def _complete(self, i, partial):
        """Queue a finished rep. It is emitted a few samples later so the trailing context is included."""
        end_abs = self._base + i
        self._pending.append({
            "onset_abs": self._onset_abs, "end_abs": end_abs, "frames_left": POST_ROLL,
            "t_onset": self._t_onset, "peak": self._peak, "peak_abs": self._peak_abs,
            "start_val": self._start_val, "partial_return": partial,
        })
        if self._d is None:
            self._d = self._d_cur  # lock orientation from the first completed rep
        self._reseed(i)
        self._state = "idle"

    def _process_pending(self):
        if not self._pending:
            return
        for p in self._pending:
            p["frames_left"] -= 1
        ready = [p for p in self._pending if p["frames_left"] <= 0]
        self._pending = [p for p in self._pending if p["frames_left"] > 0]
        for p in ready:
            self._emit(p)

    def _emit(self, p):
        """Cut the rep's samples out of the buffer, and drop it if it was too short."""
        lo = max(p["onset_abs"] - self._base, 0)
        hi = min(p["end_abs"] - self._base + 1 + POST_ROLL, len(self._buffer))
        samples = self._buffer[lo:hi]
        if len(samples) < 5:
            return
        t_end = self._buffer[min(p["end_abs"] - self._base, len(self._buffer) - 1)]["timestamp"]
        if t_end - p["t_onset"] < self.min_rep_seconds:
            self.rejected_count += 1
            return
        peak_idx = min(max(p["peak_abs"] - self._base, 0), len(self._buffer) - 1)
        meta = {
            "t_start": p["t_onset"], "t_end": t_end,
            "t_peak": self._buffer[peak_idx]["timestamp"],
            "rom": p["peak"], "start_value": p["start_val"],
            "peak_value": self._buffer[peak_idx]["angle"],
            "partial_return": p["partial_return"],
        }
        self._completed.append((samples, meta))

    def _maybe_trim(self):
        """Cap the buffer length, but only while idle so a rep in progress is not cut."""
        if self._state == "idle" and not self._pending and len(self._buffer) > MAX_BUFFER:
            drop = len(self._buffer) - KEEP_AFTER_TRIM
            self._buffer = self._buffer[drop:]
            self._base += drop

    @property
    def phase(self):
        return {"idle": "rest", "out": "out", "back": "back"}[self._state]

    def orientation_hint(self, d, force=False):
        """Set which way the angle moves out from rest. Ignored when it is already known, unless forced."""
        if d in (-1, +1) and (force or self._d is None):
            self._d = d

    def extract_completed_reps_with_meta(self, flush_pending=False):
        """Return the reps finished since the last call, each with its samples and metadata. With flush_pending set, a rep that is part-way back is closed as a partial return and waiting reps are released at once."""
        if self.mode != "rep_based":
            return []
        if flush_pending:
            if self._state == "back":
                i = len(self._buffer) - 1
                if self._exc(self._ang(i)) <= 0.6 * self._peak:
                    self._complete(i, partial=True)
            for p in self._pending:
                p["frames_left"] = 0
            ready, self._pending = self._pending, []
            for p in ready:
                self._emit(p)
        out, self._completed = self._completed, []
        return out

    def extract_completed_reps(self, flush_pending=False):
        return [s for s, _ in self.extract_completed_reps_with_meta(flush_pending)]

    def _track_hold(self, t, angle, tolerance_deg=15.0):
        """Update the hold tracker. A hold is a stretch where the smoothed angle stays inside the tolerance band. The rest reference follows the most extreme angle seen in the rest direction."""
        self._hold_win.append((t, angle))
        while self._hold_win and t - self._hold_win[0][0] > HOLD_SMOOTH_SECONDS:
            self._hold_win.popleft()
        angle = sum(a for _, a in self._hold_win) / len(self._hold_win)
        if self._init_orientation is not None:
            high = self._init_orientation < 0  # "high" rest = standing straight
            if self._rest_ref is None or (angle > self._rest_ref if high else angle < self._rest_ref):
                self._rest_ref = angle
        run = self._run
        if run is not None and max(run[2], angle) - min(run[1], angle) <= tolerance_deg:
            run[1], run[2] = min(run[1], angle), max(run[2], angle)
        else:
            self._run = [t, angle, angle]
        self._hold_now = (t, angle)

    def hold_state(self, min_off_rest_deg=25.0, settle_seconds=1.0):
        # (holding, seconds held so far); not holding while still or standing at rest
        if self._run is None or getattr(self, "_hold_now", None) is None:
            return False, 0.0
        t, angle = self._hold_now
        held = t - self._run[0]
        in_position = self._rest_ref is None or abs(angle - self._rest_ref) >= min_off_rest_deg
        if held < settle_seconds or not in_position:
            return False, 0.0
        return True, held

    def check_hold(self, target_duration_sec, tolerance_deg=15):
        """True once the hold has lasted target_duration_sec, along with the seconds held so far. Only used in hold mode."""
        if self.mode != "hold_duration":
            return False, 0.0
        holding, held = self.hold_state()
        return holding and held >= target_duration_sec, held
