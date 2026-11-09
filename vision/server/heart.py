import math

STALE_SECONDS = 15.0
MAX_SAMPLES_PER_POST = 600
MIN_BPM = 25.0
MAX_BPM = 250.0
PAST_LIMIT_SECONDS = 3600.0
FUTURE_LIMIT_SECONDS = 120.0
SAMPLE_GAP_CAP = 10.0
HIGH_RESERVE_FRACTION = 0.85

MESSAGES = {
    "no_signal": "No heart-rate signal",
    "no_target": "No target zone set. Heart rate shown for reference",
    "unreliable": "Zone not used for this person (beta blocker). Ask how hard it feels",
    "below": "Below target zone. Can push a little harder",
    "in_zone": "In target zone",
    "above": "Above target zone. Ease off a little",
    "high": "Heart rate very high. Check on them",
}


class HeartError(ValueError):
    pass


def _number(value, lo, hi):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and lo <= value <= hi


def normalize_zone(raw):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise HeartError("heart_zone must be an object")
    resting, top, low, high = raw.get("resting"), raw.get("max"), raw.get("low"), raw.get("high")
    if not (_number(resting, 25, 160) and _number(top, 80, 230) and _number(low, 30, 230) and _number(high, 30, 230)):
        raise HeartError("heart_zone needs resting, max, low and high in bpm")
    if not resting < low < high <= top:
        raise HeartError("heart_zone must satisfy resting < low < high <= max")
    return {"resting": round(resting), "max": round(top), "low": round(low), "high": round(high),
            "reliable": raw.get("reliable", True) is not False}


def high_alert_bpm(zone):
    return zone["resting"] + HIGH_RESERVE_FRACTION * (zone["max"] - zone["resting"])


def classify(bpm, zone):
    if zone is None:
        return "no_target"
    if not zone["reliable"]:
        return "unreliable"
    if bpm >= high_alert_bpm(zone):
        return "high"
    if bpm > zone["high"]:
        return "above"
    if bpm < zone["low"]:
        return "below"
    return "in_zone"


def evaluate(sample, now, zone):
    public_zone = None if zone is None else {k: zone[k] for k in ("low", "high", "max", "resting")}
    if sample is None or now - sample["t"] > STALE_SECONDS:
        return {"bpm": None if sample is None else round(sample["bpm"]),
                "age_seconds": None if sample is None else round(max(0.0, now - sample["t"]), 1),
                "status": "no_signal", "message": MESSAGES["no_signal"], "zone": public_zone}
    status = classify(sample["bpm"], zone)
    return {"bpm": round(sample["bpm"]), "age_seconds": round(max(0.0, now - sample["t"]), 1),
            "status": status, "message": MESSAGES[status], "zone": public_zone}


def parse_samples(raw, now):
    if not isinstance(raw, list) or not raw:
        raise HeartError("samples must be a non-empty list")
    if len(raw) > MAX_SAMPLES_PER_POST:
        raise HeartError(f"at most {MAX_SAMPLES_PER_POST} samples per request")
    out = []
    for s in raw:
        if not isinstance(s, dict) or not _number(s.get("t"), 0, 4e9) or not _number(s.get("bpm"), MIN_BPM, MAX_BPM):
            raise HeartError("each sample needs t (unix seconds) and bpm (25-250)")
        if not now - PAST_LIMIT_SECONDS <= s["t"] <= now + FUTURE_LIMIT_SECONDS:
            raise HeartError("sample time is too far from the hub clock; sync the device clock")
        out.append({"t": float(s["t"]), "bpm": float(s["bpm"])})
    return sorted(out, key=lambda s: s["t"])


def summarize(samples, zone):
    if not samples:
        return None
    ordered = sorted(samples, key=lambda s: s["t"])
    bpms = [s["bpm"] for s in ordered]
    out = {"samples": len(ordered), "avg_bpm": round(sum(bpms) / len(bpms)), "min_bpm": round(min(bpms)),
           "max_bpm": round(max(bpms)), "seconds_total": 0.0, "seconds_in_zone": None, "seconds_below": None,
           "seconds_above": None, "zone": None if zone is None else {k: zone[k] for k in ("low", "high", "max", "resting")}}
    weights = []
    for i, s in enumerate(ordered):
        nxt = ordered[i + 1]["t"] - s["t"] if i + 1 < len(ordered) else 1.0
        weights.append(max(0.0, min(nxt, SAMPLE_GAP_CAP)))
    out["seconds_total"] = round(sum(weights), 1)
    if zone is not None and zone["reliable"]:
        inside = below = above = 0.0
        for s, w in zip(ordered, weights):
            status = classify(s["bpm"], zone)
            if status == "in_zone":
                inside += w
            elif status == "below":
                below += w
            else:
                above += w
        out["seconds_in_zone"], out["seconds_below"], out["seconds_above"] = (round(inside, 1), round(below, 1), round(above, 1))
    return out


class HeartLog:

    def __init__(self, store):
        self.store = store
        self._latest = {}

    def add(self, patient_id, samples):
        self.store.add_heart_samples(patient_id, samples)
        newest = samples[-1]
        current = self._latest.get(patient_id)
        if current is None or newest["t"] >= current["t"]:
            self._latest[patient_id] = dict(newest)

    def latest(self, patient_id):
        if patient_id not in self._latest:
            found = self.store.latest_heart(patient_id)
            if found is None:
                return None
            self._latest[patient_id] = found
        return self._latest[patient_id]

    def between(self, patient_id, since, until=None):
        return self.store.heart_samples(patient_id, since, until)
