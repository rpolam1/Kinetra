# Kinetra: Exercise Tracker

Camera-based exercise tracking for group classes: cameras recognise each person by an AprilTag, count reps,
score form against that person's own calibration, and show progress on a TV board. Instructors manage
patients, prescriptions, calibration and live sessions in a web app.

```
vision/   Python: pose tracking, multi-camera client, and the hub (Flask + SQLite) that also serves the web app
web/      React + TypeScript web app (instructor screens, live session, TV board); Firebase for cloud data
config/   exercises.json, the exercise library shared by vision/ and web/
docs/     guides: vision-system.md, multicamera.md, web-app.md
```

## Quick start

```powershell
# 1. Build the web app
cd web
npm install
npm run build

# 2. Start the hub (it serves the app and talks to the cameras)
cd ..\vision
pip install -r requirements.txt
py -m server.hub

# 3. On each camera laptop, from vision/
py client.py --camera-id lab-1 --exercise goblet_squat --auto-host
```

Open the address the hub prints. Without Firebase the app runs in demo mode with sample accounts on the sign-in page.

* Accounts: anyone can sign up; an admin approves roles. Setting up the first admin: [`docs/web-app.md`](docs/web-app.md).
* Logo: replace `web/public/logo.png` with your white logo.
* Cameras and the network: [`docs/multicamera.md`](docs/multicamera.md).
* Tracking internals: [`docs/vision-system.md`](docs/vision-system.md).

## Tests

```powershell
cd vision; py -m pytest -s tests     # Python
cd web;    npm test                  # web unit tests
cd web;    npm run test:e2e          # browser end-to-end (needs the built app and Playwright)
```

Secrets never go in code: Firebase values come from `web/.env.local`, the hub key from `HUB_API_KEY`.
