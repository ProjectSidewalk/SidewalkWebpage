"""Unit tests for tools/validation_queue/analyze_validation_queue.py (#4715).

These pin the policy arithmetic the evidence report is built on, so a transcription slip between
`models.validation.ValidationQueuePolicy` and the analysis shows up here rather than as a wrong number in a doc.

Both halves of `make test-python` collect this directory, so everything here must run under Python 3.8 as well as
3.13: no `match`, no PEP 604 unions, no builtin generics in annotations.
"""

import csv
import re
from pathlib import Path

import numpy as np
import pytest

import analyze_validation_queue as avq

# The repo root is three levels up from test/python/, which is where the Scala policy and the SQL export live.
REPO_ROOT = Path(__file__).resolve().parents[2]
POLICY_SCALA = REPO_ROOT / "app" / "models" / "validation" / "ValidationQueuePolicy.scala"
POOL_SQL = REPO_ROOT / "tools" / "validation_queue" / "pool.sql"

# The column order of the two CSV exports (pool.sql without the #5285 face columns, and validations.sql).
POOL_CSV_FIELDS = ["label_id", "label_type", "agree_count", "disagree_count", "unsure_count", "correct",
                   "own_labels_validated", "high_quality", "low_quality", "stale", "recent", "ai_result"]
VALIDATION_CSV_FIELDS = ["label_id", "label_type", "validation_result", "end_timestamp", "source", "self_vote",
                         "is_ai"]


# Fixtures and helpers.


def make_pool(rows):
    """Build a Pool from compact tuples, defaulting every labeler to established and every audit task to clean.

    @param rows: Iterable of (label_type, agree, disagree, unsure) or the same plus a dict of column overrides.
    @returns: analyze_validation_queue.Pool.
    """
    columns = {
        "label_id": [], "label_type": [], "agree_count": [], "disagree_count": [], "unsure_count": [],
        "correct_is_null": [], "own_labels_validated": [], "high_quality": [], "low_quality": [], "stale": [],
        "recent": [], "ai_result": [], "street_edge_id": [], "street_side": [], "labeler_id": [], "ai_labeler": [],
        "age_years": [],
    }
    for index, row in enumerate(rows):
        label_type, agree, disagree, unsure = row[:4]
        extra = row[4] if len(row) > 4 else {}
        columns["label_id"].append(index + 1)
        columns["label_type"].append(label_type)
        columns["agree_count"].append(agree)
        columns["disagree_count"].append(disagree)
        columns["unsure_count"].append(unsure)
        columns["correct_is_null"].append(extra.get("correct_is_null", agree + disagree + unsure == 0))
        columns["own_labels_validated"].append(extra.get("own_labels_validated", 500))
        columns["high_quality"].append(extra.get("high_quality", False))
        columns["low_quality"].append(extra.get("low_quality", False))
        columns["stale"].append(extra.get("stale", False))
        columns["recent"].append(extra.get("recent", False))
        columns["ai_result"].append(extra.get("ai_result", ""))
        # Face columns (#5285): by default every label is on street 1, unsided, by its own labeler, and fresh.
        columns["street_edge_id"].append(extra.get("street_edge_id", 1))
        columns["street_side"].append(extra.get("street_side", ""))
        columns["labeler_id"].append(extra.get("labeler_id", "labeler-{0}".format(index + 1)))
        columns["ai_labeler"].append(extra.get("ai_labeler", False))
        columns["age_years"].append(extra.get("age_years", 0.0))
    dtypes = {
        "label_id": np.int64, "label_type": object, "agree_count": np.int64, "disagree_count": np.int64,
        "unsure_count": np.int64, "correct_is_null": bool, "own_labels_validated": np.int64, "high_quality": bool,
        "low_quality": bool, "stale": bool, "recent": bool, "ai_result": object, "street_edge_id": np.int64,
        "street_side": object, "labeler_id": object, "ai_labeler": bool, "age_years": np.float64,
    }
    return avq.Pool({name: np.array(values, dtype=dtypes[name]) for name, values in columns.items()})


def face(street, side, labeler, agree=0, ai_result="", ai_labeler=False, age_years=7.0):
    """A sided NoSidewalk label row for `make_pool`: on `street`'s `side`, placed by `labeler`."""
    return ("NoSidewalk", agree, 0, 0, {"street_edge_id": street, "street_side": side, "labeler_id": labeler,
                                        "ai_result": ai_result, "ai_labeler": ai_labeler, "age_years": age_years,
                                        "correct_is_null": agree == 0})


def face_pool():
    """Three faces and an unsided label, covering every bucket the face section reports.

    Face A (street 10, left): one labeler, three labels, no votes -- the study's error signal.
    Face B (street 10, right): two labelers, one human Agree plus one label whose only Agree is the AI's.
    Face C (street 20, left): three labelers (one of them the AI), two agreeing votes -- settled for the lottery.
    Plus an unsided NoSidewalk label on street 20 and enough CurbRamps for a second eligible type.
    """
    rows = [face(10, "left", "alice"), face(10, "left", "alice"), face(10, "left", "alice"),
            face(10, "right", "alice", agree=1), face(10, "right", "bob", agree=1, ai_result="Agree"),
            face(20, "left", "alice", agree=1), face(20, "left", "bob", agree=1), face(20, "left", "robot",
                                                                                      ai_labeler=True),
            ("NoSidewalk", 0, 0, 0, {"street_edge_id": 20, "labeler_id": "carol", "age_years": 0.5})]
    rows += [face(30 + i, "left", "dan-{0}".format(i)) for i in range(12)]  # a dozen lone faces to fill missions
    rows += [("CurbRamp", 0, 0, 0)] * 12
    return make_pool(rows)


def toy_pool(n_per_status=10):
    """A pool with equal numbers of unvalidated, one-vote and decided CurbRamp labels."""
    rows = []
    rows += [("CurbRamp", 0, 0, 0)] * n_per_status
    rows += [("CurbRamp", 1, 0, 0)] * n_per_status
    rows += [("CurbRamp", 4, 0, 0)] * n_per_status
    return make_pool(rows)


def validation_row(label_id, result, timestamp="2026-01-01 00:00:00+00", source="Validate", self_vote=False,
                   is_ai=False, label_type="CurbRamp"):
    """One row shaped like validations.sql's CSV output."""
    return {
        "label_id": label_id, "label_type": label_type, "validation_result": result, "end_timestamp": timestamp,
        "source": source, "self_vote": self_vote, "is_ai": is_ai,
    }


