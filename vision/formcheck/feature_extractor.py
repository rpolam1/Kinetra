import math
import time

from formcheck.landmarks import (get_visible_point, get_world_point, has_world, is_visible, LANDMARK_INDEX,
                                 DEFAULT_MIN_VISIBILITY)
from formcheck.angle_utils import calculate_angle, calculate_lean, ANGLE_JOINTS


# signal prefix for each ANGLE_JOINTS key
PRIMARY_PREFIX = {"knee": "knee", "hip_hinge": "hinge", "elbow": "elbow", "shoulder": "shoulder",
                  "thigh_lean": "thigh"}
_PREFIX_TO_JOINT = {v: k for k, v in PRIMARY_PREFIX.items()}

# extra per-frame form signals, override with form_signals in the json
#   <prefix>_l / _r : joint angle, left / right side
#   torso_lean      : shoulder->hip deviation from vertical (deg)
#   hip_y           : hip height (fraction of frame); scorer divides its range by
#                     the standing torso_len (fraction of frame) recorded alongside
#   knee_dev_l / _r : knee offset from the hip-ankle line, in leg-lengths
#                     (side view: knee travel; front view: valgus/varus)
#   sym_gap         : |left - right| of the primary joint angle (deg)
DEFAULT_SIGNAL_SETS = {
    "knee": ["knee_l", "knee_r", "hinge_l", "hinge_r", "torso_lean", "hip_y",
             "knee_dev_l", "knee_dev_r", "sym_gap"],
    "hip_hinge": ["hinge_l", "hinge_r", "knee_l", "knee_r", "torso_lean", "hip_y", "sym_gap"],
    "elbow": ["elbow_l", "elbow_r", "torso_lean", "hip_y", "sym_gap"],
    "shoulder": ["shoulder_l", "shoulder_r", "elbow_l", "elbow_r", "torso_lean", "sym_gap"],
    "spine_lean": ["torso_lean"],
    # thigh angle from vertical (not a 3-point joint)
    "thigh_lean": ["thigh_l", "thigh_r", "torso_lean", "hip_y", "sym_gap"],
}


