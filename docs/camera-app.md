# Camera app (no Python needed)

`kinetra-camera` is the camera client packaged as a self-contained program: the Python runtime, OpenCV,
MediaPipe, the pose model and the exercise library are all inside the folder. The device needs nothing installed.

## Getting it

GitHub builds it for each platform (a build for one OS cannot be made on another):

1. Push the repo to GitHub.
2. Open the **Actions** tab, choose **build camera app**, press **Run workflow**.
3. When it finishes, download the artifact for the device:
   `windows-x64` (zip), `linux-x64` (tar.gz), `linux-arm64` (tar.gz, Jetson / Raspberry Pi).

Tagging a release (`git tag v1.0 && git push --tags`) also attaches all three to the GitHub release.

## Running it on a device

Windows: unzip, double-click `kinetra-camera.exe`.
Linux: `tar xzf kinetra-camera-linux-*.tar.gz && ./kinetra-camera/kinetra-camera`

With no options it opens the first camera that works, names itself after the computer (`-N` is added for
camera N above 0, so two copies on one device get different names), and finds the hub on the network by
itself. Options are the same as `client.py`:

```
kinetra-camera                                      # run it twice: the second copy takes the next free camera
kinetra-camera --camera 2 --camera-id jetson-b      # or pin a camera and its name
kinetra-camera --no-display                         # no window (headless; chosen automatically with no screen)
kinetra-camera --hub http://192.168.1.50:5000       # skip discovery
kinetra-camera --selftest                           # check the install, then exit
```

Calibration templates and the remembered hub address are stored per user
(`%LOCALAPPDATA%\Kinetra` on Windows, `~/.local/share/Kinetra` on Linux).

## Notes

* Windows SmartScreen will warn about an unsigned program the first time ("More info" then "Run anyway").
  Signing the exe with a code-signing certificate removes this.
* On Linux the user must be allowed to open the camera (`sudo usermod -aG video $USER`, then log in again).
* Build locally instead: `cd vision && pip install -r requirements.txt pyinstaller && pyinstaller packaging/kinetra-camera.spec`
  (output in `vision/dist/kinetra-camera/`).