# Retirement rule and triage predicates.


@pytest.mark.parametrize("agree,disagree,unsure,expected", [
    (0, 0, 0, True),    # Nothing has looked at it yet.
    (1, 0, 0, True),    # One vote, margin 1: still open. This is also the AI-only case.
    (0, 1, 0, True),
    (1, 1, 0, True),    # Tied, under the cap.
    (0, 0, 1, True),    # Unsure carries no verdict.
    (2, 0, 0, False),   # Margin 2 is settled.
    (0, 2, 0, False),
    (3, 1, 0, False),
    (2, 2, 1, False),   # Five votes, still tied: the crowd is done, an expert is not.
    (0, 0, 5, False),
    (1, 0, 4, False),
    (1, 1, 2, True),    # Four votes, tied: one more crowd vote is still allowed.
])
def test_needs_votes_matches_the_retirement_rule(agree, disagree, unsure, expected):
    assert bool(avq.needs_votes(agree, disagree, unsure)) is expected


def test_needs_votes_is_vectorized():
    agree = np.array([0, 1, 2, 0])
    disagree = np.array([0, 0, 0, 0])
    unsure = np.array([0, 0, 0, 5])
    assert list(avq.needs_votes(agree, disagree, unsure)) == [True, True, False, False]


def test_a_lone_ai_vote_never_retires_a_label():
    # The AI's Agree is inside agree_count, so the label sits at margin 1 with one vote: still the crowd's problem,
    # and not contested, because no human has pushed back yet.
    assert bool(avq.needs_votes(1, 0, 0))
    assert not bool(avq.triage(1, 0, 0, "Agree"))


@pytest.mark.parametrize("agree,disagree,unsure,ai,expected", [
    (2, 2, 1, "", True),       # Capped out at five votes, still tied.
    (0, 0, 5, "", True),
    (1, 1, 2, "", True),       # Unsure-heavy: two unsure, and they match the decisive votes.
    (0, 0, 2, "", True),
    (0, 1, 0, "Agree", True),  # AI said Agree, the only human said Disagree.
    (1, 0, 0, "Agree", False),
    (0, 1, 0, "Disagree", False),
    (1, 0, 0, "Disagree", True),
    (3, 1, 0, "Disagree", False),  # Settled against the AI: finished, not triage.
    (0, 0, 0, "", False),
    (1, 1, 0, "", False),      # Tied but cheap to keep asking the crowd.
])
def test_triage_selects_only_the_stuck_labels(agree, disagree, unsure, ai, expected):
    assert bool(avq.triage(agree, disagree, unsure, ai)) is expected


def test_unsure_heavy_needs_the_unsure_votes_to_outnumber_the_decisive_ones():
    assert bool(avq.unsure_heavy(0, 0, 2))
    assert bool(avq.unsure_heavy(1, 1, 2))
    assert not bool(avq.unsure_heavy(1, 1, 1))
    assert not bool(avq.unsure_heavy(0, 0, 1))


# Scores.


@pytest.mark.parametrize("agree,disagree,unsure,expected", [
    (0, 0, 0, 200.0),
    (1, 0, 0, 100.0),
    (1, 1, 0, 200.0),
    (0, 0, 1, 100.0),
    (0, 0, 2, 200.0 / 3.0),
    (1, 1, 1, 100.0),
    (2, 0, 0, 40.0),
    (2, 2, 1, 100.0),
])
def test_consensus_need_counts_unsure_votes(agree, disagree, unsure, expected):
    assert float(avq.consensus_need(agree, disagree, unsure)) == pytest.approx(expected)


def test_consensus_need_without_unsure_is_todays_formula():
    # Today's term ignores unsure entirely, which is how a 0/0/10 label keeps scoring like a fresh one forever.
    assert float(avq.consensus_need(0, 0)) == pytest.approx(200.0)
    assert float(avq.consensus_need(0, 0, 10)) == pytest.approx(200.0 / 11.0)


def test_new_score_tops_out_at_425_for_a_fresh_label_from_a_new_high_quality_labeler():
    score = avq.new_priority_score(0, 0, 0, own_labels_validated=0, high_quality=True, low_quality=False,
                                   stale=False, recent=True)
    assert float(score) == pytest.approx(425.0)


def test_the_new_labeler_bonus_follows_needs_votes_not_the_correct_flag():
    # A single AI Agree sets `correct`, which strips the bonus under today's gate but not under the new one.
    args = dict(own_labels_validated=0, high_quality=False, low_quality=False, stale=False, recent=False)
    old = avq.old_priority_score(1, 0, correct_is_null=False, **args)
    new = avq.new_priority_score(1, 0, 0, **args)
    assert float(old) == pytest.approx(100.0)
    assert float(new) == pytest.approx(250.0)


def test_a_low_quality_or_stale_audit_task_forfeits_the_new_labeler_bonus():
    base = dict(own_labels_validated=0, high_quality=False, recent=False)
    assert float(avq.new_priority_score(0, 0, 0, low_quality=True, stale=False, **base)) == pytest.approx(200.0)
    assert float(avq.new_priority_score(0, 0, 0, low_quality=False, stale=True, **base)) == pytest.approx(200.0)


def test_old_pick_weight_is_the_reciprocal_of_the_gap_to_the_ceiling():
    # The issue's headline table: an unvalidated label from an established labeler is only ~1.9x as likely to be
    # served as a settled 7-1 one.
    settled = float(avq.old_pick_weight(avq.consensus_need(7, 1)))
    unvalidated = float(avq.old_pick_weight(200.0))
    assert unvalidated / settled == pytest.approx(1.9, abs=0.05)


# Sort keys and selection.


def test_es_sort_keys_pick_in_proportion_to_the_weight():
    # Two labels, scores 10 and 20. With exponent 2 the second should win 4 times out of 5.
    rng = np.random.default_rng(4715)
    scores = np.array([10.0, 20.0])
    wins = 0
    for _ in range(4000):
        wins += int(np.argmax(avq.es_sort_keys(scores, rng)))
    assert wins / 4000.0 == pytest.approx(0.8, abs=0.02)


