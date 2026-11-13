"""Scores a rep against a patient's calibration. Calibration reps give a mean and a spread for each metric, and a new rep is scored by how far each metric sits from its mean in units of the allowed tolerance."""
import math
from collections import defaultdict

import numpy as np

from formcheck.feature_extractor import PRIMARY_PREFIX

N_CURVE_POINTS = 50
MIN_SIGNAL_COVERAGE = 0.6  # signal must show up in this share of a rep's frames
ACTIVE_FRACTION = 0.25  # moving = more than 25% of ROM from rest
ACTIVE_PAD_FRAMES = 4  # frames of lead-in/out kept around the active window
# Tolerance is this many standard deviations of the calibration reps, clamped between the floor and ceiling in the specs
STD_MULTIPLIER = 2.5
CAP_START = 85.0  # score cap when an important metric is just out of band
CAP_SLOPE = 40.0  # drop per tolerance-width past the band
CAP_SEVERE = 45.0  # floor of the cap (reached at dev = 2)
SHAPE_WARP_BAND = 0.30  # timing shift the shape check allows
MIN_COVERAGE = 0.5  # below this share of checks -> insufficient_data
IMPORTANT_WEIGHT = 2.0

# (floor, ceiling, abs|rel, side), rel = fraction of calibration mean
STAT_SPECS = {
    ("angle", "pose"): (10.0, 20.0, "abs", "both"),  # min / at_peak, degrees
    ("angle", "rom"): (12.0, 28.0, "abs", "both"),
    ("disp", "rom"): (0.06, 0.25, "abs", "both"),  # hip travel, torso-lengths
    ("dev", "pose"): (0.04, 0.12, "abs", "both"),  # knee tracking, leg-lengths
    ("dev", "rom"): (0.05, 0.15, "abs", "both"),
}
SYM_SPEC = (8.0, 18.0, "abs", "high")  # only a LARGER L/R gap is bad
SHAPE_SPECS = {
    "angle": (5.0, 12.0, "abs", "high"),
    "disp": (0.04, 0.12, "abs", "high"),
    "dev": (0.03, 0.10, "abs", "high"),
}
TIMING_SPECS = {
    "duration": (0.25, 0.60, "rel", "low"),  # only FASTER than calibration is bad
    "descent_frac": (0.12, 0.25, "abs", "both"),
    "peak_speed": (0.40, 0.90, "rel", "high"),  # only FASTER than calibration is bad
}

SIGNAL_LABELS = {
    "knee_l": "left knee angle", "knee_r": "right knee angle",
    "hinge_l": "left hip angle", "hinge_r": "right hip angle",
    "elbow_l": "left elbow angle", "elbow_r": "right elbow angle",
    "shoulder_l": "left shoulder angle", "shoulder_r": "right shoulder angle",
    "thigh_l": "left thigh angle", "thigh_r": "right thigh angle",
    "torso_lean": "torso lean", "hip_y": "hip travel",
    "knee_dev_l": "left knee tracking", "knee_dev_r": "right knee tracking",
    "sym_gap": "left/right difference",
}
STAT_LABELS = {"min": "minimum", "max": "maximum", "rom": "range",
               "at_peak": "at the deepest point", "shape": "movement pattern"}


def _class_of(signal):
    if signal == "hip_y":
        return "disp"
    if signal.startswith("knee_dev"):
        return "dev"
    return "angle"


def _stats_for(signal):
    if signal == "hip_y":
        return ["rom"]
    if signal.startswith("knee_dev"):
        return ["at_peak", "rom"]
    if signal == "sym_gap":
        return ["at_peak"]  # gap at the deepest point (sides agree best there)
    if signal == "torso_lean":
        return ["max", "at_peak", "rom"]
    return ["min", "rom", "at_peak"]  # "max" ~ standing pose: noisy, adds little


def _active_window(angles):
    """Trim a rep to the part where the joint is actually moving, plus a small pad. Falls back to the whole rep when the motion is too small to find."""
    a = np.asarray(angles, dtype=float)
    n = len(a)
    rom = a.max() - a.min()
    if n < 5 or rom <= 0:
        return 0, n - 1
    k = min(3, n)
    base_start, base_end = np.median(a[:k]), np.median(a[-k:])
    thr = ACTIVE_FRACTION * rom
    moving_start = np.where(np.abs(a - base_start) >= thr)[0]
    moving_end = np.where(np.abs(a - base_end) >= thr)[0]
    if len(moving_start) == 0 or len(moving_end) == 0:
        return 0, n - 1
    start, end = int(moving_start[0]), int(moving_end[-1])
    # extend out to the real rest pose so slow reps aren't measured short
    near = max(0.05 * rom, 2.0)
    while start > 0 and abs(a[start - 1] - base_start) > near:
        start -= 1
    while end < n - 1 and abs(a[end + 1] - base_end) > near:
        end += 1
    start = max(start - ACTIVE_PAD_FRAMES, 0)
    end = min(end + ACTIVE_PAD_FRAMES, n - 1)
    return (start, end) if end - start >= 4 else (0, n - 1)


