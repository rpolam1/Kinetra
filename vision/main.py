"""Command line tool to calibrate one patient and exercise on a single webcam, or to score live without the camera client."""
import argparse
import json
import time

import cv2

from formcheck.paths import EXERCISES_PATH
from formcheck.pose_extractor import PoseExtractor
from formcheck.feature_extractor import FeatureExtractor
from formcheck.template_manager import TemplateManager
from formcheck.quality_judge import QualityJudge
from formcheck.rep_segmenter import RepSegmenter
from formcheck.form_scorer import build_profile, calibration_warnings


def load_exercise_configs(path=EXERCISES_PATH):
    with open(path, "r") as f:
        return json.load(f)


def _overlay_tracking_text(frame, landmarks, feature):
    if landmarks is None:
        cv2.putText(frame, "NO PERSON DETECTED", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        return
    if feature is None:
        cv2.putText(frame, "Person detected, but required joints not visible",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 140, 255), 2)
        return
    cv2.putText(frame, f"Angle: {feature['primary_angle']:.1f} deg", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)


def _overlay_last_judgment(frame, judgment_text):
    if judgment_text:
        cv2.putText(frame, judgment_text, (10, 65),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 0), 2)


def _overlay_gate_text(frame, issue_lines):
    for i, line in enumerate(issue_lines or []):
        cv2.putText(frame, line[:70], (10, 95 + i * 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 255), 1)


