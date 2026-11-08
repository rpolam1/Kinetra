# Multi-camera, multi-person tracking

```
 laptop 1 (client.py) ──┐
 laptop 2 (client.py) ──┼──►  HUB (server/hub.py, Flask + SQLite)  ◄── instructor dashboard
 laptop 3 (client.py) ──┘      • fuses reps from all cameras (a rep seen twice counts once)
                               • computes sets per patient   • stores templates   • clock reference
```

## Connection is automatic (no addresses to type)

Clients find the hub by themselves. They try, in order: an address you gave (a wrong
one is just skipped) → the last hub that worked → this machine → a **UDP broadcast**
("is there a hub?") → a **scan of the local subnet**. If the hub restarts or gets a
new IP while a client is running, the client finds it again and sends everything it
buffered. If two hubs ever exist, every client picks the **oldest**, so they agree.

Requirements: all laptops on the **same Wi-Fi/router** (not a "guest" network, which
isolates devices), and on the hub laptop the firewall must allow TCP 5000 + UDP 5001:

```powershell
py tools/hub_check.py --fix-firewall     # hub laptop, PowerShell as Administrator, once
py tools/hub_check.py                    # any laptop: shows exactly what it can/can't see and why
```

## 1. Start the hub (any one laptop)

Every Python command in this guide is run from the `vision/` folder (`cd vision`).

```powershell
py -m server.hub
```
It prints its address for reference, but nobody needs it. Optional: `--set-gap 20`
(seconds without a rep before a new set), `HUB_API_KEY` env var as a shared secret.
**Or skip this step**: run clients with `--auto-host`, and if no hub exists the first
laptop starts one inside its own process; the others find it automatically.

## Managing patients and tags from the web app

The web app (`web/`, see `docs/web-app.md`) creates patients, assigns each one an AprilTag, and registers the
mapping with the hub. Once any tag is registered, cameras use the hub's registry and **ignore unknown tags**
(a stray tag cannot create a phantom patient). `config/tags.json` and the `p001` default only apply to a
hub that has no registry. The hub also serves the built web app: run `py -m server.hub` and open the address
it prints. Tag images for printing come from the hub (`/api/tags/<id>.png`).

## 2. Print tags

```powershell
py tools/make_tags.py 1-10          # tags/tag_001.png ...  (tag 1 = patient p001)
```
Custom ids: create `config/tags.json`, e.g. `{"1": "alice", "2": "bob"}`.
Print >=10 cm wide, matte paper. Wear on the chest or hold near the torso.

## 3. Calibrate each patient (supervised, once per exercise)

**Easiest: from the web app.** Open the patient, then the *Calibration* tab, then *Calibrate* next to
the exercise. Pick the camera, ask the patient to do slow good reps, and:

* you see their live skeleton (and a plain-language reason when nothing is being captured);
* after each rep the camera detects, the rep appears in the list: replay it (pause, scrub, half speed),
  then **Keep** (a good rep) or **Redo** (a bad one);
* when at least 3 reps are kept, **Finish** builds the template on the hub.

**Or from the command line** (same result):

```powershell
py main.py --patient p001 --exercise goblet_squat --calibrate --camera-id lab-1
```
The template is uploaded to the hub automatically (it is also kept locally). **Angles
are measured in 2D, so calibrate from the same viewpoint you will score from**:
`--camera-id` stores a per-camera template (`goblet_squat@lab-1`). Clients use their own
camera's template first and fall back to a shared one (calibrate without `--camera-id`).

## 4. Run a client on every laptop

```powershell
py client.py --camera-id lab-1 --exercise goblet_squat --auto-host
```
Use a **unique `--camera-id` per laptop**. `--exercise` is the default for anyone the
hub has no assignment for; the instructor can assign per patient:
```powershell
curl -X POST http://HUB_ADDRESS:5000/api/assign -H "Content-Type: application/json" -d "{\"patient_id\":\"p001\",\"exercise\":\"lunge\"}"
```
Clients pick assignments up within ~2 s. `--no-hub` runs fully offline;
`--hub <address>` is optional (only to force a specific hub).
Keep laptop clocks roughly right; each client also measures its offset from the hub
and corrects every timestamp it sends.

