"""Landmark names and helpers for reading points and visibility from MediaPipe results."""
# MediaPipe pose landmark indices (0-32)
LANDMARK_INDEX = {
    "shoulder": 11,  # left shoulder
    "shoulder_r": 12,  # right shoulder
    "elbow": 13,
    "elbow_r": 14,
    "wrist": 15,
    "wrist_r": 16,
    "hip": 23,
    "hip_r": 24,
    "knee": 25,
    "knee_r": 26,
    "ankle": 27,
    "ankle_r": 28,
}

# below this the landmark is basically a guess
DEFAULT_MIN_VISIBILITY = 0.6


def get_point(landmarks, name, frame_shape):
    """Landmark position in pixels."""
    if name not in LANDMARK_INDEX:
        raise ValueError(f"Unknown landmark name: {name}")

    idx = LANDMARK_INDEX[name]
    point = landmarks[idx]
    height, width = frame_shape[0], frame_shape[1]
    return (point.x * width, point.y * height)


def get_visibility(landmarks, name):
    if name not in LANDMARK_INDEX:
        raise ValueError(f"Unknown landmark name: {name}")

    idx = LANDMARK_INDEX[name]
    point = landmarks[idx]
    return getattr(point, "visibility", 1.0)


def is_visible(landmarks, name, min_visibility=DEFAULT_MIN_VISIBILITY):
    """True when the landmark exists and its visibility is at or above the threshold."""
    try:
        return get_visibility(landmarks, name) >= min_visibility
    except (IndexError, ValueError):
        return False


def get_visible_point(landmarks, name, frame_shape, min_visibility=DEFAULT_MIN_VISIBILITY):
    """Pixel position, or None when the landmark is not visible enough."""
    if not is_visible(landmarks, name, min_visibility):
        return None
    return get_point(landmarks, name, frame_shape)


class PoseLandmark:
    """Image landmark with optional world coordinates attached (metres, centred on the hips)."""
    __slots__ = ("x", "y", "z", "visibility", "wx", "wy", "wz")

    def __init__(self, x, y, z, visibility, wx=None, wy=None, wz=None):
        self.x, self.y, self.z, self.visibility = x, y, z, visibility
        self.wx, self.wy, self.wz = wx, wy, wz


def attach_world(image_landmarks, world_landmarks):
    """Pair each image landmark with its world landmark. Pairing is skipped when the counts differ."""
    world = list(world_landmarks) if world_landmarks is not None else []
    paired = len(world) == len(image_landmarks)
    out = []
    for i, lm in enumerate(image_landmarks):
        w = world[i] if paired else None
        out.append(PoseLandmark(lm.x, lm.y, getattr(lm, "z", 0.0), getattr(lm, "visibility", 1.0),
                                w.x if w is not None else None,
                                w.y if w is not None else None,
                                w.z if w is not None else None))
    return out


def has_world(landmarks):
    """True when every landmark the exercises use has world coordinates."""
    try:
        return all(getattr(landmarks[LANDMARK_INDEX[n]], "wx", None) is not None for n in LANDMARK_INDEX)
    except (IndexError, TypeError):
        return False


def get_world_point(landmarks, name, min_visibility=DEFAULT_MIN_VISIBILITY):
    """Position in 3D from the world landmarks, or None when it is not visible or not available. Angles measured in 3D do not change with the camera view."""
    if not is_visible(landmarks, name, min_visibility):
        return None
    lm = landmarks[LANDMARK_INDEX[name]]
    if getattr(lm, "wx", None) is None:
        return None
    return (lm.wx, lm.wy, lm.wz)