def test_es_sort_keys_with_exponent_one_are_proportional_to_the_score():
    rng = np.random.default_rng(4715)
    scores = np.array([10.0, 30.0])
    wins = 0
    for _ in range(4000):
        wins += int(np.argmax(avq.es_sort_keys(scores, rng, exponent=1.0)))
    assert wins / 4000.0 == pytest.approx(0.75, abs=0.02)


def test_es_pick_weights_raise_the_score_to_the_exponent_and_guard_the_zero():
    assert list(avq.es_pick_weights(np.array([0.0, 1.0, 3.0]))) == [1.0, 1.0, 9.0]
    assert list(avq.es_pick_weights(np.array([4.0]), exponent=1.0)) == [4.0]


def test_es_sort_keys_never_produce_an_infinite_key():
    rng = np.random.default_rng(1)
    keys = avq.es_sort_keys(np.full(10000, 5.0), rng)
    assert np.isfinite(keys).all()


def test_old_sort_keys_stay_between_the_score_and_the_ceiling():
    rng = np.random.default_rng(1)
    scores = np.array([5.0, 200.0, 425.0])
    keys = avq.old_sort_keys(scores, rng)
    assert bool((keys >= scores).all())
    assert bool((keys <= avq.OLD_SCORE_CEILING).all())


def test_bounded_jitter_cannot_invert_two_tiers_more_than_25_points_apart():
    rng = np.random.default_rng(1)
    keys = avq.jitter_sort_keys(np.array([100.0, 130.0]), rng)
    assert keys[1] > keys[0]


def test_sample_mission_returns_a_distinct_subset_of_the_top_batch():
    rng = np.random.default_rng(4715)
    keys = np.arange(500.0)
    chosen = avq.sample_mission(keys, rng)
    assert chosen.size == avq.MISSION_LENGTH
    assert len(set(chosen.tolist())) == avq.MISSION_LENGTH
    # The batch is the top 50 keys, which here are the last 50 indices.
    assert bool((chosen >= 450).all())


def test_sample_mission_handles_a_pool_smaller_than_a_mission():
    rng = np.random.default_rng(4715)
    chosen = avq.sample_mission(np.array([1.0, 2.0, 3.0]), rng)
    assert sorted(chosen.tolist()) == [0, 1, 2]
    assert avq.sample_mission(np.array([]), rng).size == 0


# Type selection.


def test_type_probabilities_give_every_type_the_floor_and_split_the_rest_by_weight():
    probs = avq.type_probabilities(np.array([90.0, 10.0]))
    assert probs.sum() == pytest.approx(1.0)
    assert probs[0] == pytest.approx(0.02 + 0.96 * 0.9)
    assert probs[1] == pytest.approx(0.02 + 0.96 * 0.1)


def test_type_probabilities_fall_back_to_uniform_when_nothing_is_outstanding():
    probs = avq.type_probabilities(np.zeros(4))
    assert list(probs) == [0.25, 0.25, 0.25, 0.25]
    assert list(avq.type_probabilities(np.array([7.0]))) == [1.0]
    assert avq.type_probabilities(np.array([])).size == 0


def test_no_sidewalk_is_held_back_unless_it_is_the_only_type_left_or_the_policy_serves_it():
    assert avq.eligible_types({"CurbRamp": 40, "NoSidewalk": 900}) == ["CurbRamp"]
    assert avq.eligible_types({"NoSidewalk": 900}) == ["NoSidewalk"]
    assert avq.eligible_types({"CurbRamp": 9, "NoSidewalk": 900}) == ["NoSidewalk"]
    assert avq.eligible_types({"CurbRamp": 40, "NoSidewalk": 900}, serve_no_sidewalk=True) == \
        ["CurbRamp", "NoSidewalk"]


# Bucketing.


def test_status_buckets_are_disjoint_and_ordered_by_how_settled_a_label_is():
    agree = np.array([0, 0, 1, 1, 3, 2])
    disagree = np.array([0, 0, 0, 1, 0, 2])
    unsure = np.array([0, 2, 0, 0, 0, 1])
    assert list(avq.status_of(agree, disagree, unsure)) == \
        ["unvalidated", "unsure-only", "margin 1", "tied", "decided", "tied"]


def test_vote_buckets_cover_every_count():
    assert list(avq.vote_bucket(np.array([0, 1, 2, 3, 4, 5, 12]))) == ["0", "1", "2", "3-4", "3-4", "5+", "5+"]


# Historical replay.


def test_replay_margins_tracks_the_margin_before_each_vote():
    rows = [
        validation_row(1, "Agree"),
        validation_row(1, "Agree"),     # Settles the label: margin goes 1 -> 2.
        validation_row(1, "Agree"),     # Wasted: already settled.
        validation_row(2, "Unsure"),
        validation_row(2, "Disagree"),
        validation_row(2, "Disagree"),  # Settles it the other way.
    ]
    replayed = avq.replay_margins(rows)
    assert [row["prior_votes"] for row in replayed] == [0, 1, 2, 0, 1, 2]
    assert [row["wasted"] for row in replayed] == [False, False, True, False, False, False]
    assert [row["settled"] for row in replayed] == [False, True, False, False, False, True]


def test_replay_margins_drops_self_votes_entirely():
    rows = [validation_row(1, "Agree", self_vote=True), validation_row(1, "Agree")]
    replayed = avq.replay_margins(rows)
    assert len(replayed) == 1
    assert replayed[0]["prior_votes"] == 0


def test_settle_rate_by_prior_votes_measures_only_the_still_undecided_votes():
    # Label 1 settles on its second vote, so its third vote is waste and must not dilute the depth-2 settle rate.
    # Label 2 sits at margin 1 after an Agree and an Unsure, so its third vote is the only undecided one at that
    # depth -- and it settles the label.
    rows = [validation_row(1, "Agree"), validation_row(1, "Agree"), validation_row(1, "Unsure"),
            validation_row(2, "Agree"), validation_row(2, "Unsure"), validation_row(2, "Agree")]
    table = avq.settle_rate_by_prior_votes(avq.replay_margins(rows))
    by_prior = {row["prior_votes"]: row for row in table}
    assert by_prior[0]["votes"] == 2 and by_prior[0]["settled_pct"] == 0.0
    assert by_prior[1]["votes"] == 2 and by_prior[1]["settled_pct"] == pytest.approx(50.0)
    assert by_prior[2]["votes"] == 2
    assert by_prior[2]["wasted"] == 1 and by_prior[2]["undecided_votes"] == 1
    assert by_prior[2]["settled_pct"] == pytest.approx(100.0)