## How identity works

| Situation | What happens |
|---|---|
| Tag shown next to a skeleton | track is bound to that patient (`id_source: tag`) |
| Tag later covered | binding follows the track by motion prediction (`continuity`) |
| Person leaves/returns, tag hidden | matched back by last position + body proportions (`reid`); **not guessed if ambiguous** |
| Tag seen again | overrides any guess, so mistakes self-correct |
| Camera never sees a tag | its reps are matched to the person another camera identified doing a rep at the same moment; after 2 agreeing matches the hub attributes that camera's track to the patient from then on |
| Nobody ever identifies them | reps stay in `/api/unassigned` (still counted once) |

## How counting works (no double counting)

Every camera reports each rep with start/end times on the hub's clock. The hub
merges reports that are the **same exercise, overlapping in time (IoU ≥ 0.35), from
different cameras, with compatible identity**. The merged rep's score is the
coverage-weighted average of what each camera judged. A **set** = consecutive reps
with gaps ≤ `--set-gap` seconds. Observations are stored as events and replayed on
restart, so nothing is lost if the hub restarts; clients buffer and retry (with
idempotent event ids) if the hub is unreachable.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/time` | hub clock (clients sync to it) |
| `POST /api/events` | `{camera_id, events:[rep\|bind,...]}` from clients |
| `GET /api/state` | assignments, set gap, camera heartbeats |
| `POST /api/assign` | `{patient_id, exercise}` |
| `GET /api/patients` | known patients |
| `GET /api/patients/<id>/summary[?exercise=]` | totals, sets, current set, every rep with score/issues/cameras |
| `GET /api/unassigned` | reps nobody could identify |
| `PUT/GET /api/templates/<patient>/<exercise[@camera]>` | calibration templates |
| `GET /api/live` | everyone's status light, exercise and progress (the whole picture) |
| `GET /api/stream?topics=status,calibration,skeleton[&job=]` | Server-Sent Events, snapshot per change |
| `POST /api/presence` | cameras report who they can see (about once a second) |
| `GET/PUT /api/session`, `POST /api/session/end\|advance\|auto-advance` | the live session |
| `GET/POST /api/calibration`, `GET /api/calibration/<id>[/reps/<n>]` | calibration jobs |
| `POST /api/calibration/<id>/claim\|frame\|finish\|cancel` | camera and instructor actions |
| `POST /api/calibration/<id>/reps/<n>/decision` | `{"decision": "keep" \| "discard"}` |

Errors are JSON `{error, code}`: 400 invalid, 404 not_found, 409 conflict, 422 too_few / unusable.
The stream sends only the newest snapshot of each topic, so a slow browser never builds a backlog.

## Live session, status lights and the board

The instructor starts a session in the web app (*Live session*): each person's current prescription becomes
their plan. The hub then derives, for everyone: which exercise they should be doing, set and rep progress
(counted once even if several cameras saw it) and a status light:

| Light | Meaning |
|---|---|
| Not detected | no camera has seen them for 8 s |
| Resting | in view but no rep for 12 s |
| On track | recent reps average 80 or more (or the exercise is not scored) |
| Form drifting | recent average under 80, or one rep under 50 |
| Needs help | recent average under 50, or two reps under 50 |
| Finished | every exercise done |

Auto-advance moves a person to their next exercise when they reach the target reps. `/board` (open it on the
TV) shows **only** the board name, the exercise and set/rep progress; never scores or lights.

## Try everything without any hardware

```powershell
py -m server.hub --web ../web/dist      # or just: py -m server.hub
py tools/simulate_camera.py --patients P-0001,P-0002 --camera-id sim-1
```
The fake camera runs the real tracking, calibration and scoring on synthetic people. Create the patients in
the web app first (that registers their tags), calibrate on camera `sim-1`, then start a session.
Script words: `--script "good*6,shallow,lean,bounce"`; `--no-tag` makes an unidentified person.


## Tests

```powershell
py -m pytest -s tests
```
Includes an end-to-end test: three simulated laptops with skewed clocks, two people,
tags shown early/late/never, over real HTTP to a real hub.
