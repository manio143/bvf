#!/usr/bin/env python3
"""Record the BVF animation HTML as a 20s single-cycle video."""
import subprocess, time, os

FRAMES_DIR = "/tmp/bvf-frames"
HTML_PATH = "file:///home/node/.openclaw/workspace/projects/bvf/animation/bvf-flow.html"
OUTPUT = "/home/node/.openclaw/workspace/projects/bvf/animation/bvf-flow.mp4"
FPS = 30
TOTAL_SECONDS = 21
WIDTH = 980
HEIGHT = 640

os.makedirs(FRAMES_DIR, exist_ok=True)
for f in os.listdir(FRAMES_DIR):
    os.remove(os.path.join(FRAMES_DIR, f))

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
    page.goto(HTML_PATH)

    # Kill auto-advance completely
    page.evaluate("clearInterval(timer); advance = function(){}")
    page.wait_for_timeout(300)

    total_frames = FPS * TOTAL_SECONDS
    interval_ms = 1000 / FPS

    # Schedule: ~3.2s per stage = ~96 frames, 6 stages = 576, plus ~1s hold at end
    stage_frames = int(FPS * 3.2)
    frame = 0

    for stage in range(6):
        page.evaluate(f"goTo({stage}); clearInterval(timer)")
        for _ in range(stage_frames):
            path = os.path.join(FRAMES_DIR, f"frame_{frame:05d}.png")
            page.screenshot(path=path)
            page.wait_for_timeout(int(interval_ms))
            frame += 1
            if frame % 90 == 0:
                print(f"Captured frame {frame}/{total_frames}")

    # Hold final stage for remaining frames
    while frame < total_frames:
        path = os.path.join(FRAMES_DIR, f"frame_{frame:05d}.png")
        page.screenshot(path=path)
        page.wait_for_timeout(int(interval_ms))
        frame += 1

    browser.close()

print(f"Captured {frame} frames. Stitching...")
subprocess.run([
    "ffmpeg", "-y",
    "-framerate", str(FPS),
    "-i", os.path.join(FRAMES_DIR, "frame_%05d.png"),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "fast",
    "-crf", "23",
    OUTPUT
], check=True)
print(f"Done: {OUTPUT}")
