# Kinetra: web app

React + TypeScript + Tailwind front end for instructors. It creates patient profiles, assigns the
AprilTag the cameras recognise, prescribes exercises (versioned), and talks to the vision **hub**
(`server/hub.py`). Cloud data lives in **Firebase**; a built-in demo mode needs no Firebase at all.

## Status

| Built and tested |
|---|
| **Accounts:** anyone can sign up as a volunteer or instructor; only an admin approves, changes roles or switches accounts off |
| **Board for 15 to 30 people:** tiles resize to the screen; larger rosters rotate in pages |
| Patient create / edit / archive, full intake form with validation |
| Fast search (name prefix, `P-0042`, `#12`), cached, capped at 20 rows |
| Automatic AprilTag + patient code, printable tag, hub registration |
| 61-exercise library shared with the vision system |
| Versioned prescriptions: reason required, history, restore, session checklist, safety warnings |
| **Calibration page:** live skeleton, per-rep replay, keep / redo, finish; a cloud record per exercise and camera |
| **Live session monitor:** roster from prescriptions, a status light per person, advance, auto-advance, end and save |
| **Board for the TV** (`#/board`, no sign-in): board names and current exercise only |
| **Session history and trends** on the patient page |

Not built: remote (at-home) sessions.

## Run it (demo mode, no Firebase needed)

```powershell
cd web
npm install
npm run build                 # produces web/dist
cd ..\vision
py -m server.hub              # the hub serves ../web/dist: open the address it prints
```
Sign in with a demo account (the login page lists them). Demo data stays in that browser.

For development with hot reload: run the hub (`py -m server.hub` from `vision/`), then in `web/`
`set VITE_HUB_URL=http://localhost:5000` (PowerShell: `$env:VITE_HUB_URL="http://localhost:5000"`) and `npm run dev`.

Node 20.19+ is required (Vite 7).

## Use real cloud storage (Firebase)

1. **Create a project** at <https://console.firebase.google.com>.
2. **Firestore Database → Create**, production mode, and pick a **Canadian location**
   (`northamerica-northeast1` Montréal or `northamerica-northeast2` Toronto). It cannot be changed later.
3. **Authentication → Sign-in method → Email/Password → Enable.** Staff create their own accounts on the sign-up page, so you do not add them by hand.
4. **Project settings → Your apps → Web app**: copy the config values into `web/.env.local`
   (copy `.env.example`; this file is git-ignored) and set `VITE_DATA_BACKEND=firebase`.
5. **Deploy the security rules** (`firebase.json` is already configured):
   `npm i -g firebase-tools && firebase login && firebase use <project-id> && firebase deploy --only firestore`
6. **Create the first administrator.** Project settings → Service accounts → *Generate new private key*.
   Store that file **outside this repository**, then (this creates the sign-in and the `users` record in one go):
   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure\service-account.json"
   node scripts/set-role.mjs first.admin@clinic.ca admin --password "choose-a-long-one"
   ```
   Everyone else signs up on the login page and an admin approves them (see below).

## Accounts and approval

* **Sign up:** anyone can create an account and ask to be a **volunteer** or an **instructor**. A new account has
  *no access* until it is approved: it sees a waiting screen, and the page updates by itself the moment an admin decides.
* **Admins decide everything:** the **Team** page lists requests first. An admin approves (choosing the role),
  declines, changes a role, or switches an account off and on. Admins cannot change their own record.
* **Becoming an admin:** an instructor opens **Account** and asks for administrator access; it shows up on the Team
  page as an upgrade request. Volunteers can ask to become instructors the same way.
* **Where it is stored:** `users/{uid}` in Firestore (role, status, requested role, who decided and when). Roles are read
  from that document, not from sign-in claims, so a change applies immediately without signing out.
* **Enforced by the rules, not the page:** `firestore.rules` stops people from writing their own role or status; they may
  only create their pending record and ask for a role. Deploy the rules (step 5) before real use.

## Design system

* Colours, radii and shadows are tokens in `src/index.css` (`@theme static`): the `slate` and `teal` ramps are replaced with
  the clinic palette, plus `ink-*` (dark chrome) and `clay-*` (accent). Change a token and the whole app follows.
* Icons: Font Awesome Free (solid), through one registry (`src/ui/icons.ts`) and one component (`src/ui/Icon.tsx`).
  Use `<Icon name="..."/>`; do not paste emoji or glyphs. Add a name to the registry to use a new icon.
* Motion: GSAP is imported only in `src/ui/motion/gsap.ts`. Elements marked `data-rise` fade up on entry, and
  `data-hover="lift|button|row|nav"` gives hover and press motion everywhere. Motion is skipped for people who prefer reduced motion.
* **Logo:** put your white logo at `web/public/logo.png`. It is used on the sidebar, sign-in screen and board
  (`src/ui/Logo.tsx`); a text mark shows if the file is missing. The file in the repo is a placeholder.
* **Board sizing:** `src/features/session/boardLayout.ts` picks the grid that makes tiles as large as possible for the
  screen, up to 30 per page (more rotate every 12 seconds). Text sizes scale with each tile using CSS container units,
  and optional lines (prescription, next exercise) hide only when a tile is too short to read them.

## Environment variables

Read in one place, `src/config/env.ts`. Nothing secret is in the code.

| Variable | Meaning |
|---|---|
| `VITE_DATA_BACKEND` | `memory` (demo, default) or `firebase` |
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | Firebase web config (identifies the project; the security rules are what protect data) |
| `VITE_HUB_URL` | Hub address. Leave empty when the hub serves the app |
| `GOOGLE_APPLICATION_CREDENTIALS` | Only for `scripts/set-role.mjs` (creates the first admin): path to the service-account key |
| `HUB_API_KEY` | Set on the **hub** to require a key. The browser takes it from **Settings** and keeps it in that browser only, so it is never in the build |

## Structure and conventions

```
src/
  domain/        pure TypeScript rules: types, validation, dosage maths, exercises, permissions
  data/          repository interfaces + memory backend + firebase backend + cache decorator
  services/hub/  typed client for the Python hub's REST API
  app/           router, providers (data, auth, hub, toast), hooks, app shell
  ui/            small reusable components (Button, fields, Card, Badge, Alert)
  features/      one folder per screen: patients/, prescriptions/, settings/, session/, auth/, admin/