def _rmse(a, b):
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))


def _shape_distance(a, b, band_frac=SHAPE_WARP_BAND):
    """Banded dynamic time warping distance between two curves, so a rep that is a little faster or slower than the template is not penalised for timing alone."""
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    n, m = len(a), len(b)
    w = max(1, int(band_frac * max(n, m)))
    cost = np.full((n + 1, m + 1), np.inf)
    steps = np.zeros((n + 1, m + 1))
    cost[0, 0] = 0.0
    for i in range(1, n + 1):
        for j in range(max(1, i - w), min(m, i + w) + 1):
            d = (a[i - 1] - b[j - 1]) ** 2
            prev = min((cost[i - 1, j], steps[i - 1, j]),
                       (cost[i, j - 1], steps[i, j - 1]),
                       (cost[i - 1, j - 1], steps[i - 1, j - 1]))
            cost[i, j] = d + prev[0]
            steps[i, j] = prev[1] + 1
    return float(np.sqrt(cost[n, m] / max(steps[n, m], 1)))


def extract_rep_features(samples, shape_signals=None):
    """Reduce one rep to scalar metrics (duration, speed, and the min, max and range of each signal) and resampled curves for the shape check. Returns None when the rep is too short or has no duration."""
    if len(samples) < 5:
        return None
    shape_signals = set(shape_signals or ("torso_lean", "hip_y"))
    lo, hi = _active_window([s["angle"] for s in samples])
    win = samples[lo:hi + 1]
    t = np.array([s["timestamp"] for s in win], dtype=float)
    t = t - t[0]
    duration = float(t[-1])
    if duration <= 0:
        return None

    angle = np.array([s["angle"] for s in win], dtype=float)
    peak_idx = int(np.argmax(np.abs(angle - angle[0])))

    metrics = {
        "duration": duration,
        "descent_frac": float(t[peak_idx] / duration),
    }
    if len(angle) >= 3:
        vel = np.abs(angle[2:] - angle[:-2]) / np.maximum(t[2:] - t[:-2], 1e-3)
        metrics["peak_speed"] = float(np.percentile(vel, 90))
    else:
        metrics["peak_speed"] = 0.0

    names = set()
    for s in win:
        names.update((s.get("signals") or {}).keys())

    series = {}
    for name in sorted(names):
        arr = np.array([np.nan if (s.get("signals") or {}).get(name) is None
                        else s["signals"][name] for s in win], dtype=float)
        valid = ~np.isnan(arr)
        if valid.sum() < 3 or valid.sum() < MIN_SIGNAL_COVERAGE * len(arr):
            continue
        # Fill short gaps by interpolating so one lost frame does not drop the whole metric
        if not valid.all():
            arr = np.interp(np.arange(len(arr)), np.where(valid)[0], arr[valid])
        series[name] = arr

    # hip travel in standing torso-lengths so camera distance doesn't matter
    series.pop("torso_len", None)
    standing = [s["signals"]["torso_len"] for s in samples[:5]
                if (s.get("signals") or {}).get("torso_len") is not None]
    if "hip_y" in series:
        if standing and np.median(standing) > 1e-6:
            series["hip_y"] = series["hip_y"] / float(np.median(standing))
        else:
            series.pop("hip_y")

    curves = {}
    grid = np.linspace(0.0, duration, N_CURVE_POINTS)
    for name, arr in series.items():
        stats = {"min": arr.min(), "max": arr.max(), "rom": arr.max() - arr.min(),
                 "at_peak": arr[peak_idx]}
        for stat in _stats_for(name):
            metrics[f"{name}.{stat}"] = float(stats[stat])

        if name in shape_signals:
            curve = np.interp(grid, t, arr)
            if _class_of(name) == "disp":
                curve = curve - curve[0]  # camera-position independent
            curves[name] = curve
    return metrics, curves


def _spec(metric):
    """Look up the (floor, ceiling, kind, side) tolerance spec for a metric name."""
    if "." not in metric:
        return TIMING_SPECS[metric]
    sig, stat = metric.rsplit(".", 1)
    cls = _class_of(sig)
    if stat == "shape":
        return SHAPE_SPECS[cls]
    if sig == "sym_gap":
        return SYM_SPEC
    return STAT_SPECS[(cls, "rom" if stat == "rom" else "pose")]


