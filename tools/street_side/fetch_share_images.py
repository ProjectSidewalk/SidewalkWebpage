#!/usr/bin/env python3
"""Pick the worked-example labels and fetch their share images (the label's crop with the marker composited).

analyze_street_side.py ranks up to twelve candidates per case in out/case_candidates.csv, closest to the candidate
set's median distance first. Older labels often have no stored crop, and the public share image is the only
imagery endpoint that needs no login, so this host-side step (network) walks each case's candidates in rank order
and keeps the first whose share image comes back, writing out/cases.csv and out/crops/<label_id>.jpg for
case_maps.py. Stdlib only, so it runs on the host: python3 tools/street_side/fetch_share_images.py
"""
import csv
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
CROPS = OUT / "crops"


def share_image(label_id):
    """The share image bytes, or None when the server has neither a crop nor a Street View still for the label."""
    req = urllib.request.Request(f"https://sidewalk-sea.cs.washington.edu/label/{label_id}/image",
                                 headers={"User-Agent": "street-side-experiment/2886"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
            return body if resp.headers.get_content_type().startswith("image/") else None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def has_crop(label_id, label_type):
    """Whether the server holds a stored crop for the label (its metadata endpoint is public even though the crop is
    not). The share image is cover-scaled from the crop (1440x960) or, without one, from a 640x480 Street View
    still, and the two put the marker at different heights, so case_maps.py needs to know which."""
    req = urllib.request.Request(f"https://sidewalk-sea.cs.washington.edu/cropImage/{label_type}/{label_id}/metadata",
                                 headers={"User-Agent": "street-side-experiment/2886"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.headers.get_content_type() == "application/json"
    except urllib.error.HTTPError:
        return False


def main():
    CROPS.mkdir(exist_ok=True)
    with open(OUT / "case_candidates.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    chosen = []
    for case in dict.fromkeys(r["case"] for r in rows):
        cands = sorted((r for r in rows if r["case"] == case), key=lambda r: int(r["rank"]))
        for r in cands:
            img = share_image(r["label_id"])
            if img is None:
                print(f"{case}: label {r['label_id']} (rank {r['rank']}) has no share image", file=sys.stderr)
                continue
            (CROPS / f"{r['label_id']}.jpg").write_bytes(img)
            r["has_crop"] = has_crop(r["label_id"], r["label_type"])
            chosen.append(r)
            print(f"{case}: label {r['label_id']} (rank {r['rank']}), {len(img)} bytes")
            break
        else:
            sys.exit(f"{case}: no candidate has a share image")
    with open(OUT / "cases.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) + ["has_crop"])
        w.writeheader()
        w.writerows(chosen)


if __name__ == "__main__":
    main()
