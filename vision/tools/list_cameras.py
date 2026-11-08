"""Try camera numbers 0-5, report what each one gives, and save a still from each (cam_N.jpg)."""
import argparse
import sys
import time

import cv2


def probe(index, backend=None):
    cap = cv2.VideoCapture(index) if backend is None else cv2.VideoCapture(index, backend)
    if not cap.isOpened():
        cap.release()
        return None
    frame = None
    for _ in range(15):  # cameras need a few frames to settle their exposure
        ok, f = cap.read()
        if ok and f is not None:
            frame = f
        time.sleep(0.05)
    cap.release()
    return frame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=6, help="highest camera number to try (exclusive)")
    args = ap.parse_args()

    backends = [("default", None)]
    if sys.platform.startswith("win"):
        backends.append(("directshow", cv2.CAP_DSHOW))

    for name, backend in backends:
        print(f"--- backend: {name}")
        for i in range(args.max):
            frame = probe(i, backend)
            if frame is None:
                print(f"camera {i}: cannot open, or gives no picture")
                continue
            h, w = frame.shape[:2]
            mean, peak = float(frame.mean()), int(frame.max())
            verdict = "BLACK (probably an infrared or virtual camera)" if peak < 10 else "ok"
            print(f"camera {i}: {w}x{h}  brightness {mean:.0f}/255  {verdict}")
            cv2.imwrite(f"cam_{i}_{name}.jpg", frame)
    print("Open the cam_*.jpg files to see which number is which camera.")


if __name__ == "__main__":
    main()