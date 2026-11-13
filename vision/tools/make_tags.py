"""Writes AprilTag images for the given ids so they can be printed."""
import argparse
import os
import sys

import cv2

# The parent folder is added so the formcheck package can be imported when this is run directly
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from formcheck.identity import TagDetector


def parse_ids(items):
    """Turn arguments such as 1 2 5-7 into a list of tag ids."""
    ids = []
    for it in items:
        if "-" in it:
            a, b = it.split("-")
            ids.extend(range(int(a), int(b) + 1))
        else:
            ids.append(int(it))
    return ids


def main():
    """Write one image per tag id."""
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+", help="tag ids, e.g. 1 2 3 or 1-10")
    ap.add_argument("--size", type=int, default=600, help="pixels (before the white border)")
    ap.add_argument("--out", default="tags")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for tag_id in parse_ids(args.ids):
        path = os.path.join(args.out, f"tag_{tag_id:03d}.png")
        cv2.imwrite(path, TagDetector.make_tag_image(tag_id, args.size))
        print("wrote", path)


if __name__ == "__main__":
    main()