def _overlay_rep_counts(frame, good_count, bad_count, total_count):
    cv2.putText(frame, f"Good: {good_count}", (10, 160),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.putText(frame, f"Bad: {bad_count}", (150, 160),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    cv2.putText(frame, f"Total: {total_count}", (280, 160),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)


def run_calibration(cap, pose_extractor, feature_extractor, template_manager,
                     patient_id, exercise_name, exercise_config, num_reps=5, link=None):
    """Capture num_reps reps from the webcam and save them as a template. Warnings about the calibration are printed, and the template is uploaded to the hub when one is available."""
    print(f"Calibration mode: perform {num_reps} good, CONSISTENT reps of '{exercise_name}'.")
    print("Make sure your FULL BODY is visible (head to feet). Start from a still, "
          "relaxed position and pause briefly at the start.")

    segmenter = RepSegmenter(
        mode="rep_based",
        min_angle_range_deg=exercise_config.get("min_rom_deg", 15.0),
        rest_direction=exercise_config.get("rest_direction"),
    )
    captured_reps = []

    while len(captured_reps) < num_reps:
        ret, frame = cap.read()
        if not ret:
            break

        landmarks = pose_extractor.process(frame)
        feature = feature_extractor.extract(landmarks, frame.shape)
        segmenter.add_sample(feature)

        for rep_samples in segmenter.extract_completed_reps():
            captured_reps.append(rep_samples)
            print(f"  Captured rep {len(captured_reps)}/{num_reps}")

        display_frame = pose_extractor.draw(frame, landmarks)
        _overlay_tracking_text(display_frame, landmarks, feature)
        cv2.putText(display_frame, f"Calibration reps: {len(captured_reps)}/{num_reps}", (10, 65),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
        cv2.imshow("Calibration (press q to abort)", display_frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    captured_reps = captured_reps[:num_reps]
    if not captured_reps:
        print("No reps captured -- calibration aborted.")
        return

    template_manager.save_template(patient_id, exercise_name, captured_reps)
    print(f"Template saved with {len(captured_reps)} rep(s).")
    template = template_manager.load_template(patient_id, exercise_name)
    profile = build_profile(template, exercise_config)
    for warning in calibration_warnings(profile):
        print(f"  Warning: {warning}")
    if link is not None:
        if not link.base:
            link.discover(force=True)
        ok = link.push_template(patient_id, exercise_name, template)
        print("  Uploaded to hub -- every laptop can now score this patient."
              if ok else "  Could not reach the hub; template kept locally only.")


def _print_debug_table(details):
    """Per-metric comparison for one rep. Metrics outside the tolerance are marked with an arrow."""
    print(f"    {'metric':26s} {'rep':>9s} {'calib':>9s} {'tol':>8s} {'dev':>6s} {'w':>4s}")
    for d in details[:12]:
        flag = " <--" if d["dev"] > 1 else ""
        print(f"    {d['metric']:26s} {d['value']:9.3f} {d['calib_mean']:9.3f} "
              f"{d['tol']:8.3f} {d['dev']:6.2f} {d['weight']:4.1f}{flag}")


def run_live_tracking(cap, pose_extractor, feature_extractor, judge):
    """Score reps live from the webcam until q is pressed, drawing the results on screen."""
    print("Live tracking started. Press 'q' to stop.")
    last_judgment_text = ""
    last_gate_text = []
    good_count = 0
    bad_count = 0
    total_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        landmarks = pose_extractor.process(frame)
        feature = feature_extractor.extract(landmarks, frame.shape)

        if feature is not None:
            for judgment in judge.process_feature(feature):
                details = judgment.pop("details", None)
                print(judgment)
                if details:
                    _print_debug_table(details)

                if judgment.get("type") == "rep":
                    total_count += 1
                    label = judgment.get("label")

                    if label == "good_form":
                        good_count += 1
                    elif label in ("needs_correction", "flag_for_instructor"):
                        bad_count += 1

                    if judgment.get("score") is not None:
                        last_judgment_text = f"Score: {judgment['score']} ({label})"
                        issues = judgment.get("issues") or []
                        last_gate_text = issues[:2] if issues else ["All checks within calibration range"]
                    else:
                        last_judgment_text = f"label: {label}"
                        last_gate_text = []

        display_frame = pose_extractor.draw(frame, landmarks)
        _overlay_tracking_text(display_frame, landmarks, feature)
        _overlay_last_judgment(display_frame, last_judgment_text)
        _overlay_gate_text(display_frame, last_gate_text)
        _overlay_rep_counts(display_frame, good_count, bad_count, total_count)
        cv2.imshow("Live tracking (press q to stop)", display_frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    print(f"\nSession summary: {good_count} good, {bad_count} bad, {total_count} total reps.")


def main():
    """Parse the arguments, load the template if there is one and run calibration or live tracking."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--patient", required=True, help="Patient ID")
    parser.add_argument("--exercise", required=True,
                         help="Exercise name (must match a key in config/exercises.json (repo root))")
    parser.add_argument("--calibrate", action="store_true",
                         help="Run calibration instead of live tracking")
    parser.add_argument("--camera-id", default=None,
                         help="calibrate/score using THIS camera's own template (recommended when "
                              "several laptops view from different angles); must match the "
                              "--camera-id used by client.py on that laptop")
    parser.add_argument("--hub", default="auto",
                         help="hub URL; default 'auto' finds the hub on the network by itself "
                              "(templates are uploaded after calibration / downloaded when missing)")
    parser.add_argument("--no-hub", action="store_true", help="don't look for a hub (offline)")
    parser.add_argument("--api-key", default=None, help="hub API key (or env HUB_API_KEY)")
    parser.add_argument("--debug", action="store_true",
                         help="Print a per-metric comparison table after every rep")
    args = parser.parse_args()

    exercise_configs = load_exercise_configs()
    if args.exercise not in exercise_configs:
        raise ValueError(f"Unknown exercise '{args.exercise}'. Check config/exercises.json.")
    exercise_config = exercise_configs[args.exercise]
    slot = f"{args.exercise}@{args.camera_id}" if args.camera_id else args.exercise

    link = None
    if not args.no_hub:
        import os
        from formcheck.hub_client import HubLink
        link = HubLink(args.hub, "main-cli", api_key=args.api_key or os.environ.get("HUB_API_KEY"))
        print("Looking for the hub on the network...")
        if link.discover(force=True):
            link.sync_clock(2)
            print(f"Connected to hub {link.base}")
        else:
            print("No hub found -- continuing offline (use --no-hub to skip this search).")

    pose_extractor = PoseExtractor()
    feature_extractor = FeatureExtractor(exercise_config)
    template_manager = TemplateManager()

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Could not open webcam.")

    try:
        if args.calibrate:
            run_calibration(cap, pose_extractor, feature_extractor,
                             template_manager, args.patient, slot,
                             exercise_config, link=link)
        else:
            template = None
            for name in dict.fromkeys([slot, args.exercise]):  # own camera first, then shared
                template = template_manager.load_template(args.patient, name)
                if template is None and link is not None:
                    template = link.fetch_template(args.patient, name)
                    if template is not None:
                        template_manager.store_template(args.patient, name, template)
                        print("Downloaded calibration template from the hub.")
                if template is not None:
                    break
            if template is None:
                print("Warning: no calibration template found -- reps will be "
                      "segmented but not scored. Run with --calibrate first.")
            judge = QualityJudge(exercise_config, template, debug=args.debug)
            run_live_tracking(cap, pose_extractor, feature_extractor, judge)
    finally:
        cap.release()
        cv2.destroyAllWindows()
        pose_extractor.close()


if __name__ == "__main__":
    main()