def test_settle_rate_reports_zero_rather_than_dividing_by_no_undecided_votes():
    rows = [validation_row(1, "Agree"), validation_row(1, "Agree"), validation_row(1, "Agree")]
    by_prior = {row["prior_votes"]: row for row in avq.settle_rate_by_prior_votes(avq.replay_margins(rows))}
    assert by_prior[2]["undecided_votes"] == 0
    assert by_prior[2]["settled_pct"] == 0.0 and by_prior[2]["unsure_pct"] == 0.0


def test_waste_by_groups_on_whatever_the_key_function_returns():
    rows = [validation_row(1, "Agree", source="Validate"), validation_row(1, "Agree", source="Validate"),
            validation_row(1, "Agree", source="SidewalkAI")]
    table = avq.waste_by(avq.replay_margins(rows), lambda row: row["source"])
    by_source = {row["group"]: row for row in table}
    assert by_source["SidewalkAI"]["wasted_pct"] == pytest.approx(100.0)
    assert by_source["Validate"]["wasted_pct"] == 0.0


# Pick shares.


def test_pick_probabilities_sum_to_one_and_never_serve_a_decided_label_under_the_new_policy():
    pool = toy_pool(n_per_status=40)
    rng = np.random.default_rng(4715)
    decided = avq.margin(pool.agree, pool.disagree) >= avq.SETTLED_MARGIN
    old_shares = avq.pick_probabilities(pool, "old", rng, missions_per_type=200)
    new_shares = avq.pick_probabilities(pool, "new", rng, missions_per_type=200)
    assert old_shares.sum() == pytest.approx(1.0)
    assert new_shares.sum() == pytest.approx(1.0)
    assert float(old_shares[decided].sum()) > 0.1
    assert float(new_shares[decided].sum()) == 0.0


def test_pick_probabilities_are_monotone_in_the_score():
    # Unvalidated labels score 200, one-vote labels 100, so the sampler must favour the first group.
    pool = toy_pool(n_per_status=40)
    rng = np.random.default_rng(4715)
    shares = avq.pick_probabilities(pool, "es2", rng, missions_per_type=300)
    unvalidated = avq.status_of(pool.agree, pool.disagree, pool.unsure) == "unvalidated"
    one_vote = avq.status_of(pool.agree, pool.disagree, pool.unsure) == "margin 1"
    assert float(shares[unvalidated].sum()) > float(shares[one_vote].sum())


def test_share_by_group_sums_the_right_rows():
    shares = np.array([0.5, 0.25, 0.25])
    groups = np.array(["a", "b", "a"], dtype=object)
    assert avq.share_by_group(shares, groups, ("a", "b")) == {"a": 75.0, "b": 25.0}


# Forward simulation.


def test_simulate_votes_spends_nothing_on_decided_labels_under_the_new_policy():
    # The pool has to be big enough that the needs-votes queue cannot run dry inside the run; when it does, the
    # cascade falls back to the whole type on purpose, which is what test_simulate_votes_falls_back pins.
    pool = toy_pool(n_per_status=400)
    rng = np.random.default_rng(4715)
    old = avq.simulate_votes(pool, "old", 300, rng, p_correct=0.7)
    new = avq.simulate_votes(pool, "new", 300, rng, p_correct=0.7)
    assert old["votes"] == 300 and new["votes"] == 300
    assert old["on_decided_pct"] > 0.0
    assert new["on_decided_pct"] == 0.0
    assert new["on_capped_pct"] == 0.0


def test_simulate_votes_reaches_more_of_the_unvalidated_backlog_under_the_new_policy():
    pool = toy_pool(n_per_status=200)
    rng = np.random.default_rng(4715)
    old = avq.simulate_votes(pool, "old", 600, rng, p_correct=0.7)
    new = avq.simulate_votes(pool, "new", 600, rng, p_correct=0.7)
    assert new["zero_vote_labels_reached"] > old["zero_vote_labels_reached"]


def test_simulate_votes_stops_at_the_requested_vote_count():
    pool = toy_pool(n_per_status=10)
    rng = np.random.default_rng(4715)
    assert avq.simulate_votes(pool, "new", 7, rng, p_correct=0.7)["votes"] == 7


def test_simulate_votes_reports_no_metrics_when_nothing_is_servable():
    pool = make_pool([("CurbRamp", 0, 0, 0)] * 3)
    rng = np.random.default_rng(4715)
    result = avq.simulate_votes(pool, "new", 100, rng, p_correct=0.7)
    assert result["votes"] == 0
    assert result["on_decided_pct"] == 0.0


# Pool container, CSV loading and the report.


def test_pool_subset_and_no_sidewalk_filter():
    pool = make_pool([("CurbRamp", 0, 0, 0), ("NoSidewalk", 0, 0, 0), ("Signal", 2, 0, 0)])
    assert len(pool) == 3
    assert len(pool.without_no_sidewalk()) == 2
    assert list(pool.subset(np.array([True, False, False])).label_type) == ["CurbRamp"]


def test_the_two_new_labeler_bonus_gates_pick_different_subsets_of_the_same_labels():
    pool = make_pool([
        ("CurbRamp", 0, 0, 0, {"own_labels_validated": 3}),                            # New, unvalidated: both.
        ("CurbRamp", 1, 0, 0, {"own_labels_validated": 3, "correct_is_null": False}),   # AI-only: #4715 only.
        ("CurbRamp", 4, 0, 0, {"own_labels_validated": 3, "correct_is_null": False}),   # Settled: neither.
        ("CurbRamp", 0, 0, 0, {"own_labels_validated": 300}),                           # Established labeler.
        ("CurbRamp", 0, 0, 0, {"own_labels_validated": 3, "low_quality": True}),        # Flagged audit task.
    ])
    assert list(pool.new_labeler()) == [True, True, True, False, False]
    assert list(pool.new_labeler_bonus_old()) == [True, False, False, False, False]
    assert list(pool.new_labeler_bonus_new()) == [True, True, False, False, False]


def test_simulate_votes_falls_back_to_the_whole_type_when_the_queue_runs_dry():
    # Ten labels, three hundred votes: everything settles, and the cascade's last step keeps serving rather than
    # stalling the mission (#2929).
    pool = toy_pool(n_per_status=4)
    rng = np.random.default_rng(4715)
    result = avq.simulate_votes(pool, "new", 300, rng, p_correct=0.7)
    assert result["votes"] == 300
    assert result["on_decided_pct"] > 0.0


