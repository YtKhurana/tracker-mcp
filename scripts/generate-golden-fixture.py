#!/usr/bin/env python3
"""Generate the repository-owned Tracker v1 golden-fixture inputs."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import platform
from pathlib import Path

import cv2
import numpy as np


FIXTURE_ID = "synthetic-parabola-v1"
WIDTH = 320
HEIGHT = 240
FRAME_COUNT = 12
FPS = 10.0
ORIGIN_X = 96.0
ORIGIN_Y = 168.0
ANGLE_RAD = math.pi / 6
SCALE = 40.0


def mark_for_frame(frame: int) -> dict[str, int]:
    return {
        "frame": frame,
        "x": 48 + 10 * frame + frame * frame,
        "y": 190 - 7 * frame,
    }


def validate_marks(marks: list[dict[str, int]]) -> None:
    frames = [mark["frame"] for mark in marks]
    if len(frames) != len(set(frames)):
        raise ValueError("duplicate fixture frame")
    for mark in marks:
        if not 0 <= mark["frame"] < FRAME_COUNT:
            raise ValueError(f"out-of-range fixture frame: {mark['frame']}")
        if not all(math.isfinite(mark[key]) for key in ("x", "y")):
            raise ValueError(f"non-finite fixture mark at frame {mark['frame']}")
        if not 0 <= mark["x"] < WIDTH or not 0 <= mark["y"] < HEIGHT:
            raise ValueError(f"fixture mark lies outside video at frame {mark['frame']}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def frame_image(mark: dict[str, int]) -> np.ndarray:
    image = np.full((HEIGHT, WIDTH, 3), 24, dtype=np.uint8)
    for x in range(0, WIDTH, 40):
        cv2.line(image, (x, 0), (x, HEIGHT - 1), (52, 52, 52), 1)
    for y in range(0, HEIGHT, 40):
        cv2.line(image, (0, y), (WIDTH - 1, y), (52, 52, 52), 1)

    center = (mark["x"], mark["y"])
    cv2.circle(image, center, 9, (0, 220, 255), -1, lineType=cv2.LINE_8)
    cv2.line(image, (center[0] - 13, center[1]), (center[0] + 13, center[1]), (255, 255, 255), 1)
    cv2.line(image, (center[0], center[1] - 13), (center[0], center[1] + 13), (255, 255, 255), 1)
    return image


def world_values(frame: int, image_x: float, image_y: float) -> tuple[float, float, float, float]:
    """Independent expected transform for the fixed fixture coordinates."""
    cosine = math.cos(ANGLE_RAD)
    sine = math.sin(ANGLE_RAD)
    dx = image_x - ORIGIN_X
    dy = image_y - ORIGIN_Y
    world_x = (cosine * dx - sine * dy) / SCALE
    world_y = (-sine * dx - cosine * dy) / SCALE

    image_vx = (10 + 2 * frame) * FPS
    image_vy = -7 * FPS
    world_vx = (cosine * image_vx - sine * image_vy) / SCALE
    world_vy = (-sine * image_vx - cosine * image_vy) / SCALE
    return world_x, world_y, world_vx, world_vy


def fourcc_string(value: float) -> str:
    encoded = int(value)
    return "".join(chr((encoded >> (8 * index)) & 0xFF) for index in range(4))


def generate(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    marks = [mark_for_frame(frame) for frame in range(FRAME_COUNT)]
    validate_marks(marks)

    images: list[np.ndarray] = []
    frame_paths: list[Path] = []
    for mark in marks:
        image = frame_image(mark)
        frame_path = frames_dir / f"frame-{mark['frame']:04d}.png"
        if not cv2.imwrite(str(frame_path), image):
            raise RuntimeError(f"could not write {frame_path}")
        images.append(image)
        frame_paths.append(frame_path)

    video_path = output_dir / "synthetic-parabola.mp4"
    writer = cv2.VideoWriter(
        str(video_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        FPS,
        (WIDTH, HEIGHT),
    )
    if not writer.isOpened():
        raise RuntimeError("OpenCV could not open an mp4v VideoWriter")
    try:
        for image in images:
            writer.write(image)
    finally:
        writer.release()

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError("OpenCV could not reopen the generated video")
    try:
        decoded = {
            "width": int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "frame_count": int(capture.get(cv2.CAP_PROP_FRAME_COUNT)),
            "fps": capture.get(cv2.CAP_PROP_FPS),
            "fourcc": fourcc_string(capture.get(cv2.CAP_PROP_FOURCC)),
        }
    finally:
        capture.release()
    expected_decoded = {
        "width": WIDTH,
        "height": HEIGHT,
        "frame_count": FRAME_COUNT,
        "fps": FPS,
    }
    for key, expected in expected_decoded.items():
        if decoded[key] != expected:
            raise RuntimeError(f"generated video {key}={decoded[key]!r}, expected {expected!r}")

    analytical_path = output_dir / "analytical-expected.csv"
    with analytical_path.open("w", encoding="utf-8", newline="") as handle:
        fieldnames = ["frame", "t", "x", "y", "vx", "vy"]
        csv_writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        csv_writer.writeheader()
        for mark in marks:
            world_x, world_y, world_vx, world_vy = world_values(mark["frame"], mark["x"], mark["y"])
            csv_writer.writerow(
                {
                    "frame": mark["frame"],
                    "t": f"{mark['frame'] / FPS:.9f}",
                    "x": f"{world_x:.12f}",
                    "y": f"{world_y:.12f}",
                    "vx": f"{world_vx:.12f}",
                    "vy": f"{world_vy:.12f}",
                }
            )

    frame_digest = hashlib.sha256()
    for frame_path in frame_paths:
        frame_digest.update(bytes.fromhex(sha256(frame_path)))

    manifest = {
        "fixture_id": FIXTURE_ID,
        "provenance": {
            "kind": "deterministic_synthetic_media",
            "rights": "CC0-1.0",
            "description": "Generated moving-dot test media; no third-party footage.",
        },
        "generator": {
            "script": "scripts/generate-golden-fixture.py",
            "python": platform.python_version(),
            "numpy": np.__version__,
            "opencv": cv2.__version__,
        },
        "video": {
            "path": "synthetic-parabola.mp4",
            "width": WIDTH,
            "height": HEIGHT,
            "frame_count": FRAME_COUNT,
            "fps": FPS,
            "frame_interval_seconds": 1 / FPS,
            "encoded": {
                "container": "mp4",
                "codec_requested": "mp4v",
                "codec_reported_after_decode": decoded["fourcc"],
            },
        },
        "calibration": {
            "frame": 0,
            "origin_x": int(ORIGIN_X),
            "origin_y": int(ORIGIN_Y),
            "angle_rad": ANGLE_RAD,
            "scale_px_per_world_unit": SCALE,
            "length_unit": "m",
        },
        "track": {
            "name": "synthetic mass",
            "type": "point_mass",
            "mass": 1.0,
            "marks": marks,
        },
        "mutation_cases": {
            "gap": {"clear_frames": [5, 6]},
            "correction": {"frame": 7, "replacement": {"x": 180, "y": 137}},
        },
        "references": {
            "analytical": {
                "path": "analytical-expected.csv",
                "status": "not_official_tracker_oracle",
                "notes": "Positions and continuous polynomial velocities; Tracker finite-difference endpoints may differ.",
            },
            "official": {
                "status": "pending_human_tracker_checkpoint",
                "csv_path": None,
                "trz_path": None,
            },
        },
        "artifacts": {
            "synthetic-parabola.mp4": sha256(video_path),
            "analytical-expected.csv": sha256(analytical_path),
            "frames": frame_digest.hexdigest(),
        },
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "fixtures" / "golden",
    )
    args = parser.parse_args()
    generate(args.output_dir.resolve())


if __name__ == "__main__":
    main()
