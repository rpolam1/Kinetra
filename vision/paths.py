import os
import sys

FROZEN = bool(getattr(sys, "frozen", False))  # running as a packaged executable

if FROZEN:
    # PyInstaller unpacks bundled data next to the executable (or into a temp folder)
    BUNDLE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    VISION_DIR = BUNDLE_DIR
    REPO_ROOT = BUNDLE_DIR
else:
    VISION_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    REPO_ROOT = os.path.normpath(os.path.join(VISION_DIR, ".."))

CONFIG_DIR = os.path.join(REPO_ROOT, "config")
EXERCISES_PATH = os.path.join(CONFIG_DIR, "exercises.json")
WEB_DIST_DIR = os.path.join(REPO_ROOT, "web", "dist")
MODEL_PATH = os.path.join(VISION_DIR, "pose_landmarker_lite.task")


def user_data_dir(app="Kinetra"):
    # where a packaged app keeps templates and the cached hub address
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    path = os.path.join(base, app)
    os.makedirs(path, exist_ok=True)
    return path