class FeatureExtractor:
    def __init__(self, exercise_config, min_visibility=DEFAULT_MIN_VISIBILITY):
        self.angle_joint = exercise_config.get("angle_joint")
        self.symmetry_check = exercise_config.get("symmetry_check", False)
        self.displacement_landmark = exercise_config.get("displacement_landmark")
        self.min_visibility = min_visibility
        self.signal_names = list(exercise_config.get("form_signals")
                                 or DEFAULT_SIGNAL_SETS.get(self.angle_joint, []))
        # hip_y needs the standing torso length
        if "hip_y" in self.signal_names and "torso_len" not in self.signal_names:
            self.signal_names.append("torso_len")
        self._frame_h = 1.0
        self._world = False

    def _point(self, landmarks, name, frame_shape, flat=False):
        if not flat and self._world:
            return get_world_point(landmarks, name, self.min_visibility)
        return get_visible_point(landmarks, name, frame_shape, self.min_visibility)

    def extract(self, landmarks, frame_shape):
        if landmarks is None or self.angle_joint is None:
            return None
        self._world = has_world(landmarks)

        if self.angle_joint == "spine_lean":
            feature = self._extract_spine_lean(landmarks, frame_shape)
        elif self.angle_joint == "thigh_lean":
            feature = self._extract_thigh_lean(landmarks, frame_shape)
        elif self.angle_joint in ANGLE_JOINTS:
            feature = self._extract_joint_angle(landmarks, frame_shape)
        else:
            raise ValueError(f"No angle definition for joint: {self.angle_joint}")

        if feature is None:
            return None

        if self.displacement_landmark:
            feature["aux_signal"] = self._extract_aux_displacement(landmarks)

        feature["signals"] = self._extract_signals(landmarks, frame_shape)
        return feature

    def _extract_signals(self, landmarks, frame_shape):
        cache = {}
        self._frame_h = float(frame_shape[0])

        def pt(base, side, flat=False):
            key = (base, side, flat)
            if key not in cache:
                name = base if side == "l" else base + "_r"
                cache[key] = self._point(landmarks, name, frame_shape, flat)
            return cache[key]

        def torso(flat=False):
            for side in ("l", "r"):
                s, h = pt("shoulder", side, flat), pt("hip", side, flat)
                if s is not None and h is not None:
                    return s, h
            return None

        return {name: self._compute_signal(name, pt, torso) for name in self.signal_names}

    def _joint_angle(self, prefix, side, pt):
        if prefix == "thigh":
            hip, knee = pt("hip", side), pt("knee", side)
            return calculate_lean(hip, knee) if hip is not None and knee is not None else None
        joint = _PREFIX_TO_JOINT.get(prefix)
        if joint is None:
            return None
        pts = [pt(n, side) for n in ANGLE_JOINTS[joint]]
        if any(p is None for p in pts):
            return None
        return calculate_angle(*pts)

    def _compute_signal(self, name, pt, torso):
        if name == "torso_lean":
            t = torso()
            return calculate_lean(t[0], t[1]) if t else None

        if name == "hip_y":
            # hip height as a fraction of the frame, not divided by torso length (that shrinks when squatting)
            t = torso(True)
            return t[1][1] / self._frame_h if t else None

        if name == "torso_len":
            t = torso(True)
            return math.dist(t[0], t[1]) / self._frame_h if t else None

        if name == "sym_gap":
            prefix = PRIMARY_PREFIX.get(self.angle_joint)
            left = self._joint_angle(prefix, "l", pt)
            right = self._joint_angle(prefix, "r", pt)
            return abs(left - right) if left is not None and right is not None else None

        prefix, _, side = name.rpartition("_")
        if side not in ("l", "r"):
            raise ValueError(f"Unknown form signal: {name}")

        if prefix == "knee_dev":
            hip, knee, ankle = pt("hip", side, True), pt("knee", side, True), pt("ankle", side, True)
            if hip is None or knee is None or ankle is None:
                return None
            leg_len = math.dist(hip, ankle)
            dy = ankle[1] - hip[1]
            if leg_len < 1e-6 or abs(dy) < 1e-6:
                return None
            frac = (knee[1] - hip[1]) / dy
            line_x = hip[0] + frac * (ankle[0] - hip[0])
            return (knee[0] - line_x) / leg_len

        return self._joint_angle(prefix, side, pt)

    def _extract_aux_displacement(self, landmarks):
        name = self.displacement_landmark
        if name not in LANDMARK_INDEX or not is_visible(landmarks, name, self.min_visibility):
            return None
        return float(landmarks[LANDMARK_INDEX[name]].y)

    def _extract_thigh_lean(self, landmarks, frame_shape):
        hip = self._point(landmarks, "hip", frame_shape)
        knee = self._point(landmarks, "knee", frame_shape)
        if hip is None or knee is None:
            return None
        lean = calculate_lean(hip, knee)
        if lean is None:
            return None
        return {"timestamp": time.time(), "primary_angle": lean}

    def _extract_spine_lean(self, landmarks, frame_shape):
        shoulder = self._point(landmarks, "shoulder", frame_shape)
        hip = self._point(landmarks, "hip", frame_shape)
        if shoulder is None or hip is None:
            return None

        lean = calculate_lean(shoulder, hip)
        if lean is None:
            return None
        return {"timestamp": time.time(), "primary_angle": lean}

    def _extract_joint_angle(self, landmarks, frame_shape):
        joint_a, joint_b, joint_c = ANGLE_JOINTS[self.angle_joint]

        a = self._point(landmarks, joint_a, frame_shape)
        b = self._point(landmarks, joint_b, frame_shape)
        c = self._point(landmarks, joint_c, frame_shape)
        if a is None or b is None or c is None:
            return None

        primary_angle = calculate_angle(a, b, c)
        if primary_angle is None:
            return None

        result = {"timestamp": time.time(), "primary_angle": primary_angle}

        if self.symmetry_check:
            a_r = self._point(landmarks, joint_a + "_r", frame_shape)
            b_r = self._point(landmarks, joint_b + "_r", frame_shape)
            c_r = self._point(landmarks, joint_c + "_r", frame_shape)
            if a_r is not None and b_r is not None and c_r is not None:
                right_angle = calculate_angle(a_r, b_r, c_r)
                if right_angle is not None:
                    result["secondary_angle"] = right_angle
                    result["symmetry_gap"] = abs(primary_angle - right_angle)

        return result