def _weight(metric, primary_prefix, symmetry_check):
    """Importance of a metric in the score. A weight of zero drops the metric from the profile."""
    if "." not in metric:
        # tempo matters, bouncing is a classic bad-form sign
        return {"duration": 2.0, "peak_speed": 2.0}.get(metric, 1.0)
    sig, stat = metric.rsplit(".", 1)
    if sig == "sym_gap":
        return (2.0 if symmetry_check else 1.0) if stat == "at_peak" else 0.0
    if sig == "torso_lean":
        return {"max": 2.0, "at_peak": 2.0, "shape": 2.0, "rom": 1.0}.get(stat, 0.0)
    if sig == "hip_y":
        return 2.0 if stat in ("rom", "shape") else 0.0
    if sig.startswith("knee_dev"):
        return 1.0 if stat in ("at_peak", "rom") else 0.0
    if primary_prefix and sig == f"{primary_prefix}_l":  # the signal reps are detected from
        return {"rom": 3.0, "min": 2.0, "shape": 2.0}.get(stat, 0.0)
    if primary_prefix and sig == f"{primary_prefix}_r":  # far side: noisier, so only
        full = 2.0 if symmetry_check else 1.0  # important if symmetry matters
        return {"rom": full, "min": full}.get(stat, 0.0)
    return {"min": 1.0, "rom": 1.0, "at_peak": 1.0}.get(stat, 0.0)


def _tolerance(std, mu, spec, scale):
    """Allowed deviation for a metric: the calibration spread clamped between the spec floor and ceiling. The second value is True when the raw spread went past the ceiling, which means the calibration reps were inconsistent."""
    floor, ceil, kind, _ = spec
    m = max(abs(mu), 1e-6) if kind == "rel" else 1.0
    raw = STD_MULTIPLIER * std
    tol = min(max(raw, floor * m), ceil * m) * scale
    return max(tol, 1e-6), raw > ceil * m


def build_profile(template, exercise_config=None):
    """Build the scoring profile from a calibration template: a mean, spread and tolerance for each metric, plus the mean shape curves. Returns None when fewer than two reps are usable."""
    cfg = exercise_config or {}
    if not template:
        return None
    reps = [r["samples"] for r in template.get("calibration_reps", [])
            if len(r.get("samples") or []) >= 5]
    prefix = PRIMARY_PREFIX.get(cfg.get("angle_joint"))
    shape_signals = {"torso_lean", "hip_y"}
    if prefix:
        shape_signals.add(f"{prefix}_l")
    feats = [f for f in (extract_rep_features(s, shape_signals) for s in reps) if f is not None]
    n = len(feats)
    if n < 2:
        return None

    sym = bool(cfg.get("symmetry_check"))
    scale = float(cfg.get("tolerance_scale", 1.0))
    min_count = max(2, math.ceil(MIN_SIGNAL_COVERAGE * n))

    values = defaultdict(list)
    for metrics, _ in feats:
        for k, v in metrics.items():
            values[k].append(v)

    mean_curves = {}
    curve_names = set().union(*[set(c) for _, c in feats])
    for name in curve_names:
        cs = [c[name] for _, c in feats if name in c]
        if len(cs) < min_count:
            continue
        mean_curves[name] = np.mean(cs, axis=0)
        # leave-one-out gives the natural rep-to-rep spread
        for i, c in enumerate(cs):
            others = np.mean([x for j, x in enumerate(cs) if j != i], axis=0)
            values[f"{name}.shape"].append(_shape_distance(c, others))

    metrics_out = {}
    for key, vals in values.items():
        if len(vals) < min_count:
            continue
        weight = _weight(key, prefix, sym)
        if weight <= 0:
            continue
        is_shape = key.endswith(".shape")
        mu = float(np.median(vals) if is_shape else np.mean(vals))
        std = float(np.std(vals, ddof=1)) if len(vals) > 1 else 0.0
        spec = _spec(key)
        tol, inconsistent = _tolerance(std, mu, spec, scale)
        metrics_out[key] = {"mu": mu, "std": std, "tol": tol, "weight": weight,
                            "side": spec[3], "inconsistent": inconsistent}
    return {"metrics": metrics_out, "mean_curves": mean_curves, "n_reps": n,
            "shape_signals": shape_signals}