def _write_csv(path, fieldnames, rows):
    with open(str(path), "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def test_load_pool_reads_psql_booleans_and_the_nullable_correct_column(tmp_path):
    path = tmp_path / "pool.csv"
    _write_csv(
        path,
        POOL_CSV_FIELDS,
        [
            {"label_id": 1, "label_type": "CurbRamp", "agree_count": 0, "disagree_count": 0, "unsure_count": 0,
             "correct": "", "own_labels_validated": 3, "high_quality": "t", "low_quality": "f", "stale": "f",
             "recent": "t", "ai_result": ""},
            {"label_id": 2, "label_type": "NoSidewalk", "agree_count": 2, "disagree_count": 0, "unsure_count": 0,
             "correct": "t", "own_labels_validated": 300, "high_quality": "f", "low_quality": "t", "stale": "t",
             "recent": "f", "ai_result": "Agree"},
        ],
    )
    pool = avq.load_pool(str(path))
    assert list(pool.correct_is_null) == [True, False]
    assert list(pool.high_quality) == [True, False]
    assert list(pool.ai_result) == ["", "Agree"]
    assert float(pool.new_score()[0]) == pytest.approx(425.0)


def test_load_validations_reads_the_flags_as_booleans(tmp_path):
    path = tmp_path / "validations.csv"
    _write_csv(
        path,
        VALIDATION_CSV_FIELDS,
        [{"label_id": 1, "label_type": "CurbRamp", "validation_result": "Agree",
          "end_timestamp": "2026-01-01 00:00:00+00", "source": "SidewalkAI", "self_vote": "f", "is_ai": "t"}],
    )
    rows = avq.load_validations(str(path))
    assert rows[0]["is_ai"] is True and rows[0]["self_vote"] is False


def test_load_filters_a_merged_every_city_export_by_city_and_ignores_a_single_city_one(tmp_path):
    base = {"label_type": "CurbRamp", "agree_count": 0, "disagree_count": 0, "unsure_count": 0, "correct": "",
            "own_labels_validated": 3, "high_quality": "t", "low_quality": "f", "stale": "f", "recent": "t",
            "ai_result": ""}
    merged_pool = tmp_path / "pool.csv"
    _write_csv(merged_pool, ["city"] + POOL_CSV_FIELDS,
               [dict(base, city="seattle", label_id=1), dict(base, city="chicago", label_id=2),
                dict(base, city="seattle", label_id=3)])
    assert list(avq.load_pool(str(merged_pool), city="seattle").label_id) == [1, 3]
    vote = {"label_type": "CurbRamp", "validation_result": "Agree", "end_timestamp": "2026-01-01 00:00:00+00",
            "source": "Validate", "self_vote": "f", "is_ai": "f"}
    merged_votes = tmp_path / "validations.csv"
    _write_csv(merged_votes, ["city"] + VALIDATION_CSV_FIELDS,
               [dict(vote, city="chicago", label_id=2), dict(vote, city="seattle", label_id=1)])
    assert [row["label_id"] for row in avq.load_validations(str(merged_votes), city="seattle")] == [1]
    # A merged export must name a city, and a city it does not hold is a typo, not an empty pool.
    with pytest.raises(SystemExit, match="pass --city"):
        avq.load_pool(str(merged_pool))
    with pytest.raises(SystemExit, match="holds: chicago, seattle"):
        avq.load_validations(str(merged_votes), city="Seattle")
    # A single-city export has no city column, so asking for a city changes nothing.
    single = tmp_path / "single.csv"
    _write_csv(single, VALIDATION_CSV_FIELDS, [dict(vote, label_id=5)])
    assert [row["label_id"] for row in avq.load_validations(str(single), city="seattle")] == [5]


def test_markdown_table_renders_a_header_separator_and_every_row():
    table = avq.markdown_table(["a", "b"], [[1, 2], [3, 4]])
    assert table.splitlines() == ["| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"]


def test_build_report_covers_both_no_sidewalk_variants_and_every_section():
    pool = make_pool(
        [("CurbRamp", 0, 0, 0)] * 30 + [("CurbRamp", 1, 0, 0)] * 30 + [("CurbRamp", 4, 0, 0)] * 30
        + [("NoSidewalk", 0, 0, 0)] * 30
    )
    validations = [validation_row(1, "Agree"), validation_row(1, "Agree"), validation_row(1, "Agree")]
    report = avq.build_report(pool, validations, "sidewalk_test", votes=100, missions_per_type=20)
    assert "## Excluding NoSidewalk" in report
    assert "## Including NoSidewalk" in report
    for heading in ("### (i) Pool composition", "### (ii) Where the picks go",
                    "### (iii) What the crowd already spent", "### (iv) Forward simulation"):
        assert heading in report


def test_main_writes_the_report_to_the_requested_path(tmp_path):
    pool_path = tmp_path / "pool.csv"
    _write_csv(
        pool_path,
        POOL_CSV_FIELDS,
        [{"label_id": index, "label_type": "CurbRamp", "agree_count": index % 3, "disagree_count": 0,
          "unsure_count": 0, "correct": "", "own_labels_validated": 300, "high_quality": "f", "low_quality": "f",
          "stale": "f", "recent": "f", "ai_result": ""} for index in range(1, 41)],
    )
    validations_path = tmp_path / "validations.csv"
    _write_csv(
        validations_path,
        VALIDATION_CSV_FIELDS,
        [{"label_id": 1, "label_type": "CurbRamp", "validation_result": "Agree",
          "end_timestamp": "2026-01-01 00:00:00+00", "source": "Validate", "self_vote": "f", "is_ai": "f"}],
    )
    out_path = tmp_path / "report.md"
    exit_code = avq.main([
        "--pool", str(pool_path), "--validations", str(validations_path), "--schema", "sidewalk_test",
        "--votes", "50", "--missions", "10", "--out", str(out_path),
    ])
    assert exit_code == 0
    assert out_path.read_text().startswith("# Validate queue analysis")


# NoSidewalk by block face (#5285).


def test_face_keys_name_sided_labels_by_face_and_unsided_ones_by_themselves():
    keys = avq.face_keys(np.array(["NoSidewalk", "NoSidewalk", "CurbRamp"], dtype=object), np.array([7, 7, 7]),
                         np.array(["left", "", "left"], dtype=object), np.array([1, 2, 3]))
    assert list(keys) == ["7:left", "label:2", ""]


def test_face_evidence_counts_human_labelers_and_subtracts_the_ai_agree():
    pool = face_pool()
    has_face, labelers, support = pool.faces()
    keys = pool.face_keys()
    by_face = {keys[i]: (int(labelers[i]), int(support[i])) for i in np.flatnonzero(has_face)}
    assert by_face["10:left"] == (1, 0)
    # Two humans; the AI's Agree sits inside agree_count and is taken back out.
    assert by_face["10:right"] == (2, 1)
    # The AI-placed label adds to the face's labels but not to its human labelers.
    assert by_face["20:left"] == (2, 2)
    unsided = np.flatnonzero((pool.label_type == "NoSidewalk") & ~has_face)
    assert unsided.size == 1 and labelers[unsided[0]] == 0 and support[unsided[0]] == 0
    assert not has_face[pool.label_type == "CurbRamp"].any()


def test_face_evidence_is_empty_when_nothing_is_sided():
    pool = make_pool([("NoSidewalk", 0, 0, 0), ("CurbRamp", 0, 0, 0)])
    has_face, labelers, support = avq.face_evidence(pool)
    assert not has_face.any() and labelers.sum() == 0 and support.sum() == 0


@pytest.mark.parametrize("has_face, labelers, support, age, expected", [
    (True, 1, 0, 7.0, 460.0),               # lone labeler, unconfirmed, old: the top of the range
    (True, 3, 2, 7.0, (200 + 200 / 9 + 60) / 3),
    (True, 0, 0, 0.0, 400.0),               # no human labeler at all is floored to one
    (False, 0, 0, 2.0, 220.0),              # unsided: no face terms, just the age bonus
    (True, 1, 0, 100.0, 460.0),             # the age bonus caps at 60
])
def test_no_sidewalk_priority_score_matches_the_policy(has_face, labelers, support, age, expected):
    assert float(avq.no_sidewalk_priority_score(200.0, has_face, labelers, support, age)) == pytest.approx(expected)


def test_labeler_and_support_buckets_cover_every_count():
    assert list(avq.labeler_bucket([0, 1, 2, 3, 9])) == ["1", "1", "2", "3+", "3+"]
    assert list(avq.support_bucket([0, 1, 2, 5])) == ["0", "1", "2+", "2+"]


def test_spread_mission_takes_one_label_per_face_with_distinct_streets_first_then_fills():
    # Keys in descending order of position: the first candidate has the largest key.
    face_key = np.array(["1:left", "2:right", "1:left", "1:left", "label:5", "2:right"], dtype=object)
    streets = np.array([1, 2, 1, 1, 1, 2])
    keys = -np.arange(6, dtype=np.float64)
    rng = np.random.default_rng(0)
    # Three distinct faces: one each, the unsided one last because its street was already touched.
    assert list(avq.spread_mission(keys, face_key, streets, rng, mission_length=3)) == [0, 1, 4]
    # Short of faces, the mission fills from faces it already holds, still in key order.
    assert list(avq.spread_mission(keys, face_key, streets, rng, mission_length=5)) == [0, 1, 4, 2, 3]
    assert avq.spread_mission(np.empty(0), face_key[:0], streets[:0], rng).size == 0


def test_pool_defaults_the_face_columns_when_an_export_lacks_them():
    pool = make_pool([("NoSidewalk", 0, 0, 0)])
    bare = avq.Pool({name: values for name, values in pool.columns().items()
                     if name not in avq.Pool.OPTIONAL_DEFAULTS})
    assert list(bare.street_side) == [""] and list(bare.age_years) == [0.0] and not bare.ai_labeler.any()
    assert list(bare.face_keys()) == ["label:1"]
    assert not bare.faces()[0].any()


def test_faces_score_rescores_only_no_sidewalk_and_face_needs_votes_stops_at_the_settled_support():
    pool = face_pool()
    base = pool.new_score()
    scored = pool.faces_score()
    curb = pool.label_type == "CurbRamp"
    assert np.allclose(scored[curb], base[curb])
    keys = pool.face_keys()
    lone = np.flatnonzero(keys == "10:left")[0]
    settled = np.flatnonzero(keys == "20:left")[0]
    assert float(scored[lone]) == pytest.approx(200.0 + 200.0 + 60.0)
    assert float(scored[settled]) == pytest.approx((100.0 + 200.0 / 4 + 60.0) / 3)
    needs = pool.face_needs_votes()
    assert needs[lone] and not needs[settled]
    assert not needs[(pool.label_type == "NoSidewalk") & (pool.street_side == "")]


def test_type_weight_counts_faces_for_no_sidewalk_under_the_faces_policy():
    pool = face_pool()
    weight_col = pool.needs_votes()
    has_face, _, support = pool.faces()
    no_sidewalk = pool.label_type == "NoSidewalk"
    curb_ramp = pool.label_type == "CurbRamp"

    def weight(policy, label_type, type_mask, counted=weight_col):
        return avq._type_weight(policy, label_type, type_mask, counted, pool.face_keys(), has_face, support)

    # Faces A and B and the twelve lone faces still need votes; C has two agreeing votes, the unsided label no face.
    assert weight("faces", "NoSidewalk", no_sidewalk) == 14.0
    assert weight("new", "NoSidewalk", no_sidewalk) == float(np.count_nonzero(no_sidewalk))
    # Other types weigh by labels under every policy.
    assert weight("faces", "CurbRamp", curb_ramp) == 12.0
    # And NoSidewalk weighs nothing once every face is settled or every label is out of the queue.
    assert weight("faces", "NoSidewalk", no_sidewalk, np.zeros(len(pool), dtype=bool)) == 0.0


def test_pick_probabilities_under_the_faces_policy_serve_no_sidewalk_and_favour_lone_faces():
    pool = face_pool()
    rng = np.random.default_rng(4715)
    shares = avq.pick_probabilities(pool, "faces", rng, missions_per_type=200)
    assert shares.sum() == pytest.approx(1.0)
    no_sidewalk = pool.label_type == "NoSidewalk"
    assert shares[no_sidewalk].sum() > 0.0
    keys = pool.face_keys()
    lone = shares[keys == "10:left"].sum() / 3
    settled = shares[keys == "20:left"].sum() / 3
    assert lone > 4 * settled
    # The #4715 policy still holds NoSidewalk back while another type can fill a mission.
    held_back = avq.pick_probabilities(pool, "new", rng, missions_per_type=20)
    assert held_back[no_sidewalk].sum() == 0.0


def test_simulate_votes_under_the_faces_policy_spreads_no_sidewalk_votes_across_faces():
    pool = face_pool()
    rng = np.random.default_rng(4715)
    result = avq.simulate_votes(pool, "faces", 60, rng, p_correct=0.7)
    assert result["votes"] == 60
    assert result["on_decided_pct"] == 0.0


def test_simulate_no_sidewalk_votes_reports_faces_reached_and_votes_per_settled_face():
    pool = face_pool()
    rng = np.random.default_rng(4715)
    # 35 is not a multiple of the mission length, so the last mission stops partway.
    result = avq.simulate_no_sidewalk_votes(pool, "faces", 35, rng, p_correct=0.9)
    assert result["votes"] == 35
    assert 1 <= result["faces_reached"] <= 16
    assert result["faces_reached_per_1000"] == pytest.approx(1000.0 * result["faces_reached"] / 35)
    assert result["faces_newly_settled"] >= 1
    assert result["votes_per_settled_face"] == pytest.approx(35 / result["faces_newly_settled"])
    assert 0.0 <= result["on_single_labeler_pct"] <= 100.0
    assert result["max_votes_on_one_face"] >= 1
    # The per-label policies run the same simulation without the spread.
    for policy in ("old", "new"):
        assert avq.simulate_no_sidewalk_votes(pool, policy, 20, np.random.default_rng(1), 0.9)["votes"] == 20


def test_simulate_no_sidewalk_votes_with_nothing_to_vote_on():
    assert avq.simulate_no_sidewalk_votes(make_pool([("CurbRamp", 0, 0, 0)]), "faces", 10,
                                          np.random.default_rng(1), 0.9) == {"votes": 0}
    # NoSidewalk labels that never settle (all votes disagree) report no votes-per-settled-face.
    pool = make_pool([face(1, "left", "a")] * 3)
    result = avq.simulate_no_sidewalk_votes(pool, "faces", 6, np.random.default_rng(1), p_correct=0.0)
    assert result["faces_newly_settled"] == 0 and np.isnan(result["votes_per_settled_face"])


def test_vote_sim_face_support_moves_with_simulated_agrees():
    pool = face_pool()
    sim = avq._VoteSim(pool, "faces", np.random.default_rng(4715), p_correct=1.0)
    lone = int(np.flatnonzero(pool.face_keys() == "10:left")[0])
    before = int(sim.face_support()[lone])
    sim.vote(lone)  # p_correct = 1 and VOTE_PROBS_IF_CORRECT can still roll Unsure, so loop until an Agree lands
    while sim.added_agree[lone] == 0:
        sim.vote(lone)
    assert all(sim.face_support()[pool.face_keys() == "10:left"] == before + sim.added_agree[lone])
    assert sim.face_support_of(lone) == before + sim.added_agree[lone]
    # A pool with no faces at all returns the export's support untouched.
    bare = avq._VoteSim(make_pool([("CurbRamp", 0, 0, 0)]), "new", np.random.default_rng(1), 0.5)
    assert bare.face_support() is bare.initial_face_support
    assert bare.face_support_of(0) == 0


def test_pool_face_keys_are_computed_once():
    pool = face_pool()
    assert pool.face_keys() is pool.face_keys()
    assert pool.faces() is pool.faces()


def test_load_pool_reads_the_face_columns_and_tolerates_their_absence(tmp_path):
    base = {"agree_count": 0, "disagree_count": 0, "unsure_count": 0, "correct": "", "own_labels_validated": 300,
            "high_quality": "f", "low_quality": "f", "stale": "f", "recent": "f", "ai_result": ""}
    with_faces = tmp_path / "pool.csv"
    _write_csv(with_faces,
               POOL_CSV_FIELDS + ["street_edge_id", "street_side", "labeler_id", "ai_labeler", "age_years"],
               [dict(base, label_id=1, label_type="NoSidewalk", street_edge_id=7, street_side="left",
                     labeler_id="u1", ai_labeler="f", age_years="6.5"),
                dict(base, label_id=2, label_type="NoSidewalk", street_edge_id=7, street_side="",
                     labeler_id="u2", ai_labeler="t", age_years="0.25")])
    pool = avq.load_pool(str(with_faces))
    assert list(pool.street_edge_id) == [7, 7] and list(pool.street_side) == ["left", ""]
    assert list(pool.ai_labeler) == [False, True] and list(pool.age_years) == [6.5, 0.25]
    without = tmp_path / "old-pool.csv"
    _write_csv(without, POOL_CSV_FIELDS, [dict(base, label_id=1, label_type="NoSidewalk")])
    old = avq.load_pool(str(without))
    assert list(old.street_side) == [""] and list(old.age_years) == [0.0]


def test_build_report_adds_the_face_section_when_labels_have_sides():
    pool = face_pool()
    report = avq.build_report(pool, [validation_row(1, "Agree")], "sidewalk_test", votes=60, missions_per_type=20)
    assert "## NoSidewalk by block face (#5285)" in report
    assert "### (v) Forward simulation of the next NoSidewalk votes" in report
    assert "The simulation casts 30 votes, 2 per face" in report  # 15 faces, capped below the 60 requested
    assert "| 1 | 0 |" in report  # the lone-labeler, unconfirmed bucket
    assert "faces reached per 1,000 votes" in report


def test_build_report_explains_a_pool_without_sides():
    pool = make_pool([("CurbRamp", 0, 0, 0)] * 30 + [("NoSidewalk", 0, 0, 0)] * 30)
    report = avq.build_report(pool, [], "sidewalk_test", votes=20, missions_per_type=5)
    assert "nothing to group by face" in report


# Gaps the #4715 tests left.


def test_policy_keys_dispatch_every_sort_key_kind():
    scores = np.array([100.0, 400.0])
    rng = np.random.default_rng(1)
    assert avq._policy_keys("jitter", scores, rng).shape == (2,)
    assert avq._policy_keys("old", scores, rng).shape == (2,)
    assert avq._policy_keys("es1", scores, rng).shape == (2,)


def test_pick_probabilities_are_all_zero_when_no_type_can_fill_a_mission():
    pool = make_pool([("CurbRamp", 0, 0, 0)] * 3)
    assert not avq.pick_probabilities(pool, "new", np.random.default_rng(1), missions_per_type=5).any()


def test_pick_probabilities_fall_back_to_the_whole_type_when_its_queue_is_thin():
    # Ten CurbRamps make the type eligible, but only three still need votes, so the queue falls back to all ten.
    pool = make_pool([("CurbRamp", 0, 0, 0)] * 3 + [("CurbRamp", 4, 0, 0)] * 7)
    shares = avq.pick_probabilities(pool, "new", np.random.default_rng(1), missions_per_type=20)
    assert shares.sum() == pytest.approx(1.0)
    assert shares[3:].sum() > 0.0


def test_pick_probabilities_with_no_missions_simulated_are_all_zero():
    pool = make_pool([("CurbRamp", 0, 0, 0)] * 10)
    assert not avq.pick_probabilities(pool, "new", np.random.default_rng(1), missions_per_type=0).any()


def test_main_writes_to_stdout_without_an_out_path(tmp_path, capsys):
    pool_path = tmp_path / "pool.csv"
    _write_csv(
        pool_path,
        POOL_CSV_FIELDS,
        [{"label_id": index, "label_type": "CurbRamp", "agree_count": 0, "disagree_count": 0, "unsure_count": 0,
          "correct": "", "own_labels_validated": 300, "high_quality": "f", "low_quality": "f", "stale": "f",
          "recent": "f", "ai_result": ""} for index in range(1, 12)],
    )
    validations_path = tmp_path / "validations.csv"
    _write_csv(validations_path, VALIDATION_CSV_FIELDS, [])
    assert avq.main(["--pool", str(pool_path), "--validations", str(validations_path), "--votes", "10",
                     "--missions", "2"]) == 0
    assert capsys.readouterr().out.startswith("# Validate queue analysis -- `unknown`")
    assert avq.main(["--pool", str(pool_path), "--validations", str(validations_path), "--votes", "10",
                     "--missions", "2", "--city", "seattle"]) == 0
    assert capsys.readouterr().out.startswith("# Validate queue analysis -- `seattle`")


# The policy constants against their source of truth.

# Python name -> Scala name, where the mechanical CamelCase <-> UPPER_SNAKE mapping does not hold.
SCALA_NAME_EXCEPTIONS = {"HIGH_QUALITY_BONUS": "HighQualityLabelerBonus"}

MIRRORED_CONSTANTS = (
    "SETTLED_MARGIN", "MAX_CROWD_VOTES", "UNSURE_HEAVY_MIN_VOTES", "NEW_LABELER_OWN_LABELS_VALIDATED",
    "NEW_LABELER_BONUS", "HIGH_QUALITY_BONUS", "CONSENSUS_NEED_MAX", "RECENCY_BONUS", "PICK_WEIGHT_EXPONENT",
    "FACE_SINGLE_LABELER_BONUS", "AGE_POINTS_PER_YEAR", "AGE_BONUS_MAX", "FACE_SETTLED_SUPPORT",
)

_SCALA_VAL = re.compile(r"^\s*val\s+(\w+)\s*:\s*(?:Int|Double)\s*=\s*(.+?)\s*$")
_NUMERIC = re.compile(r"^-?\d+(?:\.\d+)?[dDfFlL]?$")


def scala_name(python_name):
    """`SETTLED_MARGIN` -> `SettledMargin`, unless the two sides chose different words."""
    return SCALA_NAME_EXCEPTIONS.get(python_name, "".join(part.capitalize() for part in python_name.split("_")))


def scala_vals(path):
    """Every `val Name: Int|Double = <rhs>` in a Scala file, as name -> the RHS text, untouched."""
    out = {}
    for line in path.read_text().splitlines():
        match = _SCALA_VAL.match(line)
        if match:
            out[match.group(1)] = match.group(2)
    return out


def resolve_scala_value(rhs, vals, depth=0):
    """A numeric literal as a float, or a same-file / `Object.Name` reference followed once; None when neither.

    The policy file is allowed to point one constant at another (`UserStatTable.OwnLabelsValidatedToJudge`), so a
    bare or qualified identifier is looked up in the file it names under app/models before giving up. Anything
    fancier is a sign the mirror in the Python tool needs a human, not a smarter parser.
    """
    if _NUMERIC.match(rhs):
        return float(rhs.rstrip("dDfFlL"))
    if depth > 2 or not re.match(r"^[\w.]+$", rhs):
        return None
    if "." not in rhs:
        return resolve_scala_value(vals[rhs], vals, depth + 1) if rhs in vals else None
    obj, name = rhs.rsplit(".", 1)
    for path in (REPO_ROOT / "app" / "models").rglob("*.scala"):
        if re.search(r"^\s*object\s+{0}\b".format(re.escape(obj)), path.read_text(), re.M):
            other = scala_vals(path)
            return resolve_scala_value(other[name], other, depth + 1) if name in other else None
    return None


@pytest.fixture(scope="module")
def policy_vals():
    if not POLICY_SCALA.exists():
        pytest.skip("{0} is not in this checkout".format(POLICY_SCALA))
    return scala_vals(POLICY_SCALA)


@pytest.mark.parametrize("python_name", MIRRORED_CONSTANTS)
def test_policy_constants_mirror_the_scala_source_of_truth(python_name, policy_vals):
    name = scala_name(python_name)
    assert name in policy_vals, "{0} has no `val {1}` in ValidationQueuePolicy.scala".format(python_name, name)
    value = resolve_scala_value(policy_vals[name], policy_vals)
    if value is None:
        pytest.skip("{0} = {1} is not a numeric literal the test can resolve; check {2} by hand".format(
            name, policy_vals[name], python_name))
    assert float(getattr(avq, python_name)) == value


def test_recency_window_in_the_sql_export_matches_the_scala_policy(policy_vals):
    if not POOL_SQL.exists():
        pytest.skip("{0} is not in this checkout".format(POOL_SQL))
    window = re.search(r"interval '(\d+) days'", POOL_SQL.read_text())
    assert window is not None, "pool.sql no longer derives `recent` from an interval literal"
    assert float(window.group(1)) == resolve_scala_value(policy_vals["RecencyWindowDays"], policy_vals)
