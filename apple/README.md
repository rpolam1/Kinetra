# Kinetra heart-rate app (iPhone and Apple Watch)

Streams heart rate from an Apple Watch to the Kinetra hub during an exercise session. The hub merges it with the camera data for the same person, so the technician sees it live on the board and it appears in the progress reports.

## What you need

- A Mac with Xcode 15 or newer (Apple Watch apps can only be built on a Mac). Any Mac works, including a friend's. Your own Apple ID is used for signing, not the Mac owner's.
- An iPhone running iOS 17 or newer and an Apple Watch running watchOS 10 or newer, paired together.
- A free Apple ID. A free account signs the app for 7 days, then it must be reinstalled.

## Check the code builds (no Mac needed)

Push the repo to GitHub. The "apple build" workflow compiles the iPhone and Watch apps, runs the unit tests and, when it passes, publishes the artifact `Kinetra-Xcode-project`: the whole `apple` folder with `Kinetra.xcodeproj` already generated. If it fails, open the run, read the "Compiler errors" summary and send it to Claude.

## Build on the Mac

1. Get the project onto the Mac: download the `Kinetra-Xcode-project` artifact from the Actions run and unzip it, or clone the repo and use the `apple` folder.
2. If the folder has no `Kinetra.xcodeproj`, double-click `Open-in-Xcode.command` (right-click and Open the first time). It downloads XcodeGen, generates the project and opens it. If macOS blocks the script, run `bash Open-in-Xcode.command` in Terminal from the `apple` folder.
3. In Xcode open Settings, then Accounts, and add your own Apple ID.
4. Click the Kinetra project, then for each of the Kinetra, KinetraWatch and KinetraTests targets open Signing & Capabilities and choose your Personal Team. If a bundle identifier is reported as taken, change `org.kinetra` in `project.yml` to something unique, keeping the watch identifier as the phone identifier plus `.watchkitapp`, then run the script again.
5. Turn on Developer Mode on the iPhone (Settings, Privacy & Security) and on the Watch. Plug the iPhone into the Mac.
6. Select the Kinetra scheme, choose your iPhone and press Run. Xcode installs the watch app through the phone.
7. On the iPhone trust your developer profile (Settings, General, VPN & Device Management).

Run the tests with Cmd+U (they cover the hub JSON contract, address parsing and the heart-rate maths).

## Using it

Set up once (technician):
1. Make sure the hub is running and the phone is on the same Wi-Fi network.
2. Open Kinetra on the iPhone, enter the hub address (for example `jetson.local`) and the access key if the hub has one, then tap Connect. Allow Local Network access when iOS asks.

For each person:
1. The iPhone lists everyone registered with an AprilTag, people in today's session first. Each row shows the tag image, so the person can match it to the tag they will wear. Tap the person.
2. Put the watch on the person. Tap Start on Apple Watch. The watch app opens and starts a workout. If it does not open, tap Start on the watch.
3. Allow heart-rate access on the watch the first time.
4. The board shows a heart icon with the current BPM and a short message about the target zone on that person's tile. A very high heart rate turns the tile red with "Check on them".
5. To stop, tap End on the watch, or End workout on the iPhone.

The watch can also pick a person itself (Change person) once it has been set up from the phone.

## How it fits together

- The watch runs a workout session so heart rate is measured continuously, even when the screen is off, and posts batches of readings to `POST /api/vitals` every two seconds. Readings that cannot be sent are kept and sent when the hub is reachable again.
- The target zone is calculated in the web app from the patient's age or measured maximum, resting heart rate and the prescribed intensity (heart-rate reserve), and sent to the hub when the session starts. Patients on beta blockers show heart rate for reference only.
- The hub returns the current status with every post, so the watch can show whether the person is in the zone and tap their wrist when they go above it.
- The workout is not saved to the watch's Health data (clinic watches are shared). Change `WorkoutManager.saveToHealth` to keep it.

## Notes

- Wrist heart-rate sensors can be inaccurate during vigorous arm movement. The readings support coaching and are not a medical measurement.
- If the hub is on a Jetson with mDNS, `jetson.local` works on the phone. The app also remembers the hub's IP address and passes it to the watch, which cannot always resolve `.local` names.
- The app has not been compiled in the environment where it was written. Expect to fix a small number of compiler errors on first build and send them back.