```

* **Dependency direction:** `features → app / ui / data / domain`; `data → domain`; `domain` imports nothing.
  Firebase is imported only inside `data/firebase/`, and loaded lazily, so demo builds never need it.
* **Single source of truth for exercises:** `../config/exercises.json` (repo root `config/`) (also read by the Python vision
  system). Adding an exercise is one JSON entry.
* **Naming:** components and classes `PascalCase.tsx`; functions, hooks and variables `camelCase`;
  constants `UPPER_SNAKE_CASE`; tests `*.test.ts`. Booleans read as questions (`canEdit`, `isValid`).
* **Style:** strict TypeScript, no `any`, `import type` for types, Prettier (`npm run format`), ESLint (`npm run lint`).
* **Errors:** repositories throw `DataError` with a `code`; UI reacts to the code, never to message text.

## Data model (Firestore)

* `users/{uid}`: one account: email, name, `role`, `status` (pending / approved / rejected / disabled), `requestedRole`, `awaiting`, decision audit fields.
* `patients/{id}`: the profile (see `src/domain/types.ts`). Age is derived, never stored. `nameKey` /
  `nameKeyAlt` are normalised "last first" / "first last" strings used for prefix search.
* `patients/{id}/prescriptions/v0001…`: append-only versions; a save writes a new document and marks the
  previous one `superseded` in the same transaction.
* `patients/{id}/sessions/{sessionId}`: one small document per patient per session (exercise results:
  reps, sets, good / needs-correction / flagged counts, average form score). History is one indexed read.
* `patients/{id}/calibrations/{exercise@camera}`: when each exercise was last calibrated, on which camera,
  from how many reps. (The template itself lives on the hub, which scores with it.)
* `meta/registry`: next patient number and every AprilTag assignment, so a code and the lowest free tag
  (0 to 586) are handed out in one transaction. Archiving frees the tag; patient codes are never reused.
* **Search cost:** at most two indexed range queries per search (or one lookup for a code / tag), capped at 20
  rows, debounced 300 ms, ignored below 2 characters, and cached; a write clears the cache. No composite
  indexes are needed (`firestore.indexes.json` is intentionally empty).

## Privacy and security

* Rules (`firestore.rules`): approved staff only; volunteers read-only; only admins write `users` roles and status; identity fields cannot be rewritten;
  prescription versions cannot be edited or deleted; patients are never deleted (archive instead).
* Only intake data the programme uses is collected. Camera tracking stores skeleton points only, never video.
* The public board uses a **board name** (first name + initial by default), never medical data.
* This is health information about older adults in Ontario, so privacy law (PHIPA) very likely applies. This
  project does not make you compliant by itself: confirm your obligations, agreements and Firebase configuration
  with CCCARE's privacy officer or your course's ethics process before using real patient data.

## Live features: how they work

* The browser opens **one** Server-Sent-Events connection per page (`src/services/hub/sse.ts`; it uses
  `fetch` so the API key can be sent as a header, and reconnects with backoff). Every message is a full
  snapshot, so a slow tab just jumps to the newest.
* Calibration: `POST /api/calibration` starts a job; the camera that claims it streams the live skeleton
  and uploads each rep with a short replay; **Keep / Redo** call the hub; **Finish** builds the template on the
  hub and the page saves a record to Firestore.
* Sessions: the roster's prescriptions become the hub session plan (`planFromPrescription`). When the
  session ends the hub returns a summary and the page saves one record per patient. If the cloud is
  unreachable the summary is kept on screen with a *Retry saving* button (re-saving is safe).
* The board reads only from the hub, so the TV needs no account; protect the hub with an API key in
  Settings if the network is shared.

## Tests

```powershell
npm test                      # unit + integration tests (domain, accounts, board layout, data layer, router, hub client, live stream, replay, roster)
npm run typecheck
npm run build && npx playwright install chromium
npm run test:e2e              # real hub + simulated camera + real browser: patients, calibration, live session, board, history
```
`tests/hubApi.test.ts` and the e2e run the **real Python hub** (needs `pip install -r ../vision/requirements.txt`;
set `PYTHON=python` if `python3` is not your command). The e2e uses demo data mode and the Python fake camera
(`vision/tools/simulate_camera.py`), so no webcam is needed. `node scripts/bundle-e2e.mjs <dir>` makes an unstyled
bundle for it when the full Vite build is unavailable.

## Verified and not verified

Verified by the automated tests above: all business rules, sign-up and approval in the demo backend, both the in-memory data layer and its caching,
the hub client against the real hub, and the whole user workflow in Chromium (including hub restart
recovery, role restrictions and board layouts of 15 to 33 people).