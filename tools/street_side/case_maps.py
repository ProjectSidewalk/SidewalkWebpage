#!/usr/bin/env python3
"""Draw each worked example (out/cases.csv, picked by fetch_share_images.py from analyze_street_side.py's
candidates) as a pair: a small map with the audited street and its digitized direction, the neighbouring streets,
SDOT's sidewalk lines and curb-ramp points, the camera, the label, the camera-to-label ray the heading method
reads, and the perpendicular to the centerline the geometric method reads; beside it, the label's share image
(out/crops/<label_id>.jpg), the street-level crop with the marker composited. out/fig_cases.png.

Run inside the web container after analyze_street_side.py and fetch_share_images.py:
    python3.13 tools/street_side/case_maps.py
Connection env is the same as street_side.py (PGHOST / PGDATABASE / PGUSER / PGPASSWORD, --exp for the scratch schema).
"""
import argparse
import json
import math
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.image as mpimg
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
from matplotlib.lines import Line2D
from matplotlib.offsetbox import AnnotationBbox, OffsetImage
import pandas as pd
import psycopg2
from shapely.geometry import LineString, Point, shape

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
C_GEO, C_HEAD, C_THIRD, C_GRAY = "#2a78d6", "#eb6834", "#1baf7a", "#8a8987"
C_STREET, C_AUDITED, C_UNIMPROVED = "#c9c7c2", "#3d3d3b", "#b8b6b2"
RADIUS_M = 70  # how far around the label to fetch context
ICONS = HERE.parents[1] / "public" / "images" / "icons" / "label_type_icons"
# ShareController's geometry: the share image is SHARE_W x SHARE_H, cover-scaled from the stored crop (1440x960) or
# from a 640x480 Street View still, and the label's canvas position (720x480 canvas) maps through the same transform.
SHARE_W, SHARE_H, CANVAS_W, CANVAS_H = 1440, 960, 720, 480


def connect():
    return psycopg2.connect(host=os.environ.get("PGHOST", "db"), dbname=os.environ.get("PGDATABASE", "sidewalk"),
                            user=os.environ.get("PGUSER", "sidewalk_seattle"),
                            password=os.environ.get("PGPASSWORD", "sidewalk"))


def fetch(cur, exp, label_id, edge_id):
    """Everything within RADIUS_M of the label, as GeoJSON, plus the label's own points and its audited edge."""
    cur.execute(f"""
        SELECT ST_AsGeoJSON(label_geom), ST_AsGeoJSON(pano_geom), ST_AsGeoJSON(old_label_geom)
        FROM {exp}.label_base WHERE label_id = %s""", (label_id,))
    label, pano, old = [json.loads(g) if g else None for g in cur.fetchone()]
    cur.execute(f"SELECT ST_AsGeoJSON(geom) FROM {exp}.edge WHERE street_edge_id = %s", (edge_id,))
    audited = json.loads(cur.fetchone()[0])
    cur.execute(f"""
        SELECT street_edge_id, ST_AsGeoJSON(geom) FROM {exp}.edge
        WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)::geography, %s)""",
                (json.dumps(label), RADIUS_M))
    edges = [(i, json.loads(g)) for i, g in cur.fetchall() if i != edge_id]
    cur.execute(f"""
        SELECT improved, ST_AsGeoJSON(geom) FROM {exp}.sdot_sidewalk
        WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)::geography, %s)""",
                (json.dumps(label), RADIUS_M))
    sidewalks = [(imp, json.loads(g)) for imp, g in cur.fetchall()]
    cur.execute(f"""
        SELECT category, ST_AsGeoJSON(geom) FROM {exp}.sdot_curb_ramp
        WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)::geography, %s)""",
                (json.dumps(label), RADIUS_M))
    ramps = [(cat, json.loads(g)) for cat, g in cur.fetchall()]
    return label, pano, old, audited, edges, sidewalks, ramps


def canvas_xy(cur, city, label_id):
    cur.execute(f"SELECT canvas_x, canvas_y FROM {city}.label_point WHERE label_id = %s", (label_id,))
    return cur.fetchone()


def marker_xy(cx, cy, has_crop):
    """Where the marker lands on the share image for a canvas position, through ShareController's cover-scale."""
    bw, bh = (1440, 960) if has_crop else (640, 480)
    scale = max(SHARE_W / bw, SHARE_H / bh)
    sw, sh = round(bw * scale), round(bh * scale)
    return cx / CANVAS_W * sw - (sw - SHARE_W) // 2, cy / CANVAS_H * sh - (sh - SHARE_H) // 2


