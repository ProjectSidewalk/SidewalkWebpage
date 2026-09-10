#!/usr/bin/env python3
"""Street-side assignment experiment for issue #2886: which side of its street each label sits on, by two methods,
scored against SDOT's sidewalk and curb-ramp inventories. See README.md for the design and the report it feeds.

Subcommands (run inside the web container with python3.13, which holds psycopg2/pandas/matplotlib):

    python3.13 tools/street_side/download_sdot.py tools/street_side/data   # SDOT layers -> GeoJSON (network)
    python3.13 tools/street_side/street_side.py load      # GeoJSON -> <exp>.sdot_sidewalk / sdot_curb_ramp
    python3.13 tools/street_side/street_side.py compute   # runs street_side.sql (all derived tables)
    python3.13 tools/street_side/street_side.py export    # derived tables -> out/*.csv for analyze_street_side.py

Connection: PGHOST (default db), PGDATABASE (sidewalk), PGUSER / PGPASSWORD (the city role; the scratch schema is
created by that role, so nothing runs as a superuser). --city names the city schema, --exp the scratch schema.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

HERE = Path(__file__).resolve().parent


def connect():
    return psycopg2.connect(host=os.environ.get("PGHOST", "db"), dbname=os.environ.get("PGDATABASE", "sidewalk"),
                            user=os.environ.get("PGUSER", "sidewalk_seattle"),
                            password=os.environ.get("PGPASSWORD", "sidewalk"))


def wkt(geom):
    """GeoJSON geometry -> WKT for the three geometry types the SDOT layers use; None for empty/degenerate ones."""
    if not geom:
        return None
    t, c = geom["type"], geom["coordinates"]
    ring = lambda pts: ", ".join(f"{x} {y}" for x, y, *_ in pts)
    if t == "Point":
        return f"POINT({c[0]} {c[1]})"
    if t == "LineString":
        return f"LINESTRING({ring(c)})" if len(c) >= 2 else None
    if t == "MultiLineString":
        parts = [p for p in c if len(p) >= 2]
        return "MULTILINESTRING(" + ", ".join(f"({ring(p)})" for p in parts) + ")" if parts else None
    raise ValueError(t)


def load(args):
    data = HERE / "data"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {args.exp}")
        cur.execute(f"DROP TABLE IF EXISTS {args.exp}.sdot_sidewalk, {args.exp}.sdot_curb_ramp CASCADE")
        cur.execute(f"""
            CREATE TABLE {args.exp}.sdot_sidewalk (
                objectid INT PRIMARY KEY, compkey INT, segkey INT, unitid TEXT, unitdesc TEXT, side TEXT,
                surftype TEXT, sw_category TEXT, current_status TEXT, condition TEXT, sw_width INT,
                improved BOOLEAN NOT NULL, geom geometry(Geometry, 4326))""")
        cur.execute(f"""
            CREATE TABLE {args.exp}.sdot_curb_ramp (
                objectid INT PRIMARY KEY, compkey INT, segkey INT, sw_compkey INT, unitdesc TEXT, sw_stside TEXT,
                category TEXT, current_status TEXT, direction TEXT, condition TEXT, style TEXT,
                geom geometry(Point, 4326))""")
        feats = json.load(open(data / "sidewalks.geojson"))["features"]
        rows = []
        for f in feats:
            p = f["properties"]
            # In-service paved walkway. UIMPRV/GRAVEL are SDOT's unimproved walkways; everything else in SURFTYPE is
            # a paved surface (PCC, AC, pavers, textured concrete...).
            improved = p.get("CURRENT_STATUS") == "INSVC" and (p.get("SURFTYPE") or "") not in ("UIMPRV", "GRAVEL", "")
            rows.append((p["OBJECTID"], p.get("COMPKEY"), p.get("SEGKEY"), p.get("UNITID"), p.get("UNITDESC"),
                         (p.get("SIDE") or "").strip() or None, p.get("SURFTYPE"), p.get("SW_CATEGORY"),
                         p.get("CURRENT_STATUS"), p.get("CONDITION"), p.get("SW_WIDTH"), improved, wkt(f["geometry"])))
        execute_values(cur, f"INSERT INTO {args.exp}.sdot_sidewalk VALUES %s", rows,
                       template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromText(%s, 4326))", page_size=2000)
        print("sdot_sidewalk", len(rows))
        feats = json.load(open(data / "curb_ramps.geojson"))["features"]
        rows = []
        for f in feats:
            p = f["properties"]
            rows.append((p["OBJECTID"], p.get("COMPKEY"), p.get("SEGKEY"), p.get("SW_COMPKEY"), p.get("UNITDESC"),
                         (p.get("SW_STSIDE") or "").strip() or None, (p.get("CATEGORY") or "").strip() or None,
                         (p.get("CURRENT_STATUS") or "").strip() or None, (p.get("DIRECTION") or "").strip() or None,
                         p.get("CONDITION"), p.get("STYLE"), wkt(f["geometry"])))
        execute_values(cur, f"INSERT INTO {args.exp}.sdot_curb_ramp VALUES %s", rows,
                       template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromText(%s, 4326))", page_size=2000)
        print("sdot_curb_ramp", len(rows))
        cur.execute(f"CREATE INDEX ON {args.exp}.sdot_sidewalk USING gist (geom)")
        cur.execute(f"CREATE INDEX ON {args.exp}.sdot_curb_ramp USING gist (geom)")


def compute(args):
    sql = (HERE / "street_side.sql").read_text().format(exp=args.exp, city=args.city)
    # One statement at a time so progress is visible; the file has no procedural bodies other than the two functions,
    # whose $fn$ quoting keeps their internal semicolons out of the split.
    statements, buf, in_body = [], [], False
    for line in sql.splitlines():
        buf.append(line)
        if "$fn$" in line:
            in_body = not in_body if line.count("$fn$") == 1 else in_body
        if not in_body and line.rstrip().endswith(";"):
            statements.append("\n".join(buf))
            buf = []
    with connect() as conn, conn.cursor() as cur:
        for st in statements:
            head = next((l for l in st.splitlines() if l.strip() and not l.strip().startswith("--")), "")[:90]
            t0 = time.time()
            cur.execute(st)
            conn.commit()
            print(f"{time.time() - t0:7.1f}s  {head}", flush=True)


EXPORTS = {
    "label_base": """SELECT b.label_id, b.label_type, b.computation_method, b.audited_edge_id, b.old_edge_id, b.correct,
                     b.agree_count, b.disagree_count, b.unsure_count, b.severity, b.time_created, b.user_id, b.pano_id,
                     b.pano_source, b.pano_width, b.pano_height, b.pano_x, b.pano_y, b.zoom, b.label_bearing,
                     ST_Y(b.label_geom) AS lat, ST_X(b.label_geom) AS lng, b.pano_lat, b.pano_lng, b.camera_heading,
                     b.label_geom IS NOT NULL AS has_geom, b.old_label_geom IS NOT NULL AS has_old_geom,
                     array_to_string(label.tags, '|') AS tags
                     FROM {exp}.label_base b INNER JOIN {city}.label ON b.label_id = label.label_id""",
    "label_sw_near": "SELECT * FROM {exp}.label_sw_near",
    "label_side": "SELECT * FROM {exp}.label_side",
    "edge_cov": "SELECT * FROM {exp}.edge_cov",
    "label_ramp": "SELECT * FROM {exp}.label_ramp",
    "sw_side_check": """SELECT sdot_side, normal_compass, improved, count(*) AS n, sum(step_m) AS metres
                        FROM {exp}.sw_edge_match GROUP BY 1, 2, 3""",
    "sw_match_stats": """SELECT (SELECT count(*) FROM {exp}.sw_sample) AS samples,
                         (SELECT count(*) FROM {exp}.sw_edge_match) AS matched,
                         (SELECT count(*) FROM {exp}.sdot_sidewalk) AS sidewalks,
                         (SELECT count(*) FROM {exp}.sdot_sidewalk WHERE improved) AS improved_sidewalks,
                         (SELECT count(*) FROM {exp}.sdot_curb_ramp) AS ramps""",
}


def export(args):
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    with connect() as conn, conn.cursor() as cur:
        for name, q in EXPORTS.items():
            with open(out / f"{name}.csv", "w") as f:
                cur.copy_expert(f"COPY ({q.format(exp=args.exp, city=args.city)}) TO STDOUT WITH CSV HEADER", f)
            print("exported", name)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["load", "compute", "export"])
    ap.add_argument("--city", default="sidewalk_seattle")
    ap.add_argument("--exp", default="experiment_2886")
    a = ap.parse_args()
    {"load": load, "compute": compute, "export": export}[a.cmd](a)
