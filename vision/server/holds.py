"""Tracks timed holds reported by cameras and merges the same hold seen by more than one camera."""
from server.fusion import _iou

OVERLAP_IOU = 0.35


class HoldLog:
    """All holds seen so far."""

    def __init__(self, overlap_iou=OVERLAP_IOU):
        self.overlap_iou = overlap_iou
        self.items = []

    def add(self, obs):
        """Add a hold from a camera. It is merged into an existing hold when the exercise matches, the people do not conflict and the times overlap."""
        obs = dict(obs)
        for item in self.items:
            if obs["camera_id"] in item["cameras"] or item["exercise"] != obs["exercise"]:
                continue
            if item["patient_id"] and obs.get("patient_id") and item["patient_id"] != obs["patient_id"]:
                continue
            if item["patient_id"] is None and obs.get("patient_id") is None and item["track_key"] != obs.get("track_key"):
                continue
            if _iou(item["t_start"], item["t_end"], obs["t_start"], obs["t_end"]) < self.overlap_iou:
                continue
            item["cameras"].add(obs["camera_id"])
            item["t_start"] = min(item["t_start"], obs["t_start"])
            item["t_end"] = max(item["t_end"], obs["t_end"])
            item["seconds"] = max(item["seconds"], obs["seconds"])
            item["completed"] = item["completed"] or bool(obs.get("completed"))
            item["patient_id"] = item["patient_id"] or obs.get("patient_id")
            return item
        item = {"patient_id": obs.get("patient_id"), "track_key": obs.get("track_key"), "exercise": obs["exercise"],
                "t_start": obs["t_start"], "t_end": obs["t_end"], "seconds": obs["seconds"],
                "target_seconds": obs.get("target_seconds"), "completed": bool(obs.get("completed")),
                "cameras": {obs["camera_id"]}}
        self.items.append(item)
        return item

    def bind(self, track_key, patient_id):
        """Fill in the patient on earlier holds from a track once the patient is known."""
        for item in self.items:
            if item["patient_id"] is None and item["track_key"] == track_key:
                item["patient_id"] = patient_id

    def for_patient(self, patient_id, exercise=None, since=None):
        """Holds for a patient, optionally for one exercise and starting after a time."""
        return [h for h in self.items
                if h["patient_id"] == patient_id
                and (exercise is None or h["exercise"] == exercise)
                and (since is None or h["t_start"] >= since)]
