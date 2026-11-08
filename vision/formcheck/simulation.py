import math
import random

FPS = 20  # a CPU webcam + pose model is often ~20 fps
FRAME_SHAPE = (480, 640, 3)
ANGLE_NOISE = 2.5  # deg of per-frame jitter on every joint angle


class LM:

    def __init__(self, x=0.5, y=0.5, v=0.99):
        self.x, self.y, self.visibility = x, y, v


def make_landmarks(theta_l, theta_r, lean, foreshorten):
    lm = [LM(v=0.0) for _ in range(33)]
    L, T = 0.22, 0.25 * (1 - foreshorten)  # torso shrinks as you squat (camera view)

    def leg(theta, xoff, i_sh, i_hip, i_knee, i_ank):
        ankle = (0.5 + xoff, 0.9)
        phi = math.radians((180 - theta) / 2)
        knee = (ankle[0] + L * math.sin(phi), ankle[1] - L * math.cos(phi))
        u = (ankle[0] - knee[0], ankle[1] - knee[1])
        n = math.hypot(*u)
        th = math.radians(theta)
        vx = (u[0] * math.cos(th) - u[1] * math.sin(th)) / n
        vy = (u[0] * math.sin(th) + u[1] * math.cos(th)) / n
        hip = (knee[0] + L * vx, knee[1] + L * vy)
        sh = (hip[0] + T * math.sin(math.radians(lean)), hip[1] - T * math.cos(math.radians(lean)))
        for idx, p in ((i_sh, sh), (i_hip, hip), (i_knee, knee), (i_ank, ankle)):
            lm[idx] = LM(*p)

    leg(theta_l, 0.0, 11, 23, 25, 27)
    leg(theta_r, 0.03, 12, 24, 26, 28)
    return lm


def frames(specs, seed=0, fps=FPS, angle_noise=ANGLE_NOISE):
    rng = random.Random(seed)
    t = 0.0
    out = []

    def add(theta_l, theta_r, lean, fore):
        nonlocal t
        lm = make_landmarks(theta_l + rng.gauss(0, angle_noise), theta_r + rng.gauss(0, angle_noise),
                            lean + rng.gauss(0, 1.0), fore)
        out.append((t, lm))
        t += 1 / fps

    def hold(sec):
        for _ in range(int(sec * fps)):
            add(175, 175, 8, 0.0)

    hold(0.6)
    for s in specs:
        n = max(int(s["dur"] * fps), 8)
        tr = s.get("theta_r_min", s["theta_min"])
        lag = rng.uniform(0, 0.12) * fps  # right side lags a little
        for i in range(n):
            flat = s.get("flat", 0.0)  # >0 = pause at the bottom
            p = min(1.0, math.sin(math.pi * i / (n - 1)) ** 2 * (1 + flat))
            pr = min(1.0, math.sin(math.pi * min(max((i - lag) / (n - 1), 0), 1)) ** 2 * (1 + flat))
            add(175 - (175 - s["theta_min"]) * p, 175 - (175 - tr) * pr,
                8 + (s["lean"] - 8) * p, 0.5 * p)
        hold(rng.uniform(0.3, 1.2))
    return out


def good_spec(rng):
    return dict(theta_min=rng.uniform(95, 125), lean=rng.uniform(20, 32), dur=rng.uniform(1.3, 2.2))


def bad_spec(rng, kind="shallow"):
    spec = good_spec(rng)
    if kind == "shallow":
        spec["theta_min"] = rng.uniform(145, 152)
    elif kind == "lean":
        spec["lean"] = rng.uniform(58, 64)
    elif kind == "bounce":
        spec["dur"] = 0.55
    else:
        raise ValueError(f"unknown bad rep kind: {kind}")
    return spec


def shifted(landmarks, dx=0.0, dy=0.0, jitter=0.0, rng=None):
    rng = rng or random.Random(0)
    return [LM(l.x + dx + (rng.gauss(0, jitter) if jitter else 0.0),
               l.y + dy + (rng.gauss(0, jitter) if jitter else 0.0), l.visibility)
            for l in landmarks]


def chest_px(landmarks, frame_shape=FRAME_SHAPE):
    h, w = frame_shape[:2]
    return ((landmarks[11].x + landmarks[12].x) / 2 * w, (landmarks[11].y + landmarks[12].y) / 2 * h)