def draw_share_image(ax, case, cxy):
    """The share image with the label-type marker composited at the labeled spot (the server's own compositing step
    is skipped on the Seattle deployment, so the marker is drawn here from the stored canvas position)."""
    img = mpimg.imread(OUT / "crops" / f"{case.label_id}.jpg")
    ax.imshow(img)
    if cxy is not None:
        x, y = marker_xy(cxy[0], cxy[1], bool(case.has_crop))
        icon = mpimg.imread(ICONS / f"{case.label_type}_small.png")
        ax.add_artist(AnnotationBbox(OffsetImage(icon, zoom=0.5), (x, y), frameon=False, pad=0))
    ax.set_axis_off()


class Local:
    """Equirectangular metres around an origin; exact enough over the 100 m a panel spans."""

    def __init__(self, lng0, lat0):
        self.lng0, self.lat0 = lng0, lat0
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.ky = 110574.0

    def xy(self, lng, lat):
        return (lng - self.lng0) * self.kx, (lat - self.lat0) * self.ky

    def geom(self, gj):
        """A GeoJSON geometry -> shapely geometry in local metres."""
        g = shape(gj)
        if g.geom_type == "Point":
            return Point(self.xy(g.x, g.y))
        if g.geom_type == "LineString":
            return LineString([self.xy(x, y) for x, y in g.coords])
        return [LineString([self.xy(x, y) for x, y in part.coords]) for part in g.geoms]


def lines_of(g):
    return g if isinstance(g, list) else [g]


def draw_arrow(ax, line, frac, color):
    """A small arrowhead on a line at the given fraction of its length, pointing in digitized direction."""
    a = line.interpolate(frac * line.length)
    b = line.interpolate(min(1.0, frac + 0.02) * line.length)
    ax.annotate("", xy=(b.x, b.y), xytext=(a.x, a.y),
                arrowprops={"arrowstyle": "-|>", "color": color, "lw": 1.6, "mutation_scale": 14})


def side_word(s):
    return {1: "left", -1: "right"}.get(s, "—")