def _describe(metric, x, mu):
    """Plain-language feedback for a metric that was out of tolerance."""
    if metric == "duration":
        return f"Rep too fast: {x:.1f}s vs {mu:.1f}s in calibration (control the movement)"
    if metric == "descent_frac":
        return f"Lowest point reached at {x * 100:.0f}% of the rep vs {mu * 100:.0f}%"
    if metric == "peak_speed":
        return f"Moving faster than calibration ({x:.0f} vs {mu:.0f} deg/s)"
    sig, stat = metric.rsplit(".", 1)
    label = f"{SIGNAL_LABELS.get(sig, sig)} {STAT_LABELS[stat]}"
    if stat == "shape":
        return f"{SIGNAL_LABELS.get(sig, sig).capitalize()} movement differs from calibration"
    cls = _class_of(sig)
    fmt = (lambda v: f"{v:.0f} deg") if cls == "angle" else (lambda v: f"{v:.2f}")
    direction = "higher" if x > mu else "lower"
    return f"{label.capitalize()}: {fmt(x)} ({direction} than calibration {fmt(mu)})"


def _metric_score(dev):
    """Full marks inside the tolerance, then a straight fall to zero at three times the tolerance."""
    return 100.0 if dev <= 1.0 else max(0.0, 100.0 * (1.0 - (dev - 1.0) / 2.0))


def score_rep(rep_samples, profile):
    """Score one rep from 0 to 100 against the profile. Returns None without a profile. The score itself is None when too few of the checks could be evaluated."""
    if profile is None:
        return None
    feat = extract_rep_features(rep_samples, profile.get("shape_signals"))
    if feat is None:
        return {"score": None, "coverage": 0.0, "issues": [], "worst_dev": None, "details": []}
    metrics, curves = feat
    for name, mean_curve in profile["mean_curves"].items():
        if name in curves:
            metrics[f"{name}.shape"] = _shape_distance(curves[name], mean_curve)

    total_w = eval_w = weighted = 0.0
    results = []
    for key, p in profile["metrics"].items():
        total_w += p["weight"]
        if key not in metrics:
            continue
        x = metrics[key]
        diff = x - p["mu"]
        if p["side"] == "high":  # only a larger value is bad
            dev = max(0.0, diff) / p["tol"]
        elif p["side"] == "low":  # only a smaller value is bad
            dev = max(0.0, -diff) / p["tol"]
        else:
            dev = abs(diff) / p["tol"]
        eval_w += p["weight"]
        weighted += p["weight"] * _metric_score(dev)
        results.append((key, x, p, dev))

    coverage = eval_w / total_w if total_w else 0.0
    if coverage < MIN_COVERAGE or eval_w == 0:
        return {"score": None, "coverage": round(coverage, 2), "issues": [],
                "worst_dev": None, "details": []}

    score = weighted / eval_w
    important = [d for _, _, p, d in results if p["weight"] >= IMPORTANT_WEIGHT]
    worst_important = max(important, default=0.0)
    if worst_important > 1.0:
        # gradual cap: borderline misses stay near the line, clear ones get capped hard
        score = min(score, max(CAP_SEVERE, CAP_START - CAP_SLOPE * (worst_important - 1.0)))

    flagged = sorted((r for r in results if r[3] > 1.0), key=lambda r: -r[3] * r[2]["weight"])
    issues = [_describe(k, x, p["mu"]) for k, x, p, _ in flagged]
    details = [{"metric": k, "value": round(x, 3), "calib_mean": round(p["mu"], 3),
                "tol": round(p["tol"], 3), "dev": round(d, 2), "weight": p["weight"]}
               for k, x, p, d in sorted(results, key=lambda r: -r[3])]
    return {"score": round(score, 1), "coverage": round(coverage, 2),
            "issues": issues, "worst_dev": round(max((r[3] for r in results), default=0.0), 2),
            "details": details}


def calibration_warnings(profile):
    """Warnings about a calibration that is missing, too short or inconsistent."""
    if profile is None:
        return ["Calibration unusable: fewer than 2 complete reps were captured."]
    warns = []
    if profile["n_reps"] < 3:
        warns.append("Only %d calibration reps -- 3-5 gives much more reliable tolerances."
                     % profile["n_reps"])
    for key, p in profile["metrics"].items():
        if p["weight"] >= IMPORTANT_WEIGHT and p["inconsistent"]:
            name = key if "." not in key else _describe_name(key)
            warns.append(f"Calibration reps were inconsistent in {name}; "
                         "tolerance was capped. Consider recalibrating with more uniform reps.")
    return warns


def _describe_name(metric):
    sig, stat = metric.rsplit(".", 1)
    return f"{SIGNAL_LABELS.get(sig, sig)} ({STAT_LABELS[stat]})"
