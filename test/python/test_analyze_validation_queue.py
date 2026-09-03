"""Unit tests for tools/analyze_validation_queue.py (#4715).

These pin the policy arithmetic the evidence report is built on, so a transcription slip between
`models.validation.ValidationQueuePolicy` and the analysis shows up here rather than as a wrong number in a doc.

Both halves of `make test-python` collect this directory, so everything here must run under Python 3.8 as well as
3.13: no `match`, no PEP 604 unions, no builtin generics in annotations.
"""

import csv

import numpy as np
import pytest

import analyze_validation_queue as avq


# Fixtures and helpers.


def make_pool(rows):
    """Build a Pool from compact tuples, defaulting every labeler to established and every audit task to clean.

    @param rows: Iterable of (label_type, agree, disagree, unsure) or the same plus a dict of column overrides.
    @returns: analyze_validation_queue.Pool.
    """
    columns = {
        "label_id": [], "label_type": [], "agree_count": [], "disagree_count": [], "unsure_count": [],
        "correct_is_null": [], "own_labels_validated": [], "high_quality": [], "low_quality": [], "stale": [],
        "recent": [], "ai_result": [],
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
    dtypes = {
        "label_id": np.int64, "label_type": object, "agree_count": np.int64, "disagree_count": np.int64,
        "unsure_count": np.int64, "correct_is_null": bool, "own_labels_validated": np.int64, "high_quality": bool,
        "low_quality": bool, "stale": bool, "recent": bool, "ai_result": object,
    }
    return avq.Pool({name: np.array(values, dtype=dtypes[name]) for name, values in columns.items()})


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


def test_no_sidewalk_is_held_back_unless_it_is_the_only_type_left():
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
        ["label_id", "label_type", "agree_count", "disagree_count", "unsure_count", "correct",
         "own_labels_validated", "high_quality", "low_quality", "stale", "recent", "ai_result"],
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
        ["label_id", "label_type", "validation_result", "end_timestamp", "source", "self_vote", "is_ai"],
        [{"label_id": 1, "label_type": "CurbRamp", "validation_result": "Agree",
          "end_timestamp": "2026-01-01 00:00:00+00", "source": "SidewalkAI", "self_vote": "f", "is_ai": "t"}],
    )
    rows = avq.load_validations(str(path))
    assert rows[0]["is_ai"] is True and rows[0]["self_vote"] is False


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
        ["label_id", "label_type", "agree_count", "disagree_count", "unsure_count", "correct",
         "own_labels_validated", "high_quality", "low_quality", "stale", "recent", "ai_result"],
        [{"label_id": index, "label_type": "CurbRamp", "agree_count": index % 3, "disagree_count": 0,
          "unsure_count": 0, "correct": "", "own_labels_validated": 300, "high_quality": "f", "low_quality": "f",
          "stale": "f", "recent": "f", "ai_result": ""} for index in range(1, 41)],
    )
    validations_path = tmp_path / "validations.csv"
    _write_csv(
        validations_path,
        ["label_id", "label_type", "validation_result", "end_timestamp", "source", "self_vote", "is_ai"],
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
