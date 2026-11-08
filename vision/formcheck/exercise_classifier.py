class ExerciseClassifier:
    def __init__(self, exercise_configs):
        self.exercise_configs = exercise_configs

    def classify_window(self, angle_window_by_joint):
        variances = {
            joint: self._variance(angles)
            for joint, angles in angle_window_by_joint.items()
            if len(angles) > 1
        }
        if not variances:
            return None

        most_active_joint = max(variances, key=variances.get)
        if variances[most_active_joint] < 5:  # degrees^2 -- essentially motionless
            return None

        # first exercise whose tracked joint matches, good enough for now
        candidates = [
            name for name, cfg in self.exercise_configs.items()
            if cfg.get("angle_joint") == most_active_joint
        ]
        return candidates[0] if candidates else None

    @staticmethod
    def _variance(values):
        mean = sum(values) / len(values)
        return sum((v - mean) ** 2 for v in values) / len(values)
