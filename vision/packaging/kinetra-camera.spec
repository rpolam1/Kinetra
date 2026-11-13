# build from the vision folder:  pyinstaller packaging/kinetra-camera.spec
import os
from PyInstaller.utils.hooks import collect_all

vision = os.path.abspath(os.path.join(SPECPATH, ".."))
repo = os.path.abspath(os.path.join(vision, ".."))

# The pose model and exercise config are bundled so the executable works without the repo
datas = [
    (os.path.join(vision, "pose_landmarker_lite.task"), "."),
    (os.path.join(repo, "config", "exercises.json"), "config"),
]
binaries, hiddenimports = [], ["scipy.optimize", "scipy.spatial.transform"]
# These packages are collected whole because PyInstaller does not find all of their data files
for pkg in ("mediapipe", "cv2"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    [os.path.join(vision, "kinetra_camera.py")],
    pathex=[vision],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    # Left out to keep the bundle small
    excludes=["tkinter", "matplotlib", "pytest", "IPython", "jupyter"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="kinetra-camera",
    console=True,  # shows the connection status; close the window to quit
)
coll = COLLECT(exe, a.binaries, a.datas, name="kinetra-camera")
