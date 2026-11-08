import argparse
import os
import random
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from client import CameraPipeline, load_exercise_configs
from server.hub import default_exercise_config_path
from formcheck import simulation as sim
from formcheck.hub_client import HubLink
from formcheck.template_manager import TemplateManager

TAG_SHOWN_SECONDS = 4.0  # how long each person holds their tag up after starting
TAG_REPEAT_SECONDS = 60.0


def parse_script(text):
    kinds = []
    for word in text.split(","):
        word = word.strip()
        if not word:
            continue
        name, _, count = word.partition("*")
        if name not in ("good", "shallow", "lean", "bounce"):
            raise SystemExit(f"unknown rep kind '{name}' (use good, shallow, lean, bounce)")
        kinds.extend([name] * (int(count) if count else 1))
    if not kinds:
        raise SystemExit("the script is empty")
    return kinds


def person_stream(kinds, seed):
    rng = random.Random(seed)
    while True:
        specs = [sim.good_spec(rng) if k == "good" else sim.bad_spec(rng, k) for k in kinds]
        for _, landmarks in sim.frames(specs, seed=rng.randrange(1 << 30)):
            yield landmarks


def main():
    ap = argparse.ArgumentParser(description="Fake camera for demos and tests")
    ap.add_argument("--camera-id", default="sim-cam", help="name of this fake camera (calibrations are per camera)")
    ap.add_argument("--hub", default="auto", help="hub address, or 'auto' to find it")
    ap.add_argument("--api-key", default=os.environ.get("HUB_API_KEY"))
    ap.add_argument("--patients", default="P-0001", help="comma-separated patient codes in front of the camera")
    ap.add_argument("--exercise", default="goblet_squat", help="exercise everyone does unless the hub assigns one")
    ap.add_argument("--script", default="good", help='rep script, e.g. "good*6,shallow,good*3"')
    ap.add_argument("--no-tag", action="store_true", help="people never show a tag (stay unidentified)")
    ap.add_argument("--duration", type=float, default=0.0, help="stop after this many seconds (0 = run until Ctrl+C)")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    kinds = parse_script(args.script)
    patients = [p.strip() for p in args.patients.split(",") if p.strip()]
    configs = load_exercise_configs(default_exercise_config_path())

    link = HubLink(args.hub, args.camera_id, api_key=args.api_key, log=print)
    print("Looking for the hub...")
    if not link.discover(force=True):
        raise SystemExit("No hub found. Start one with:  py -m server.hub")
    link.start()
    print(f"Connected to {link.base} as camera '{args.camera_id}'")

    pipeline = CameraPipeline(configs, TemplateManager(tempfile.mkdtemp()), link,
                              default_exercise=args.exercise, camera_id=args.camera_id)
    streams = [person_stream(kinds, args.seed + i) for i in range(len(patients))]
    offsets = [(-0.25 + i * 0.5 / max(len(patients) - 1, 1)) if len(patients) > 1 else 0.0 for i in range(len(patients))]
    jitter_rng = random.Random(args.seed)

    start = time.time()
    next_frame = start
    shown_tag_warning = set()
    print("Running. Press Ctrl+C to stop.")
    try:
        while args.duration <= 0 or time.time() - start < args.duration:
            now = time.time()
            elapsed = now - start
            registry = link.state.get("tags") or {}
            tag_of = {entry["patient_id"]: int(tag) for tag, entry in registry.items()}

            poses, tags = [], []
            holding_tag = (elapsed % TAG_REPEAT_SECONDS) < TAG_SHOWN_SECONDS
            for stream, patient, dx in zip(streams, patients, offsets):
                landmarks = sim.shifted(next(stream), dx=dx, jitter=0.001, rng=jitter_rng)
                poses.append(landmarks)
                if holding_tag and not args.no_tag:
                    tag_id = tag_of.get(patient)
                    if tag_id is None:
                        if patient not in shown_tag_warning:
                            shown_tag_warning.add(patient)
                            print(f"  note: {patient} has no tag registered on the hub yet (create the patient in the web app)")
                    else:
                        x, y = sim.chest_px(landmarks)
                        tags.append({"tag_id": tag_id, "center": (x, y - 10), "size": 40})

            pipeline.step(poses, tags, sim.FRAME_SHAPE, now)
            next_frame += 1.0 / sim.FPS
            time.sleep(max(0.0, next_frame - time.time()))
    except KeyboardInterrupt:
        pass
    finally:
        link.close()
        print("Stopped.")


if __name__ == "__main__":
    main()
