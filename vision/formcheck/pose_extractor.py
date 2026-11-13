"""Runs the MediaPipe pose model on camera frames and returns the landmarks it finds."""
import os
import urllib.request

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision as mp_vision

from formcheck.landmarks import attach_world
from formcheck.paths import MODEL_PATH

_MODEL_PATH = MODEL_PATH
_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)


def _ensure_model_downloaded():
    """Download the pose model if it is not already on disk."""
    if not os.path.exists(_MODEL_PATH):
        print("Downloading pose landmark model (one-time setup, ~5MB)...")
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)
        print("Model downloaded.")


def _world_at(result, index):
    """World landmarks for the pose at index, or None when MediaPipe returned none."""
    world = getattr(result, "pose_world_landmarks", None) or []
    return world[index] if index < len(world) else None


class PoseExtractor:
    """Runs the MediaPipe pose landmarker on frames and returns landmarks with 3D world coordinates attached."""
    def __init__(self, min_detection_confidence=0.5, min_tracking_confidence=0.5,
                 max_stale_frames=2, num_poses=1):
        _ensure_model_downloaded()

        base_options = mp_tasks.BaseOptions(model_asset_path=_MODEL_PATH)
        options = mp_vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=mp_vision.RunningMode.IMAGE,
            min_pose_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
            num_poses=num_poses,
        )
        self._landmarker = mp_vision.PoseLandmarker.create_from_options(options)

        self.max_stale_frames = max_stale_frames
        self._last_landmarks = None
        self._stale_count = 0

    def process(self, frame_bgr):
        """Detect one person and return their landmarks. A short run of missed frames reuses the last result."""
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        result = self._landmarker.detect(mp_image)

        if result.pose_landmarks:
            self._last_landmarks = attach_world(result.pose_landmarks[0], _world_at(result, 0))
            self._stale_count = 0
            return self._last_landmarks

        # missed detection, bridge short gaps
        if self._last_landmarks is not None and self._stale_count < self.max_stale_frames:
            self._stale_count += 1
            return self._last_landmarks

        self._last_landmarks = None
        return None

    def process_all(self, frame_bgr):
        """Detect every person in the frame, one landmark list each."""
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        result = self._landmarker.detect(mp_image)
        return [attach_world(lms, _world_at(result, i)) for i, lms in enumerate(result.pose_landmarks or [])]

    def draw_person(self, frame_bgr, landmarks, color=(0, 255, 0), label=None):
        """Draw a person's joints and an optional label above them. Joints below 0.5 visibility are skipped."""
        if landmarks is None:
            return frame_bgr
        h, w = frame_bgr.shape[:2]
        xs, ys = [], []
        for lm in landmarks:
            if getattr(lm, "visibility", 1.0) < 0.5:
                continue
            x, y = int(lm.x * w), int(lm.y * h)
            xs.append(x)
            ys.append(y)
            cv2.circle(frame_bgr, (x, y), 3, color, -1)
        if label and xs:
            cv2.putText(frame_bgr, label, (max(min(xs), 0), max(min(ys) - 10, 15)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        return frame_bgr

    def draw(self, frame_bgr, landmarks_result):
        """Draw all joints, green when visible enough and red when uncertain."""
        if landmarks_result is not None:
            h, w = frame_bgr.shape[:2]
            for lm in landmarks_result:
                visibility = getattr(lm, "visibility", 1.0)
                color = (0, 255, 0) if visibility >= 0.6 else (0, 0, 255)
                cv2.circle(frame_bgr, (int(lm.x * w), int(lm.y * h)), 4, color, -1)
        return frame_bgr

    def close(self):
        self._landmarker.close()