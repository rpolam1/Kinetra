"""Saves, loads and builds calibration templates."""
import json
import os

# Bump when the template format changes so old files can be recognised
TEMPLATE_VERSION = 2


def _round(v, nd=4):
    return None if v is None else round(float(v), nd)


def rep_samples_for_template(rep):
    """Shape a rep's samples for storage: times become relative to the rep start and values are rounded to keep files small."""
    t0 = rep[0]["timestamp"]
    return [{
        "timestamp": _round(s["timestamp"] - t0),
        "angle": _round(s["angle"]),
        "aux": _round(s.get("aux")),
        "signals": {k: _round(v) for k, v in (s.get("signals") or {}).items()},
    } for s in rep]


def assemble_template(patient_id, exercise_name, reps):
    """Wrap calibration reps in the template format."""
    return {
        "version": TEMPLATE_VERSION,
        "patient_id": patient_id,
        "exercise_name": exercise_name,
        "calibration_reps": [{"samples": r["samples"], "duration_sec": r["duration_sec"]} for r in reps],
    }


class TemplateManager:
    """Stores one calibration template per patient and exercise as a JSON file."""
    def __init__(self, storage_dir="templates"):
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)

    def _path(self, patient_id, exercise_name):
        return os.path.join(self.storage_dir, f"{patient_id}_{exercise_name}.json")

    def save_template(self, patient_id, exercise_name, rep_samples_list):
        """Build a template from raw rep samples and save it. Reps with fewer than two samples are skipped."""
        calibration_reps = [
            {"samples": rep_samples_for_template(rep), "duration_sec": rep[-1]["timestamp"] - rep[0]["timestamp"]}
            for rep in rep_samples_list if len(rep) >= 2
        ]
        data = assemble_template(patient_id, exercise_name, calibration_reps)
        with open(self._path(patient_id, exercise_name), "w") as f:
            json.dump(data, f)

    def store_template(self, patient_id, exercise_name, template):
        """Save a template that is already in the template format."""
        with open(self._path(patient_id, exercise_name), "w") as f:
            json.dump(template, f)

    def load_template(self, patient_id, exercise_name):
        """Return the saved template, or None when there is none."""
        path = self._path(patient_id, exercise_name)
        if not os.path.exists(path):
            return None
        with open(path, "r") as f:
            return json.load(f)
