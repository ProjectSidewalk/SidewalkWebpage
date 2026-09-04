#!/usr/bin/env python3
"""Score the two street-side methods from the tables street_side.py export writes (out/*.csv).

Writes out/summary.json (every number the report quotes), out/tables.md (the tables, ready to paste) and
out/fig_*.png. Run inside the web container: python3.13 tools/street_side/analyze_street_side.py
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
C_GEO, C_HEAD, C_THIRD, C_GRAY = "#2a78d6", "#eb6834", "#1baf7a", "#8a8987"
DIST_BANDS = [0, 1, 2, 3, 4, 6, 8, 12, np.inf]
DIST_LABELS = ["0–1", "1–2", "2–3", "3–4", "4–6", "6–8", "8–12", "12+"]
AXIS_BANDS = [0, 5, 10, 20, 30, 45, 60, 90.001]
AXIS_LABELS = ["0–5", "5–10", "10–20", "20–30", "30–45", "45–60", "60–90"]
CAM_BANDS = [0, 3, 5, 8, 12, 16, 20, 24, np.inf]
CAM_LABELS = ["0–3", "3–5", "5–8", "8–12", "12–16", "16–20", "20–24", "24+"]
FINE_BANDS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, np.inf]
FINE_LABELS = ["0–0.5", "0.5–1", "1–1.5", "1.5–2", "2–2.5", "2.5–3", "3–4", "4–5", "5+"]
TYPES = ["CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk", "Crosswalk", "Signal", "Occlusion",
         "Other"]
S = {}          # summary
T = []          # markdown tables


def md(title, df, floatfmt=".1f"):
    T.append(f"\n**{title}**\n")
    T.append(df.to_markdown(floatfmt=floatfmt))


def pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def band(x, bands, labels):
    return pd.cut(x, bands, labels=labels, right=False, include_lowest=True)


def haversine_m(lat1, lng1, lat2, lng2):
    """Great-circle distance in metres between two lat/lng arrays (the camera and the label are tens of metres apart,
    so the spherical form is exact to the centimetre here)."""
    lat1, lng1, lat2, lng2 = map(np.radians, (lat1, lng1, lat2, lng2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371008.8 * np.arcsin(np.sqrt(a))


def typical(df, sort_col="geo_dist_m"):
    """The median row of a candidate set, so an example in the report is representative rather than cherry-picked."""
    d = df.sort_values(sort_col)
    return d.iloc[len(d) // 2]


def agreement(df, by):
    """Rows where both methods decided; agreement rate per group."""
    d = df[df.geo_side.isin([1, -1]) & df.head_side.isin([1, -1])]
    g = d.groupby(by, observed=True)
    return pd.DataFrame({"n": g.size(), "agree_pct": g.apply(lambda x: 100.0 * (x.geo_side == x.head_side).mean())})


def accuracy(df, truth_col, by=None):
    """Per-method accuracy against a truth column, counting only rows where the method decided."""
    rows = []
    groups = [(None, df)] if by is None else list(df.groupby(by, observed=True))
    for k, g in groups:
        r = {"group": "all" if k is None else k, "n": len(g)}
        for m, col in [("geo", "geo_side"), ("head", "head_side")]:
            d = g[g[col].isin([1, -1])]
            r[f"{m}_decided_pct"] = pct(len(d), len(g))
            r[f"{m}_acc_pct"] = round(100.0 * (d[col] == d[truth_col]).mean(), 1) if len(d) else None
        rows.append(r)
    return pd.DataFrame(rows).set_index("group")


def split_by_agreement(df, truth_col):
    """Accuracy on the rows where the methods agree (a read on the truth set's own noise) and, on the rows where they
    disagree, which method is right -- the only rows that can separate the two methods."""
    d = df[df.geo_side.isin([1, -1]) & df.head_side.isin([1, -1])]
    ag = d[d.geo_side == d.head_side]
    dis = d[d.geo_side != d.head_side]
    return {"n": len(d), "agree_n": len(ag), "agree_pct": pct(len(ag), len(d)),
            "agree_acc_pct": round(100.0 * (ag.geo_side == ag[truth_col]).mean(), 1) if len(ag) else None,
            "disagree_n": len(dis),
            "disagree_geo_right_pct": round(100.0 * (dis.geo_side == dis[truth_col]).mean(), 1) if len(dis) else None,
            "disagree_head_right_pct": round(100.0 * (dis.head_side == dis[truth_col]).mean(), 1) if len(dis) else None}


def abstention_curve(df, truth_col, margin_col, side_col, thresholds):
    out = []
    for t in thresholds:
        d = df[(df[margin_col] >= t) & df[side_col].isin([1, -1])]
        out.append({"threshold": t, "coverage_pct": pct(len(d), len(df)),
                    "acc_pct": round(100.0 * (d[side_col] == d[truth_col]).mean(), 1) if len(d) else None})
    return pd.DataFrame(out)


def main():
    base = pd.read_csv(OUT / "label_base.csv")
    side = pd.read_csv(OUT / "label_side.csv")
    cov = pd.read_csv(OUT / "edge_cov.csv")
    ramp = pd.read_csv(OUT / "label_ramp.csv")
    swchk = pd.read_csv(OUT / "sw_side_check.csv")
    swstats = pd.read_csv(OUT / "sw_match_stats.csv").iloc[0].to_dict()
    near = pd.read_csv(OUT / "label_sw_near.csv")
    # COPY writes booleans as t/f
    tf = {"t": True, "f": False}
    for col in ("has_geom", "has_old_geom", "correct"):
        base[col] = base[col].map(tf)
    swchk["improved"] = swchk.improved.map(tf)

    aud = side[side.frame == "audited"].merge(base, on="label_id", how="left").merge(near, on="label_id", how="left")
    aud["dist_band"] = band(aud.geo_dist_m, DIST_BANDS, DIST_LABELS)
    aud["axis_band"] = band(aud.axis_angle_deg, AXIS_BANDS, AXIS_LABELS)
    aud["cam_dist_m"] = haversine_m(aud.lat, aud.lng, aud.pano_lat, aud.pano_lng)
    aud["cam_band"] = band(aud.cam_dist_m, CAM_BANDS, CAM_LABELS)
    aud["fine_band"] = band(aud.geo_dist_m, FINE_BANDS, FINE_LABELS)

    n = len(base)
    S["n_labels"] = n
    S["n_geo_computable"] = int(base.has_geom.sum())
    S["n_head_computable"] = int(base.label_bearing.notna().sum())
    S["n_both"] = int((base.has_geom & base.label_bearing.notna()).sum())
    S["n_neither"] = int((~base.has_geom & base.label_bearing.isna()).sum())
    S["by_method_counts"] = base.computation_method.value_counts(dropna=False).to_dict()
    S["by_type_counts"] = base.label_type.value_counts().to_dict()
    S["missing_head_by_method"] = base[base.label_bearing.isna()].computation_method.value_counts(dropna=False).to_dict()
    S["pano_source_counts"] = base.pano_source.value_counts(dropna=False).to_dict()

    q = [0.1, 0.25, 0.5, 0.75, 0.9]
    prof = aud.groupby("computation_method").geo_dist_m.quantile(q).unstack()
    prof.columns = [f"p{int(x*100)}" for x in q]
    prof["n"] = aud.groupby("computation_method").size()
    S["dist_profile_by_method"] = prof.round(2).to_dict(orient="index")
    md("Distance from label to audited-street centerline (m), by computation method", prof, ".2f")
    proft = aud.groupby("label_type").geo_dist_m.quantile(q).unstack()
    proft.columns = [f"p{int(x*100)}" for x in q]
    proft["n"] = aud.groupby("label_type").size()
    proft = proft.reindex(TYPES)
    S["dist_profile_by_type"] = proft.round(2).to_dict(orient="index")
    md("Distance from label to audited-street centerline (m), by label type", proft, ".2f")
    S["dist_band_counts"] = aud.dist_band.value_counts().reindex(DIST_LABELS).to_dict()
    S["pano_offset_quantiles"] = aud.pano_offset_m.quantile(q).round(2).to_dict()
    S["axis_angle_quantiles"] = aud.axis_angle_deg.quantile(q).round(1).to_dict()
    S["axis_band_counts"] = aud.axis_band.value_counts().reindex(AXIS_LABELS).to_dict()

    both = aud[aud.geo_side.isin([1, -1]) & aud.head_side.isin([1, -1])]
    S["agree_overall_pct"] = round(100.0 * (both.geo_side == both.head_side).mean(), 2)
    S["agree_n"] = len(both)
    a_dist = agreement(aud, "dist_band").reindex(DIST_LABELS)
    a_axis = agreement(aud, "axis_band").reindex(AXIS_LABELS)
    a_type = agreement(aud, "label_type").reindex(TYPES)
    a_meth = agreement(aud, "computation_method")
    S["agree_by_dist"] = a_dist.round(1).to_dict(orient="index")
    S["agree_by_axis"] = a_axis.round(1).to_dict(orient="index")
    S["agree_by_type"] = a_type.round(1).to_dict(orient="index")
    S["agree_by_method"] = a_meth.round(1).to_dict(orient="index")
    md("Agreement between methods by distance to centerline (m)", a_dist)
    md("Agreement between methods by heading margin (angle between label ray and road axis, deg)", a_axis)
    md("Agreement between methods by label type", a_type)
    md("Agreement between methods by computation method", a_meth)
    grid = both.assign(agree=(both.geo_side == both.head_side)).pivot_table(index="dist_band", columns="axis_band",
                                                                            values="agree", aggfunc="mean",
                                                                            observed=True) * 100
    grid = grid.reindex(index=DIST_LABELS, columns=AXIS_LABELS)
    md("Agreement (%) by distance band (rows, m) and heading margin (cols, deg)", grid)
    S["agree_grid"] = grid.round(1).to_dict(orient="index")
    # Where does the pano sit relative to the audited edge, and does that predict disagreement?
    both = both.assign(agree=(both.geo_side == both.head_side))
    po = both.groupby(band(both.pano_offset_m, [0, 1, 2, 3, 5, 8, 15, np.inf],
                          ["0–1", "1–2", "2–3", "3–5", "5–8", "8–15", "15+"]), observed=True).agree.agg(["size", "mean"])
    po["mean"] *= 100
    po.columns = ["n", "agree_pct"]
    md("Agreement by camera offset from the audited centerline (m)", po)
    S["agree_by_pano_offset"] = po.round(1).to_dict(orient="index")

    # frames: audited vs nearest edge
    fr = side.pivot(index="label_id", columns="frame", values="edge_id")
    fr = fr.join(base.set_index("label_id")[["label_type"]])
    fr["nearest_differs"] = fr.nearest_label.notna() & (fr.nearest_label != fr.audited)
    fr["pano_edge_differs"] = fr.nearest_pano.notna() & (fr.nearest_pano != fr.audited)
    ft = fr.groupby("label_type")[["nearest_differs", "pano_edge_differs"]].mean().reindex(TYPES) * 100
    ft["n"] = fr.groupby("label_type").size().reindex(TYPES)
    md("Labels whose nearest street is not the audited street (%), by type", ft)
    S["frame_differs_by_type"] = ft.round(1).to_dict(orient="index")
    S["frame_differs_overall_pct"] = round(100.0 * fr.nearest_differs.mean(), 1)
    S["pano_edge_differs_overall_pct"] = round(100.0 * fr.pano_edge_differs.mean(), 1)
    S["end_dist_quantiles_by_type"] = aud.groupby("label_type").geo_end_dist_m.quantile([0.25, 0.5, 0.75]).unstack() \
        .reindex(TYPES).round(1).to_dict(orient="index")

    # stability under the approximation2 -> approximation3 reposition
    st = aud[aud.geo_side_old.isin([1, -1]) & aud.geo_side.isin([1, -1])].copy()
    st["flip"] = st.geo_side_old != st.geo_side
    S["stability_n"] = len(st)
    S["stability_flip_pct"] = round(100.0 * st.flip.mean(), 2)
    S["stability_old_edge_differs_pct"] = round(100.0 * (st.old_edge_id != st.audited_edge_id).mean(), 2)
    fl = st.groupby("dist_band", observed=True).flip.agg(["size", "mean"]).reindex(DIST_LABELS)
    fl["mean"] *= 100
    fl.columns = ["n", "flip_pct"]
    md("Geometric side flips between the approximation2 and approximation3 positions, by current distance band (m)", fl)
    S["flip_by_dist"] = fl.round(1).to_dict(orient="index")
    flo = st.groupby(band(st.geo_dist_old_m, DIST_BANDS, DIST_LABELS), observed=True).flip.agg(["size", "mean"]) \
        .reindex(DIST_LABELS)
    flo["mean"] *= 100
    flo.columns = ["n", "flip_pct"]
    S["flip_by_old_dist"] = flo.round(1).to_dict(orient="index")
    flt = st.groupby("label_type").flip.agg(["size", "mean"]).reindex(TYPES)
    flt["mean"] *= 100
    flt.columns = ["n", "flip_pct"]
    md("Geometric side flips by label type", flt)
    S["flip_by_type"] = flt.round(1).to_dict(orient="index")
    # The heading method reads the same inputs at both positions, so its flip rate is zero by construction.
    S["stability_note"] = "heading method reads pano_x/camera_heading only; unchanged by the reposition"

    # depth-era check: measured positions as near-truth for the heading method
    dep = aud[(aud.computation_method == "depth") & aud.geo_side.isin([1, -1]) & aud.head_side.isin([1, -1])]
    dep_far = dep[dep.geo_dist_m >= 3]
    S["depth_check_n"] = len(dep_far)
    S["depth_check_head_acc_pct"] = round(100.0 * (dep_far.head_side == dep_far.geo_side).mean(), 2)
    dax = dep_far.groupby("axis_band", observed=True).apply(lambda x: pd.Series({"n": len(x),
                                                                                 "head_acc_pct": 100.0 * (x.head_side == x.geo_side).mean()})).reindex(AXIS_LABELS)
    md("Heading method vs the measured (depth) position's side, labels >= 3 m from the centerline, by heading margin", dax)
    S["depth_check_by_axis"] = dax.round(1).to_dict(orient="index")
    dty = dep_far.groupby("label_type").apply(lambda x: pd.Series({"n": len(x),
                                                                   "head_acc_pct": 100.0 * (x.head_side == x.geo_side).mean()})).reindex(TYPES)
    md("Heading method vs the measured (depth) position's side, >= 3 m, by label type", dty)
    S["depth_check_by_type"] = dty.round(1).to_dict(orient="index")

    # SDOT self-check: our geometric side of each sidewalk vs SDOT's cardinal SIDE
    adj = {"N": ["NW", "NE"], "NE": ["N", "E"], "E": ["NE", "SE"], "SE": ["E", "S"], "S": ["SE", "SW"],
           "SW": ["S", "W"], "W": ["SW", "NW"], "NW": ["W", "N"]}
    sw = swchk[swchk.sdot_side.isin(adj.keys())].copy()
    sw["exact"] = sw.sdot_side == sw.normal_compass
    sw["adjacent"] = [b in adj[a] for a, b in zip(sw.sdot_side, sw.normal_compass)]
    S["sdot_side_check"] = {"metres": float(sw.metres.sum()),
                            "exact_pct": round(100.0 * (sw.metres * sw.exact).sum() / sw.metres.sum(), 1),
                            "exact_or_adjacent_pct": round(100.0 * (sw.metres * (sw.exact | sw.adjacent)).sum()
                                                           / sw.metres.sum(), 1)}
    S["sw_match_stats"] = {k: int(v) for k, v in swstats.items()}

    def classify(r):
        li, ri, lu, ru = r.left_improved, r.right_improved, r.left_unimproved, r.right_unimproved
        if li >= 0.6 and ri >= 0.6:
            return "both"
        if li >= 0.75 and (ri + ru) <= 0.1:
            return "left_only"
        if ri >= 0.75 and (li + lu) <= 0.1:
            return "right_only"
        if (li + lu) <= 0.1 and (ri + ru) <= 0.1:
            return "none"
        return "mixed"
    cov["cls"] = cov.apply(classify, axis=1)
    cc = cov.groupby("cls").agg(edges=("street_edge_id", "size"), km=("length_m", lambda x: x.sum() / 1000))
    md("Street edges by SDOT sidewalk coverage class", cc)
    S["edge_classes"] = cc.round(1).to_dict(orient="index")
    aud = aud.merge(cov[["street_edge_id", "cls"]].rename(columns={"street_edge_id": "edge_id"}), on="edge_id",
                    how="left")
    one = aud[aud.cls.isin(["left_only", "right_only"])].copy()
    one["paved_side"] = np.where(one.cls == "left_only", 1, -1)
    one["bare_side"] = -one.paved_side
    S["labels_on_one_sided_edges_by_type"] = one.label_type.value_counts().reindex(TYPES).fillna(0).astype(int).to_dict()
    S["labels_on_edge_class_by_type"] = aud.pivot_table(index="label_type", columns="cls", values="label_id",
                                                        aggfunc="size", fill_value=0).reindex(TYPES).to_dict(orient="index")

    # truth set 1: NoSidewalk on one-sided edges -> bare side
    ns = one[one.label_type == "NoSidewalk"].copy()
    ns["truth"] = ns.bare_side
    ns_v = ns[ns.correct != False]  # noqa: E712  -- drop labels the crowd rejected
    S["truth_ns"] = {"n_all": len(ns), "n_not_rejected": len(ns_v),
                     "all": accuracy(ns, "truth").to_dict(orient="index")["all"],
                     "not_rejected": accuracy(ns_v, "truth").to_dict(orient="index")["all"]}
    md("NoSidewalk labels on one-sided streets: accuracy against the bare side", accuracy(ns_v, "truth", "dist_band").reindex(DIST_LABELS))
    md("NoSidewalk labels on one-sided streets: accuracy by heading margin", accuracy(ns_v, "truth", "axis_band").reindex(AXIS_LABELS))
    md("NoSidewalk labels on one-sided streets: accuracy by computation method", accuracy(ns_v, "truth", "computation_method"))
    S["truth_ns_by_dist"] = accuracy(ns_v, "truth", "dist_band").reindex(DIST_LABELS).to_dict(orient="index")
    S["truth_ns_by_axis"] = accuracy(ns_v, "truth", "axis_band").reindex(AXIS_LABELS).to_dict(orient="index")
    S["truth_ns_by_method"] = accuracy(ns_v, "truth", "computation_method").to_dict(orient="index")
    ns_v = ns_v.assign(paved_dist=np.where(ns_v.paved_side == 1, ns_v.left_paved_dist_m, ns_v.right_paved_dist_m))
    ns_v["placement"] = pd.cut(ns_v.paved_dist, [0, 4, 6, 20, np.inf],
                               labels=["on the paved line (<=4 m)", "4-6 m", "across (6-20 m)", "far (>20 m)"])
    nsp = accuracy(ns_v, "truth", "placement")
    md("NoSidewalk labels on one-sided streets, by the label's distance from SDOT's paved sidewalk line", nsp)
    S["truth_ns_by_placement"] = nsp.to_dict(orient="index")
    ns_across = ns_v[ns_v.placement == "across (6-20 m)"]
    S["truth_ns_across"] = {"n": len(ns_across), **accuracy(ns_across, "truth").to_dict(orient="index")["all"]}
    S["truth_ns_split"] = split_by_agreement(ns_v, "truth")
    S["truth_ns_across_split"] = split_by_agreement(ns_across, "truth")
    S["truth_ns_across_by_dist"] = accuracy(ns_across, "truth", "dist_band").reindex(DIST_LABELS).to_dict(orient="index")
    S["truth_ns_across_by_axis"] = accuracy(ns_across, "truth", "axis_band").reindex(AXIS_LABELS).to_dict(orient="index")
    md("NoSidewalk labels placed across from the paved side: accuracy by distance band", accuracy(ns_across, "truth", "dist_band").reindex(DIST_LABELS))
    S["truth_ns_tags"] = {t: {"n": int(ns_v.tags.fillna("").str.contains(t, regex=False).sum()),
                              **accuracy(ns_v[ns_v.tags.fillna("").str.contains(t, regex=False)], "truth").to_dict(orient="index")["all"]}
                          for t in ["street has a sidewalk", "street has no sidewalks", "ends abruptly"]}
    S["truth_ns_unvalidated_pct"] = pct(int(ns_v.correct.isna().sum()), len(ns_v))
    S["truth_ns_by_year"] = ns_v.groupby(pd.to_datetime(ns_v.time_created, utc=True, format="ISO8601").dt.year).apply(
        lambda x: pd.Series({"n": len(x), "geo_acc_pct": 100.0 * (x.geo_side == x.truth).mean()})).round(1).to_dict(orient="index")
    e = ns_v.groupby("edge_id").apply(lambda x: pd.Series({"n": len(x), "geo_acc": (x.geo_side == x.truth).mean()}))
    S["truth_ns_edge_concentration"] = {"edges": len(e), "all_wrong_edges_n3": int(((e.geo_acc == 0) & (e.n >= 3)).sum()),
                                        "labels_on_them": int(e[(e.geo_acc == 0) & (e.n >= 3)].n.sum())}
    # the same labels on 'both' edges: how often does the crowd say "no sidewalk" where SDOT has two -- a data note
    S["nosidewalk_on_both_sided_edges"] = int(((aud.label_type == "NoSidewalk") & (aud.cls == "both")).sum())
    S["nosidewalk_on_none_edges"] = int(((aud.label_type == "NoSidewalk") & (aud.cls == "none")).sum())

    # truth set 2: on-sidewalk label types on one-sided edges -> paved side
    sw_types = ["Obstacle", "SurfaceProblem"]
    osw = one[one.label_type.isin(sw_types)].copy()
    osw["truth"] = osw.paved_side
    osw_v = osw[osw.correct != False]  # noqa: E712
    S["truth_sw"] = {"n_all": len(osw), "n_not_rejected": len(osw_v),
                     "all": accuracy(osw, "truth").to_dict(orient="index")["all"],
                     "not_rejected": accuracy(osw_v, "truth").to_dict(orient="index")["all"]}
    md("Obstacle + SurfaceProblem labels on one-sided streets: accuracy against the paved side",
       accuracy(osw_v, "truth", "dist_band").reindex(DIST_LABELS))
    md("Obstacle + SurfaceProblem on one-sided streets: accuracy by heading margin",
       accuracy(osw_v, "truth", "axis_band").reindex(AXIS_LABELS))
    md("Obstacle + SurfaceProblem on one-sided streets: accuracy by label type", accuracy(osw_v, "truth", "label_type"))
    S["truth_sw_by_dist"] = accuracy(osw_v, "truth", "dist_band").reindex(DIST_LABELS).to_dict(orient="index")
    S["truth_sw_by_axis"] = accuracy(osw_v, "truth", "axis_band").reindex(AXIS_LABELS).to_dict(orient="index")
    S["truth_sw_by_type"] = accuracy(osw_v, "truth", "label_type").to_dict(orient="index")
    S["truth_sw_split"] = split_by_agreement(osw_v, "truth")
    osw_v = osw_v.assign(paved_dist=np.where(osw_v.paved_side == 1, osw_v.left_paved_dist_m, osw_v.right_paved_dist_m))
    osw_v["placement"] = pd.cut(osw_v.paved_dist, [0, 4, 6, 20, np.inf],
                                labels=["on the paved line (<=4 m)", "4-6 m", "across (6-20 m)", "far (>20 m)"])
    swp = accuracy(osw_v, "truth", "placement")
    md("Obstacle + SurfaceProblem on one-sided streets, by the label's distance from SDOT's paved sidewalk line", swp)
    S["truth_sw_by_placement"] = swp.to_dict(orient="index")

    # nearest paved sidewalk, any street: label within 6 m of a paved SDOT sidewalk sample on one side of the audited
    # edge and >= 3 m farther from any on the other side. Position-dependent with a road-width margin (like the
    # curb-ramp truth), so it flatters the geometric method on two-sided streets; its value is the heading method's
    # failure profile at n = 35k.
    sw2 = aud[aud.label_type.isin(sw_types) & (aud.correct != False)].copy()  # noqa: E712
    sw2["dmin"] = sw2[["left_paved_dist_m", "right_paved_dist_m"]].min(axis=1)
    sw2["dmax"] = sw2[["left_paved_dist_m", "right_paved_dist_m"]].max(axis=1)
    sw2["truth"] = np.where(sw2.left_paved_dist_m.fillna(1e9) < sw2.right_paved_dist_m.fillna(1e9), 1, -1)
    sw2 = sw2[(sw2.dmin <= 6) & (sw2.dmax.isna() | (sw2.dmax >= sw2.dmin + 3))]
    S["truth_sw2"] = {"n": len(sw2), "n_one_paved_side_only": int(sw2.dmax.isna().sum()),
                      **accuracy(sw2, "truth").to_dict(orient="index")["all"],
                      "split": split_by_agreement(sw2, "truth")}
    sw2["offset_band"] = band(sw2.pano_offset_m, [0, 1, 2, 3, 5, 8, 15, np.inf], ["0–1", "1–2", "2–3", "3–5", "5–8", "8–15", "15+"])
    S["truth_sw2_by_offset"] = accuracy(sw2, "truth", "offset_band").to_dict(orient="index")
    S["truth_sw2_by_axis"] = accuracy(sw2, "truth", "axis_band").reindex(AXIS_LABELS).to_dict(orient="index")
    S["truth_sw2_by_dist"] = accuracy(sw2, "truth", "dist_band").reindex(DIST_LABELS).to_dict(orient="index")
    md("Obstacle + SurfaceProblem labels vs the nearest paved SDOT sidewalk (n = 35k): accuracy by camera offset from the audited centerline (m)",
       accuracy(sw2, "truth", "offset_band"))
    md("Same set, by heading margin", accuracy(sw2, "truth", "axis_band").reindex(AXIS_LABELS))
    md("Same set, by distance to centerline", accuracy(sw2, "truth", "dist_band").reindex(DIST_LABELS))

    # curb ramp types on one-sided edges, for completeness (ramps belong with the sidewalk, but corners are messy)
    cr1 = one[one.label_type.isin(["CurbRamp", "NoCurbRamp"])].copy()
    cr1["truth"] = cr1.paved_side
    cr1_v = cr1[cr1.correct != False]  # noqa: E712
    S["truth_cr_one_sided"] = {"n": len(cr1_v), **accuracy(cr1_v, "truth").to_dict(orient="index")["all"]}

    # truth set 3: curb-ramp labels vs SDOT curb-ramp points
    rr = ramp[ramp.current_status.isin(["INSVC"]) | (ramp.category == "NORAMP")].copy()
    rr = rr[rr.ramp_side.isin([1, -1]) & (rr.ramp_edge_dist_m >= 2)]
    rr = rr.sort_values(["label_id", "ramp_dist_m"])
    first = rr.groupby("label_id").first()
    # ambiguous if any other candidate ramp on the other side is within 3 m of the nearest one's distance
    other = rr.merge(first[["ramp_side", "ramp_dist_m"]].rename(columns={"ramp_side": "s1", "ramp_dist_m": "d1"}),
                     on="label_id")
    amb = other[(other.ramp_side != other.s1) & (other.ramp_dist_m <= other.d1 + 3)].label_id.unique()
    first["ambiguous"] = first.index.isin(amb)
    cr = aud[aud.label_type.isin(["CurbRamp", "NoCurbRamp"])].merge(
        first[["ramp_side", "ramp_dist_m", "ambiguous", "category"]], left_on="label_id", right_index=True, how="inner")
    cr["truth"] = cr.ramp_side
    S["truth_cr"] = {"n_matched": len(cr), "n_ambiguous": int(cr.ambiguous.sum()),
                     "n_labels_of_type": int(aud.label_type.isin(["CurbRamp", "NoCurbRamp"]).sum())}
    cru = cr[~cr.ambiguous & (cr.correct != False)]  # noqa: E712
    S["truth_cr"]["n_scored"] = len(cru)
    S["truth_cr"]["all"] = accuracy(cru, "truth").to_dict(orient="index")["all"]
    md("Curb-ramp labels matched to an unambiguous SDOT ramp: accuracy by distance band",
       accuracy(cru, "truth", "dist_band").reindex(DIST_LABELS))
    md("Curb-ramp labels matched to an unambiguous SDOT ramp: accuracy by heading margin",
       accuracy(cru, "truth", "axis_band").reindex(AXIS_LABELS))
    md("Curb-ramp labels matched to an unambiguous SDOT ramp: accuracy by label type", accuracy(cru, "truth", "label_type"))
    S["truth_cr_by_dist"] = accuracy(cru, "truth", "dist_band").reindex(DIST_LABELS).to_dict(orient="index")
    S["truth_cr_by_axis"] = accuracy(cru, "truth", "axis_band").reindex(AXIS_LABELS).to_dict(orient="index")
    S["truth_cr_by_type"] = accuracy(cru, "truth", "label_type").to_dict(orient="index")
    S["truth_cr_by_method"] = accuracy(cru, "truth", "computation_method").to_dict(orient="index")
    S["truth_cr_split"] = split_by_agreement(cru, "truth")
    cru = cru.assign(ramp_band=band(cru.ramp_dist_m, [0, 2, 4, 6, 8, 10, 15.01], ["0–2", "2–4", "4–6", "6–8", "8–10", "10–15"]),
                     offset_band=band(cru.pano_offset_m, [0, 1, 2, 3, 5, 8, 15, np.inf], ["0–1", "1–2", "2–3", "3–5", "5–8", "8–15", "15+"]))
    md("Curb-ramp labels: accuracy by distance from label to its SDOT ramp (m)", accuracy(cru, "truth", "ramp_band"))
    md("Curb-ramp labels: accuracy by camera offset from the audited centerline (m)", accuracy(cru, "truth", "offset_band"))
    S["truth_cr_by_ramp_dist"] = accuracy(cru, "truth", "ramp_band").to_dict(orient="index")
    S["truth_cr_by_offset"] = accuracy(cru, "truth", "offset_band").to_dict(orient="index")

    # RQ7: does distance from the camera hurt the side? The estimator's error grows along the ray (#5084), but a
    # slide along the ray only changes the side where the ray crosses the centerline. Scored on the two clean truth
    # sets, plus the median centerline distance per band, which is what makes the far labels the easy ones.
    cr6 = cru[cru.ramp_dist_m <= 6]  # the clean end of the ramp truth set: a ramp point right at the label
    S["truth_cr6"] = {"n": len(cr6), **accuracy(cr6, "truth").to_dict(orient="index")["all"]}
    for key, df_, title in [("sw2", sw2, "Obstacle/SurfaceProblem vs the nearest paved sidewalk"),
                            ("cr", cr6, "Curb-ramp labels within 6 m of their SDOT ramp")]:
        by_cam = accuracy(df_, "truth", "cam_band").reindex(CAM_LABELS)
        by_cam["median_dist_to_centerline_m"] = df_.groupby("cam_band", observed=True).geo_dist_m.median().reindex(CAM_LABELS).round(1)
        md(f"{title}: accuracy by camera-to-label distance (m)", by_cam)
        S[f"truth_{key}_by_cam_dist"] = by_cam.to_dict(orient="index")
        by_fine = accuracy(df_, "truth", "fine_band").reindex(FINE_LABELS)
        md(f"{title}: accuracy by distance to the centerline in 0.5 m bands (the calibration table)", by_fine)
        S[f"truth_{key}_by_fine_dist"] = by_fine.to_dict(orient="index")
    S["cam_dist_quantiles"] = aud.cam_dist_m.quantile(q).round(1).to_dict()
    S["cam_band_counts"] = aud.cam_band.value_counts().reindex(CAM_LABELS).to_dict()

    # Worked examples for case_maps.py: one representative (median-distance) label per situation the report
    # discusses, chosen by rule rather than by hand so the pick is reproducible.
    main_types = ["CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk"]
    cases = [
        ("agree", "Typical: camera on the street, both methods agree",
         cru[(cru.pano_offset_m < 1.5) & (cru.geo_side == cru.head_side) & (cru.geo_side == cru.truth)
             & (cru.ramp_dist_m < 3) & cru.geo_dist_m.between(4, 8)]),
        ("corner", "Corner: camera on the cross street, heading method wrong",
         cru[(cru.pano_offset_m > 8) & (cru.geo_side != cru.head_side) & (cru.geo_side == cru.truth)
             & (cru.ramp_dist_m < 4) & (cru.geo_dist_m > 3)]),
        ("near_line", "Within 1 m of the centerline: the reposition flipped the side",
         aud[(aud.geo_dist_m < 0.7) & aud.geo_side_old.isin([1, -1]) & (aud.geo_side_old != aud.geo_side)
             & (aud.geo_dist_old_m < 1.5) & aud.label_type.isin(main_types)]),
        ("far", "Far from the camera: the side is still clear",
         sw2[(sw2.cam_dist_m > 24) & (sw2.geo_side == sw2.truth) & (sw2.geo_dist_m > 6) & (sw2.pano_offset_m < 3)
             & sw2.head_side.isin([1, -1])]),
        ("ns_bare", "NoSidewalk on a one-sided street: on the bare side",
         ns_v[(ns_v.placement == "across (6-20 m)") & (ns_v.geo_side == ns_v.truth) & (ns_v.head_side == ns_v.truth)]),
        ("ns_paved", "NoSidewalk on the walkway SDOT calls paved: not a side error",
         ns_v[(ns_v.placement == "on the paved line (<=4 m)") & (ns_v.paved_dist < 2) & (ns_v.geo_side == ns_v.head_side)]),
    ]
    rows = []
    for key, title, pool in cases:
        r = typical(pool)
        rows.append({"case": key, "title": title, "pool_n": len(pool), "label_id": int(r.label_id),
                     "label_type": r.label_type, "edge_id": int(r.edge_id), "geo_side": int(r.geo_side),
                     "geo_dist_m": round(r.geo_dist_m, 2), "head_side": int(r.head_side) if r.head_side in (1, -1) else None,
                     "pano_offset_m": round(r.pano_offset_m, 1), "cam_dist_m": round(r.cam_dist_m, 1),
                     "truth": int(r.truth) if "truth" in r and r.truth in (1, -1) else None,
                     "geo_side_old": int(r.geo_side_old) if r.geo_side_old in (1, -1) else None,
                     "gallery_url": f"https://sidewalk-seattle.cs.washington.edu/label/{int(r.label_id)}"})
    pd.DataFrame(rows).to_csv(OUT / "cases.csv", index=False)
    S["cases"] = rows
    S["depth_check_split"] = {"note": "geo side of the measured position is the reference here"}

    # abstention curves & combined rules on the pooled truth set
    pooled = pd.concat([ns_v.assign(tset="NoSidewalk"), osw_v.assign(tset="OnSidewalk"), cru.assign(tset="CurbRamp")])
    S["pooled_truth_n"] = len(pooled)
    S["pooled_by_tset"] = pooled.tset.value_counts().to_dict()
    S["pooled_acc"] = accuracy(pooled, "truth").to_dict(orient="index")["all"]
    S["pooled_acc_by_tset"] = accuracy(pooled, "truth", "tset").to_dict(orient="index")
    geo_curve = abstention_curve(pooled, "truth", "geo_dist_m", "geo_side", [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6])
    head_curve = abstention_curve(pooled, "truth", "axis_angle_deg", "head_side", [0, 2, 5, 8, 10, 15, 20, 25, 30, 40])
    md("Geometric method: accuracy vs coverage when abstaining below a distance threshold (m), pooled truth", geo_curve)
    md("Heading method: accuracy vs coverage when abstaining below a heading margin (deg), pooled truth", head_curve)
    S["geo_curve"] = geo_curve.to_dict(orient="records")
    S["head_curve"] = head_curve.to_dict(orient="records")

    def rule(df, dmin, amin, prefer):
        """Decision rule: both decided & agree -> that side; else prefer the method whose margin clears its floor."""
        g = df.geo_side.where(df.geo_dist_m >= dmin)
        h = df.head_side.where(df.axis_angle_deg >= amin)
        g = g.where(g.isin([1, -1]))
        h = h.where(h.isin([1, -1]))
        if prefer == "head":
            out = h.fillna(g)
        elif prefer == "geo":
            out = g.fillna(h)
        else:  # agree-only
            out = g.where(g == h)
        dec = out.notna()
        return {"coverage_pct": pct(dec.sum(), len(df)), "acc_pct": round(100.0 * (out[dec] == df.truth[dec]).mean(), 1)}
    rules = []
    for prefer in ["head", "geo", "agree"]:
        for dmin in [0, 1, 2, 3]:
            for amin in [0, 5, 10, 15, 20]:
                rules.append({"prefer": prefer, "dist_floor_m": dmin, "angle_floor_deg": amin,
                              **rule(pooled, dmin, amin, prefer)})
    rules = pd.DataFrame(rules)
    md("Combined rules on the pooled truth set", rules)
    S["rules"] = rules.to_dict(orient="records")
    S["rules_by_tset"] = {ts: {f"{p}/{d}/{a}": rule(g, d, a, p) for p in ["head", "geo"] for d in [0, 2] for a in [0, 10]}
                          for ts, g in pooled.groupby("tset")}
    near_rows = []
    for name, df_ in [("NoSidewalk", ns_v), ("OnSidewalk", osw_v), ("CurbRamp", cru), ("OnSidewalkNearest", sw2)]:
        for lo, hi in [(0, 1), (1, 2), (2, 3)]:
            d = df_[(df_.geo_dist_m >= lo) & (df_.geo_dist_m < hi)]
            sp = split_by_agreement(d, "truth")
            near_rows.append({"truth_set": name, "band": f"{lo}–{hi} m", "n": len(d),
                              "geo_acc_pct": round(100.0 * (d.geo_side == d.truth).mean(), 1) if len(d) else None,
                              "agree_pct": sp["agree_pct"], "agree_acc_pct": sp["agree_acc_pct"],
                              "disagree_geo_right_pct": sp["disagree_geo_right_pct"],
                              "disagree_head_right_pct": sp["disagree_head_right_pct"]})
    near_df = pd.DataFrame(near_rows)
    md("Near the centerline: what agreement between the methods buys", near_df)
    S["near_centerline"] = near_df.to_dict(orient="records")
    for floor in [1, 2]:
        dec = aud.geo_side.isin([1, -1]) & (aud.geo_dist_m >= floor)
        S[f"geo_coverage_floor_{floor}m_pct"] = pct(dec.sum(), len(aud))
        S[f"geo_coverage_floor_{floor}m_by_type"] = (dec.groupby(aud.label_type).mean() * 100).reindex(TYPES).round(1).to_dict()
        dec2 = dec | (aud.geo_side.isin([1, -1]) & (aud.geo_side == aud.head_side))
        S[f"geo_coverage_floor_{floor}m_agree_fallback_pct"] = pct(dec2.sum(), len(aud))
        S[f"geo_coverage_floor_{floor}m_agree_fallback_by_type"] = (dec2.groupby(aud.label_type).mean() * 100).reindex(TYPES).round(1).to_dict()

    # what the recommended rule does on the full population (coverage only; accuracy is only known on truth rows)
    for name, (p, d, a) in {"head_first_0_10": ("head", 0, 10), "head_first_2_10": ("head", 2, 10),
                            "geo_first_2_0": ("geo", 2, 0), "agree_only": ("agree", 0, 0)}.items():
        g = aud.geo_side.where(aud.geo_dist_m >= d)
        h = aud.head_side.where(aud.axis_angle_deg >= a)
        g = g.where(g.isin([1, -1]))
        h = h.where(h.isin([1, -1]))
        out = h.fillna(g) if p == "head" else (g.fillna(h) if p == "geo" else g.where(g == h))
        S[f"population_coverage_{name}_pct"] = pct(out.notna().sum(), len(aud))
        S[f"population_coverage_{name}_by_type"] = (out.notna().groupby(aud.label_type).mean() * 100).reindex(TYPES).round(1).to_dict()

    rng = np.random.default_rng(2886)
    cand = aud[aud.geo_side.isin([1, -1]) & aud.head_side.isin([1, -1]) & (aud.computation_method != "depth")].copy()
    cand["agree"] = cand.geo_side == cand.head_side
    parts = []
    for t in ["CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk"]:
        for ag, k in [(True, 4), (False, 8)]:
            pool = cand[(cand.label_type == t) & (cand.agree == ag)]
            parts.append(pool.sample(min(k, len(pool)), random_state=int(rng.integers(1 << 30))))
    samp = pd.concat(parts)[["label_id", "label_type", "computation_method", "geo_side", "geo_dist_m", "head_side",
                             "axis_angle_deg", "edge_id", "lat", "lng", "pano_id"]].copy()
    samp["gallery_url"] = "https://sidewalk-seattle.cs.washington.edu/label/" + samp.label_id.astype(str)
    samp["your_side"] = ""
    samp.round(2).to_csv(OUT / "hand_label_sample.csv", index=False)
    S["hand_label_sample_n"] = len(samp)

    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                         "axes.grid": True, "grid.color": "#e6e5e1", "grid.linewidth": 0.6, "axes.axisbelow": True})

    fig, ax = plt.subplots(1, 2, figsize=(10, 3.6))
    ax[0].bar(DIST_LABELS, [S["dist_band_counts"][b] for b in DIST_LABELS], color=C_GRAY, width=0.7)
    ax[0].set_title("Labels by distance to audited centerline (m)")
    ax[0].set_ylabel("labels")
    ax[1].plot(DIST_LABELS, a_dist.agree_pct, marker="o", color=C_THIRD, lw=2, ms=5)
    ax[1].set_ylim(50, 101)
    ax[1].set_title("Methods agree (%) by distance band")
    for a in ax:
        a.tick_params(axis="x", labelrotation=0)
    fig.tight_layout()
    fig.savefig(OUT / "fig_agreement_by_distance.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5.4, 3.6))
    ax.plot(AXIS_LABELS, a_axis.agree_pct, marker="o", color=C_THIRD, lw=2, ms=5)
    ax.set_ylim(50, 101)
    ax.set_title("Methods agree (%) by heading margin (deg off the road axis)")
    fig.tight_layout()
    fig.savefig(OUT / "fig_agreement_by_axis.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(1, 3, figsize=(12, 3.6), sharey=True)
    for i, (name, df_, lab) in enumerate([("NoSidewalk → bare side of a one-sided street (n = 478)", S["truth_ns_across_by_dist"], "NoSidewalk"),
                                          ("Obstacle/SurfaceProblem → nearest paved sidewalk (n = 35k)", S["truth_sw2_by_dist"], "OnSidewalk"),
                                          ("Curb-ramp labels → SDOT ramp side (n = 98k)", S["truth_cr_by_dist"], "CurbRamp")]):
        d = pd.DataFrame(df_).T.reindex(DIST_LABELS)
        ax[i].plot(DIST_LABELS, d.geo_acc_pct, marker="o", color=C_GEO, lw=2, ms=5, label="geometric")
        ax[i].plot(DIST_LABELS, d.head_acc_pct, marker="s", color=C_HEAD, lw=2, ms=5, label="heading")
        ax[i].set_title(name, fontsize=9)
        ax[i].set_xlabel("distance to centerline (m)")
    ax[0].set_ylabel("accuracy (%)")
    ax[0].set_ylim(0, 101)
    ax[0].legend(frameon=False)
    fig.tight_layout()
    fig.savefig(OUT / "fig_truth_by_distance.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(1, 3, figsize=(12, 3.6), sharey=True)
    for i, (name, df_) in enumerate([("NoSidewalk → bare side of a one-sided street (n = 478)", S["truth_ns_across_by_axis"]),
                                     ("Obstacle/SurfaceProblem → nearest paved sidewalk (n = 35k)", S["truth_sw2_by_axis"]),
                                     ("Curb-ramp labels → SDOT ramp side (n = 98k)", S["truth_cr_by_axis"])]):
        d = pd.DataFrame(df_).T.reindex(AXIS_LABELS)
        ax[i].plot(AXIS_LABELS, d.geo_acc_pct, marker="o", color=C_GEO, lw=2, ms=5, label="geometric")
        ax[i].plot(AXIS_LABELS, d.head_acc_pct, marker="s", color=C_HEAD, lw=2, ms=5, label="heading")
        ax[i].set_title(name, fontsize=9)
        ax[i].set_xlabel("heading margin (deg)")
    ax[0].set_ylabel("accuracy (%)")
    ax[0].set_ylim(0, 101)
    ax[0].legend(frameon=False)
    fig.tight_layout()
    fig.savefig(OUT / "fig_truth_by_axis.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5.4, 3.8))
    ax.plot(geo_curve.coverage_pct, geo_curve.acc_pct, marker="o", color=C_GEO, lw=2, ms=5, label="geometric (distance floor)")
    ax.plot(head_curve.coverage_pct, head_curve.acc_pct, marker="s", color=C_HEAD, lw=2, ms=5, label="heading (angle floor)")
    for _, r in geo_curve.iterrows():
        if r.threshold in (1, 2, 3, 5):
            ax.annotate(f"{r.threshold:g} m", (r.coverage_pct, r.acc_pct), textcoords="offset points", xytext=(4, 4), fontsize=8, color=C_GEO)
    for _, r in head_curve.iterrows():
        if r.threshold in (5, 10, 20, 30):
            ax.annotate(f"{r.threshold:g}°", (r.coverage_pct, r.acc_pct), textcoords="offset points", xytext=(4, -10), fontsize=8, color=C_HEAD)
    ax.set_xlabel("coverage (% of truth labels decided)")
    ax.set_ylabel("accuracy (%)")
    ax.set_title("Abstention trade-off, pooled truth set")
    ax.legend(frameon=False, fontsize=9)
    fig.tight_layout()
    fig.savefig(OUT / "fig_abstention.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(1, 2, figsize=(10, 3.6), sharey=True)
    OFF = ["0–1", "1–2", "2–3", "3–5", "5–8", "8–15", "15+"]
    for i, (name, df_) in enumerate([("Obstacle/SurfaceProblem → nearest paved sidewalk (n = 35k)", S["truth_sw2_by_offset"]),
                                     ("Curb-ramp labels → SDOT ramp side (n = 98k)", S["truth_cr_by_offset"])]):
        d = pd.DataFrame(df_).T.reindex(OFF)
        ax[i].plot(OFF, d.geo_acc_pct, marker="o", color=C_GEO, lw=2, ms=5, label="geometric")
        ax[i].plot(OFF, d.head_acc_pct, marker="s", color=C_HEAD, lw=2, ms=5, label="heading")
        ax[i].set_title(name, fontsize=9)
        ax[i].set_xlabel("camera offset from the audited centerline (m)")
    ax[0].set_ylabel("accuracy (%)")
    ax[0].set_ylim(0, 101)
    ax[0].legend(frameon=False)
    fig.tight_layout()
    fig.savefig(OUT / "fig_truth_by_offset.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(5.4, 3.6))
    ax.bar(DIST_LABELS, fl.flip_pct, color=C_GEO, width=0.7)
    ax.set_title("Geometric side flipped by the #4818 reposition (%)")
    ax.set_xlabel("current distance to centerline (m)")
    fig.tight_layout()
    fig.savefig(OUT / "fig_stability.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(1, 2, figsize=(10, 3.6))
    for key, lab, mk in [("sw2", "on-sidewalk vs nearest paved (n = 35k)", "o"), ("cr", "curb ramps within 6 m of their ramp (n = 82k)", "s")]:
        d = pd.DataFrame(S[f"truth_{key}_by_cam_dist"]).T.reindex(CAM_LABELS)
        ax[0].plot(CAM_LABELS, d.geo_acc_pct, marker=mk, color=C_GEO, lw=2, ms=5, label=lab)
        f = pd.DataFrame(S[f"truth_{key}_by_fine_dist"]).T.reindex(FINE_LABELS)
        ax[1].plot(FINE_LABELS, f.geo_acc_pct, marker=mk, color=C_GEO, lw=2, ms=5, label=lab)
    ax[0].set_ylim(90, 100.5)
    ax[0].set_title("Geometric accuracy by camera-to-label distance (m)", fontsize=9)
    ax[0].set_ylabel("accuracy (%)")
    ax[0].legend(frameon=False, fontsize=8, loc="lower right")
    ax[1].set_ylim(50, 101)
    ax[1].axhline(97, color="#e6e5e1", lw=1)
    ax[1].set_title("Geometric accuracy by distance to the centerline (m): the calibration", fontsize=9)
    ax[1].tick_params(axis="x", labelsize=8)
    fig.tight_layout()
    fig.savefig(OUT / "fig_calibration.png", dpi=160)
    plt.close(fig)

    (OUT / "summary.json").write_text(json.dumps(S, indent=1, default=lambda o: None if pd.isna(o) else str(o)))
    (OUT / "tables.md").write_text("\n".join(T))
    print("done", len(T), "tables")


if __name__ == "__main__":
    main()
