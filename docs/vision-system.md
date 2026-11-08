# Vision Tracking Module

Standalone Python module that uses a webcam + MediaPipe Pose to
detect an exercise, track joint angles, segment reps or holds, and
score form quality against a patient's own calibration template.

This is the vision half of the broader wearable + vision exercise
tracking system (see project architecture docs) -- it is built to
run independently so it can be developed and tested before the BLE
bridge, backend, and dashboard are ready.

## Setup

```bash
cd vision
pip install -r requirements.txt
```

## Usage

**1. Calibrate a patient for an exercise** (run this first, supervised
by a kinesiologist, capturing 3 "known good" reps):

```bash
python main.py --patient p001 --exercise goblet_squat --calibrate
```

**2. Run live tracking**, scoring each rep against that patient's
saved template:

```bash
python main.py --patient p001 --exercise goblet_squat
```

Live mode prints a judgment dict each time a rep or hold completes,
e.g. `{"type": "rep", "score": 87.3, "label": "good_form"}`. In the
deployed system, that print is replaced by a WebSocket send to the
backend -- see the architecture docs for how this plugs into the
instructor dashboard and practitioner reports.

## Scope notes

- `config/exercises.json` covers one representative exercise per
  CCCARE functional category (mobility, squat/lunge, push, hinge,
  pull, core, stretch), not every named variant in the program
  documentation. Variants that share a movement pattern (e.g.
  shoulder press vs. Arnold press) share the same tracking config --
  add a new JSON entry only when a variant needs different landmarks
  or angle logic.
- `exercise_classifier.py` is a simple rule-based placeholder for
  auto-detecting the active exercise. The current system design has
  the instructor select the exercise manually on the dashboard
  instead, since that's more reliable for patients with irregular
  movement (stroke, dementia). The classifier module is included as
  an optional future extension.
- Left/right symmetry (`symmetry_check`) is vision-only here; the
  full system also cross-checks this against bilateral IMU data for
  stroke patients specifically.
- Synchronizing this module's timestamps with the IMU/bridge data
  stream (see earlier discussion on ESP32-vision delay) happens at
  the backend integration layer, not inside this module.

## Form scoring (how reps are judged)

Each rep is compared to the patient's calibration across many metrics
(joint angles, torso lean, hip travel, knee tracking, left/right gap,
tempo, curve shape), each with a tolerance band derived from the
calibration reps (clamped by a floor and a ceiling). Important metrics
that fall out of band cap the score, and `issues` in each judgment
explains why. Tune per exercise with `"tolerance_scale"` in
`config/exercises.json` (0.7 = stricter, 1.3 = looser).

Debugging a score: run live mode with `--debug` to print, after every
rep, a table of each metric (this rep vs calibration mean, tolerance,
and how many tolerances off it was).

Templates from older versions must be recalibrated.
Run tests from the `vision/` folder: `python -m pytest -s tests`

## Web app (instructor front end)

`web/` contains the React + TypeScript + Tailwind app for creating patients, assigning AprilTags,
prescribing exercises, calibrating (live skeleton, replay, keep / redo), monitoring live sessions with a status light per person, a TV board and session history, backed by Firebase. See
`docs/web-app.md` for setup, Firebase configuration, environment variables and conventions, and
`docs/multicamera.md` for the camera network. The exercise library for both lives in `config/exercises.json`.
