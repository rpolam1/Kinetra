"""Combines the segmenter and scorer to judge each rep as it finishes, and to report hold progress."""
import numpy as np

from formcheck.rep_segmenter import RepSegmenter
from formcheck.form_scorer import build_profile, score_rep

# A rep that does not return to the start position cannot score above this
PARTIAL_RETURN_SCORE_CAP = 74.0


def _orientation_from_template(template):
    """Work out which way the joint angle moves during a rep (1 rising, -1 falling) by voting over the first calibration reps. Returns None when no rep moved enough to tell."""
    votes = []
    for rep in (template or {}).get("calibration_reps", [])[:5]:
        angles = [s["angle"] for s in rep.get("samples", [])]
        if len(angles) < 5:
            continue
        start = float(np.median(angles[:3]))
        far = max(angles, key=lambda v: abs(v - start))
        if abs(far - start) > 5:
            votes.append(1 if far > start else -1)
    if not votes:
        return None
    return 1 if sum(votes) > 0 else -1


# Resting angle in degrees by joint and rest direction, used when the config does not give one
DEFAULT_REST_ANGLE = {
    ("knee", "high"): 172.0, ("hip_hinge", "high"): 172.0, ("elbow", "high"): 168.0,
    ("knee", "low"): 90.0, ("hip_hinge", "low"): 85.0, ("elbow", "low"): 50.0,
    ("shoulder", "low"): 20.0, ("thigh_lean", "low"): 3.0, ("spine_lean", "low"): 3.0,
}


def default_rest_angle(config):
    """Rest angle for an exercise: the configured value, else the default for its joint and direction."""
    if config.get("rest_angle") is not None:
        return float(config["rest_angle"])
    return DEFAULT_REST_ANGLE.get((config.get("angle_joint"), config.get("rest_direction")))


class QualityJudge:
    """Turns features into rep or hold judgments. Reps are scored against the patient's calibration template when there is one."""
    def __init__(self, exercise_config, template, debug=False):
        self.config = exercise_config
        self.debug = debug
        self.segmenter = RepSegmenter(
            mode=exercise_config.get("mode", "rep_based"),
            min_angle_range_deg=exercise_config.get("min_rom_deg", 15.0),
            min_rep_seconds=exercise_config.get("min_rep_seconds", 0.3),
            max_rep_seconds=exercise_config.get("max_rep_seconds", 20.0),
            rest_direction=exercise_config.get("rest_direction"),
            rest_angle=default_rest_angle(exercise_config),
        )
        self.rep_index = 0
        self.template = None
        self.profile = None
        self.set_template(template)

    def set_template(self, template):
        """Load a calibration template and tell the segmenter which way the angle moves. A template that cannot be used is reported so the patient can be recalibrated."""
        self.template = template
        self.profile = build_profile(template, self.config)
        if template is not None and self.profile is None:
            print("Warning: calibration template is unusable or in an old format "
                  "-- please recalibrate.")
        hint = _orientation_from_template(template)
        if hint is not None:
            self.segmenter.orientation_hint(hint, force=True)

    def process_feature(self, feature):
        """Feed in one frame's feature and return any hold progress or finished rep judgments."""
        self.segmenter.add_sample(feature)
        self._t = feature["timestamp"]

        if self.config.get("mode") == "hold_duration":
            return self._check_hold()
        return self._check_reps()

    def _check_hold(self):
        """Report hold progress, plus a completion event once the target time is reached."""
        is_holding, elapsed = self.segmenter.check_hold(
            target_duration_sec=self.config.get("target_duration_sec", 20)
        )
        holding, held = self.segmenter.hold_state()
        out = [{"type": "hold_progress", "holding": holding, "elapsed_seconds": round(held, 1), "t": self._t}]
        if is_holding:
            out.append({"type": "hold_complete", "elapsed_seconds": round(elapsed, 1), "t_end": self._t})
        return out

    def _check_reps(self):
        """Score each rep the segmenter finished since the last frame."""
        judgments = []
        for rep_samples, meta in self.segmenter.extract_completed_reps_with_meta():
            self.rep_index += 1
            result = score_rep(rep_samples, self.profile)

            base = {
                "type": "rep",
                "rep_index": self.rep_index,
                "t_start": meta["t_start"],
                "t_end": meta["t_end"],
                "rom": round(meta["rom"], 1),
                "partial_return": meta["partial_return"],
            }
            if result is None:
                judgments.append({**base, "score": None, "label": "not_calibrated"})
                continue
            if result["score"] is None:
                judgments.append({**base, "score": None, "label": "insufficient_data",
                                  "coverage": result["coverage"], "issues": []})
                continue

            score, issues = result["score"], list(result["issues"])
            if meta["partial_return"]:
                score = min(score, PARTIAL_RETURN_SCORE_CAP)
                issues.insert(0, "Did not return fully to the starting position")

            judgment = {**base, "score": score, "label": self._classify_score(score),
                        "coverage": result["coverage"], "worst_dev": result["worst_dev"],
                        "issues": issues}
            if self.debug:
                judgment["details"] = result["details"]
            judgments.append(judgment)
        return judgments

    @staticmethod
    def _classify_score(score):
        """Map a score to a label: 80 and up is good form, 50 and up needs correction, anything lower is flagged for the instructor."""
        if score >= 80:
            return "good_form"
        elif score >= 50:
            return "needs_correction"
        else:
            return "flag_for_instructor"