def panel(ax, case, data):
    label, pano, old, audited, edges, sidewalks, ramps = data
    loc = Local(*label["coordinates"])
    lab = loc.geom(label)
    cam = loc.geom(pano)
    aud = loc.geom(audited)
    # Centre the view between camera and label so a far shot still shows both; half-extent grows with that gap.
    cx, cy = (lab.x + cam.x) / 2, (lab.y + cam.y) / 2
    half = max(22.0, lab.distance(cam) / 2 + 10)

    for _, gj in edges:
        for ln in lines_of(loc.geom(gj)):
            ax.plot(*ln.xy, color=C_STREET, lw=2.2, solid_capstyle="round", zorder=1)
    for imp, gj in sidewalks:
        for ln in lines_of(loc.geom(gj)):
            ax.plot(*ln.xy, color=C_THIRD if imp else C_UNIMPROVED, lw=1.6, ls="-" if imp else (0, (2, 2)),
                    zorder=2)
    for _, gj in ramps:
        p = loc.geom(gj)
        ax.plot(p.x, p.y, marker="s", ms=4.5, color=C_THIRD, mec="white", mew=0.6, ls="", zorder=3)
    ax.plot(*aud.xy, color=C_AUDITED, lw=2.8, solid_capstyle="round", zorder=2)
    draw_arrow(ax, aud, 0.55, C_AUDITED)

    # The two readings: the heading method's ray from the camera, the geometric method's perpendicular to the line.
    ax.plot([cam.x, lab.x], [cam.y, lab.y], color=C_HEAD, lw=1.2, ls=(0, (3, 2)), zorder=4)
    foot = aud.interpolate(aud.project(lab))
    ax.plot([lab.x, foot.x], [lab.y, foot.y], color=C_GEO, lw=1.2, zorder=4)
    if old is not None and case["case"] == "near_line":
        o = loc.geom(old)
        ax.plot(o.x, o.y, marker="o", ms=8, mfc="white", mec=C_GEO, mew=1.4, ls="", zorder=5)
        ax.plot([o.x, lab.x], [o.y, lab.y], color=C_GEO, lw=0.8, ls=(0, (1, 2)), zorder=4)
    ax.plot(cam.x, cam.y, marker="^", ms=9, color=C_HEAD, mec="white", mew=0.8, ls="", zorder=6)
    ax.plot(lab.x, lab.y, marker="o", ms=9, color=C_GEO, mec="white", mew=0.8, ls="", zorder=6)

    ax.set_xlim(cx - half, cx + half)
    ax.set_ylim(cy - half, cy + half)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_edgecolor("#e6e5e1")
    # 10 m scale bar, bottom left
    x0, y0 = cx - half + 0.08 * 2 * half, cy - half + 0.06 * 2 * half
    ax.plot([x0, x0 + 10], [y0, y0], color="#3d3d3b", lw=1.5)
    ax.text(x0 + 5, y0 + 0.02 * 2 * half, "10 m", ha="center", va="bottom", fontsize=7, color="#3d3d3b")

    truth = f" · truth {side_word(case['truth'])}" if pd.notna(case.get("truth")) else ""
    flipped = case["case"] == "near_line" and pd.notna(case.get("geo_side_old"))
    old_txt = f" (was {side_word(case['geo_side_old'])})" if flipped else ""
    ax.set_title(case["title"], fontsize=9, loc="left", pad=6)
    ax.text(0.03, 0.97,
            f"label {case['label_id']} · {case['label_type']}{truth}\n"
            f"geometric: {side_word(case['geo_side'])}, {case['geo_dist_m']:.1f} m from the line{old_txt}\n"
            f"heading: {side_word(case['head_side'])}\n"
            f"camera: {case['pano_offset_m']:.0f} m off the street, {case['cam_dist_m']:.0f} m from the label",
            transform=ax.transAxes, fontsize=6.5, va="top", ha="left", color="#3d3d3b",
            bbox={"boxstyle": "round,pad=0.35", "fc": "white", "ec": "#e6e5e1", "alpha": 0.92}, zorder=10)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exp", default="experiment_2886")
    ap.add_argument("--city", default="sidewalk_seattle")
    args = ap.parse_args()
    cases = pd.read_csv(OUT / "cases.csv")

    plt.rcParams.update({"font.size": 9})
    # Three rows of two (map, crop) pairs; the crop gets the wider column since share images are landscape.
    fig = plt.figure(figsize=(15.5, 11.2))
    gs = GridSpec(3, 4, figure=fig, width_ratios=[1, 1.55, 1, 1.55], wspace=0.06, hspace=0.22,
                  left=0.01, right=0.99, top=0.96, bottom=0.08)
    with connect() as conn, conn.cursor() as cur:
        for i, (_, case) in enumerate(cases.iterrows()):
            row, col = divmod(i, 2)
            ax_map = fig.add_subplot(gs[row, 2 * col])
            ax_img = fig.add_subplot(gs[row, 2 * col + 1])
            panel(ax_map, case, fetch(cur, args.exp, int(case.label_id), int(case.edge_id)))
            draw_share_image(ax_img, case, canvas_xy(cur, args.city, int(case.label_id)))
    handles = [
        Line2D([], [], color=C_AUDITED, lw=2.8, label="audited street (arrow = digitized direction)"),
        Line2D([], [], color=C_STREET, lw=2.2, label="other streets"),
        Line2D([], [], color=C_THIRD, lw=1.6, label="SDOT paved sidewalk"),
        Line2D([], [], color=C_UNIMPROVED, lw=1.6, ls=(0, (2, 2)), label="SDOT unimproved side"),
        Line2D([], [], marker="s", color=C_THIRD, ls="", ms=5, label="SDOT curb ramp"),
        Line2D([], [], marker="^", color=C_HEAD, ls="", ms=8, label="camera"),
        Line2D([], [], color=C_HEAD, lw=1.2, ls=(0, (3, 2)), label="camera → label ray (heading method)"),
        Line2D([], [], marker="o", color=C_GEO, ls="", ms=8, label="label position (estimated)"),
        Line2D([], [], color=C_GEO, lw=1.2, label="perpendicular to the centerline (geometric method)"),
        Line2D([], [], marker="o", mfc="white", mec=C_GEO, ls="", ms=7, label="position before the #4818 reposition"),
    ]
    fig.legend(handles=handles, loc="lower center", ncol=4, frameon=False, fontsize=7.5, bbox_to_anchor=(0.5, 0.0))
    fig.savefig(OUT / "fig_cases.png", dpi=150)
    print("wrote", OUT / "fig_cases.png")


if __name__ == "__main__":
    main()
