"""Joint angle and lean calculations from landmark positions."""
import numpy as np

# joints that make up the angle at each middle joint
ANGLE_JOINTS = {
    "knee": ("hip", "knee", "ankle"),
    "hip_hinge": ("shoulder", "hip", "knee"),
    "elbow": ("shoulder", "elbow", "wrist"),
    "shoulder": ("hip", "shoulder", "elbow"),
}


def calculate_angle(a, b, c):
    """Angle in degrees at point b between the segments b-a and b-c. Returns None when a segment has no length."""
    a, b, c = np.array(a), np.array(b), np.array(c)
    ba = a - b
    bc = c - b

    norm_product = np.linalg.norm(ba) * np.linalg.norm(bc)
    if norm_product == 0:
        return None

    cosine_angle = np.dot(ba, bc) / norm_product
    cosine_angle = np.clip(cosine_angle, -1.0, 1.0)  # guard float rounding past +-1
    return float(np.degrees(np.arccos(cosine_angle)))


def calculate_lean(top_point, bottom_point):
    """Angle in degrees between the bottom-to-top segment and straight up, so 0 means upright. Returns None for a zero-length segment."""
    top, bottom = np.array(top_point), np.array(bottom_point)
    segment = top - bottom
    vertical = np.zeros(len(segment))
    vertical[1] = -1.0  # "up" in image coordinates (y grows downward)

    norm_product = np.linalg.norm(segment) * np.linalg.norm(vertical)
    if norm_product == 0:
        return None

    cosine_angle = np.dot(segment, vertical) / norm_product
    cosine_angle = np.clip(cosine_angle, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosine_angle)))