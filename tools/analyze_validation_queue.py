#!/usr/bin/env python3
"""Measure what Validate's queue actually serves, and what the #4715 policy would serve instead.

The issue's headline numbers came from ad-hoc SQL that nobody could re-run. This module is the reproducible
replacement: it takes two CSV exports of a city schema (tools/validation_queue/pool.sql and validations.sql, both
driven by tools/validation_queue/run.sh) and answers four questions, each once with NoSidewalk excluded and once
with it included, because Validate only serves NoSidewalk when it is the last type standing (#4715, @misaugstad):

  (i)   What is in the servable pool, by consensus status and by label type.
  (ii)  Where the picks go under today's sort key versus the candidate policies -- and how much of that is the
        sampler versus the retirement rule. Both are simulated by replaying the real selection procedure
        (LabelService.findValidLabelsForType: order the type's labels by the sort key, take the top 50, keep a
        random 10), not by an analytic shortcut, so the numbers hold at the batch sizes the app really uses.
  (iii) What the crowd already spent: every validation replayed in cast order, so each vote can be labelled with the
        label's margin at the moment it was cast, plus the settle-rate-by-prior-votes table that sets N_max.
  (iv)  A forward simulation of the next K votes under the old and the new policy, with an explicit voter model.

Everything here is pure and vectorized so the tests can pin it; the CLI only reads CSVs and formats markdown.

Usage:

    tools/validation_queue/run.sh sidewalk_seattle          # export + analyze in one step (the normal path)

    python3.13 tools/analyze_validation_queue.py \\
        --pool tmp/validation-queue/pool.csv \\
        --validations tmp/validation-queue/validations.csv \\
        --schema sidewalk_seattle --out tmp/validation-queue/report.md

Runs on Python 3.8 (the interpreter the deployed app shells out to) as well as 3.13, since both halves of
`make test-python` collect this module's tests. numpy is the only non-stdlib import.
"""

import argparse
import csv
import datetime
import sys

import numpy as np

# ---------------------------------------------------------------------------------------------------------------
# Policy constants. These mirror models.validation.ValidationQueuePolicy; a change there is a change here, and the
# report prints them so a stale copy is visible in the output rather than silent.
# ---------------------------------------------------------------------------------------------------------------

SETTLED_MARGIN = 2
MAX_CROWD_VOTES = 5
UNSURE_HEAVY_MIN_VOTES = 2
NEW_LABELER_OWN_LABELS_VALIDATED = 50
NEW_LABELER_BONUS = 150.0
HIGH_QUALITY_BONUS = 50.0
CONSENSUS_NEED_MAX = 200.0
RECENCY_BONUS = 25.0
PICK_WEIGHT_EXPONENT = 2.0

# The old sort key draws uniformly between a label's deterministic score and this ceiling, which is one point above
# the largest score the additive formula can produce.
OLD_SCORE_CEILING = 426.0

# LabelService: a Validate mission holds 10 labels, and findValidLabelsForType pulls 5x that many rows from the
# ordered query before shuffling and keeping 10.
MISSION_LENGTH = 10
BATCH_MULTIPLIER = 5

# getLabelTypeToValidate: every eligible type gets at least this share of missions before the rest is divided by
# each type's outstanding count.
TYPE_PROBABILITY_FLOOR = 0.02

# The bounded-jitter alternative the issue floated (`det + random() * 25`), kept as a comparison column.
JITTER_WIDTH = 25.0

# LabelTypeEnum.primaryLabelTypes and primaryValidateLabelTypes.
PRIMARY_LABEL_TYPES = ("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Crosswalk", "Signal", "NoSidewalk")
PRIMARY_VALIDATE_LABEL_TYPES = tuple(t for t in PRIMARY_LABEL_TYPES if t != "NoSidewalk")

# Voter model for the forward simulation (§iv). A validator agrees with a correct label 85% of the time and with an
# incorrect one 20% of the time; the unsure rate is flat at Seattle's observed 8%. These are assumptions, not
# measurements, so the report prints them next to the results.
VOTE_PROBS_IF_CORRECT = (0.85, 0.07, 0.08)
VOTE_PROBS_IF_INCORRECT = (0.20, 0.72, 0.08)

STATUS_ORDER = ("unvalidated", "unsure-only", "margin 1", "tied", "decided")
VOTE_BUCKET_ORDER = ("0", "1", "2", "3-4", "5+")


# ---------------------------------------------------------------------------------------------------------------
# Policy predicates and scores. Every one takes numpy arrays (or scalars) and returns the same shape.
# ---------------------------------------------------------------------------------------------------------------


def total_votes(agree, disagree, unsure):
    """Votes of every kind on a label; the quantity the crowd-vote cap counts.

    @param agree, disagree, unsure: Per-label vote counts.
    @returns: agree + disagree + unsure.
    """
    return np.asarray(agree) + np.asarray(disagree) + np.asarray(unsure)


def margin(agree, disagree):
    """Distance from consensus: |agree - disagree|."""
    return np.abs(np.asarray(agree) - np.asarray(disagree))


def needs_votes(agree, disagree, unsure, settled_margin=SETTLED_MARGIN, max_crowd_votes=MAX_CROWD_VOTES):
    """The retirement rule, inverted: True while the crowd should still be asked about this label.

    A label with no votes always qualifies, so the cap can never lock out a fresh label; otherwise it must still be
    undecided *and* under the vote cap.

    >>> bool(needs_votes(0, 0, 0)), bool(needs_votes(1, 0, 0)), bool(needs_votes(2, 0, 0)), bool(needs_votes(0, 0, 5))
    (True, True, False, False)
    """
    votes = total_votes(agree, disagree, unsure)
    return (votes == 0) | ((margin(agree, disagree) < settled_margin) & (votes < max_crowd_votes))


def crowd_capped_out(agree, disagree, unsure, settled_margin=SETTLED_MARGIN, max_crowd_votes=MAX_CROWD_VOTES):
    """Undecided after the crowd has already spent its full vote budget on the label."""
    votes = total_votes(agree, disagree, unsure)
    return (margin(agree, disagree) < settled_margin) & (votes >= max_crowd_votes)


def unsure_heavy(agree, disagree, unsure, settled_margin=SETTLED_MARGIN, min_unsure=UNSURE_HEAVY_MIN_VOTES):
    """Undecided, with at least `min_unsure` unsure votes that also outnumber the decisive ones.

    A 0/0/2 label reads as "two validators looked and neither could tell", which is an expert's problem rather than
    a third crowd vote's.
    """
    agree = np.asarray(agree)
    disagree = np.asarray(disagree)
    unsure = np.asarray(unsure)
    return (margin(agree, disagree) < settled_margin) & (unsure >= min_unsure) & (unsure >= agree + disagree)


def ai_contested(agree, disagree, ai_result, settled_margin=SETTLED_MARGIN):
    """The AI voted one way and the humans lean the other, on a label nobody has settled yet.

    The AI's own vote sits inside agree_count/disagree_count, so it is subtracted before the two sides are compared.
    A label the humans have already settled against the AI is finished, not triage.

    @param ai_result: Per-label AI verdict as text ('Agree', 'Disagree', 'Unsure', or '' when the AI never voted).
    """
    agree = np.asarray(agree)
    disagree = np.asarray(disagree)
    ai_result = np.asarray(ai_result)
    ai_agreed = ai_result == "Agree"
    ai_disagreed = ai_result == "Disagree"
    return (margin(agree, disagree) < settled_margin) & (
        (ai_agreed & (disagree > agree - 1)) | (ai_disagreed & (agree > disagree - 1))
    )


def triage(agree, disagree, unsure, ai_result):
    """Labels the crowd is stuck on: capped out, unsure-heavy, or human-vs-AI contested. Expert Validate's queue."""
    return (
        crowd_capped_out(agree, disagree, unsure)
        | unsure_heavy(agree, disagree, unsure)
        | ai_contested(agree, disagree, ai_result)
    )


def consensus_need(agree, disagree, unsure=None):
    """Distance-from-consensus term: 200 / (1 + margin^2 + unsure).

    Passing `unsure=None` gives the current formula, which ignores unsure votes entirely; passing the counts gives
    the #4715 version, where a lone unsure vote halves the need exactly as a lone agree does.

    >>> float(consensus_need(0, 0)), float(consensus_need(1, 1)), float(consensus_need(0, 0, 2))
    (200.0, 200.0, 66.66666666666667)
    """
    m = margin(agree, disagree).astype(np.float64)
    extra = 0.0 if unsure is None else np.asarray(unsure).astype(np.float64)
    return CONSENSUS_NEED_MAX / (1.0 + m * m + extra)


def old_priority_score(agree, disagree, correct_is_null, own_labels_validated, high_quality, low_quality, stale,
                       recent):
    """Today's deterministic score, 0 < score <= 425 (LabelTable.retrieveLabelListForValidationQuery).

    The new-labeler bonus is gated on `correct IS NULL`, which is what makes a single AI vote silently strip it.
    """
    new_labeler = (
        (np.asarray(own_labels_validated) < NEW_LABELER_OWN_LABELS_VALIDATED)
        & np.asarray(correct_is_null)
        & ~np.asarray(low_quality)
        & ~np.asarray(stale)
    )
    return (
        new_labeler * NEW_LABELER_BONUS
        + np.asarray(high_quality) * HIGH_QUALITY_BONUS
        + consensus_need(agree, disagree)
        + np.asarray(recent) * RECENCY_BONUS
    )


def new_priority_score(agree, disagree, unsure, own_labels_validated, high_quality, low_quality, stale, recent):
    """The #4715 deterministic score: unsure votes lower the need, and the new-labeler bonus follows `needs_votes`.

    Tying the bonus to `needs_votes` rather than `correct IS NULL` is the one behavioural change inside the score:
    a label whose only vote is the AI's still needs a human, so it keeps the emphasis it was meant to have.
    """
    new_labeler = (
        (np.asarray(own_labels_validated) < NEW_LABELER_OWN_LABELS_VALIDATED)
        & needs_votes(agree, disagree, unsure)
        & ~np.asarray(low_quality)
        & ~np.asarray(stale)
    )
    return (
        new_labeler * NEW_LABELER_BONUS
        + np.asarray(high_quality) * HIGH_QUALITY_BONUS
        + consensus_need(agree, disagree, unsure)
        + np.asarray(recent) * RECENCY_BONUS
    )


def old_pick_weight(score):
    """Analytic pick weight of today's key: P(a label sorts first) is proportional to 1 / (426 - score).

    This is the shortcut the issue used. It is exact for top-1 selection and only approximate for the top-50 batch
    the app really takes, which is why the report also carries a Monte-Carlo column of the real procedure.
    """
    return 1.0 / (OLD_SCORE_CEILING - np.asarray(score, dtype=np.float64))


# ---------------------------------------------------------------------------------------------------------------
# Sort keys. Each returns one draw of the key the corresponding ORDER BY produces; the largest key sorts first.
# ---------------------------------------------------------------------------------------------------------------


def old_sort_keys(score, rng):
    """`det + random() * (426 - det)`: a uniform draw between the label's score and the ceiling."""
    score = np.asarray(score, dtype=np.float64)
    return score + rng.random(score.shape) * (OLD_SCORE_CEILING - score)


def es_pick_weights(score, exponent=PICK_WEIGHT_EXPONENT):
    """`greatest(score, 1) ^ exponent`: the weight a label is sampled in proportion to.

    The `greatest` guards the division in the key below; today's score is always positive, but a future tunable
    could make it zero.
    """
    return np.power(np.maximum(np.asarray(score, dtype=np.float64), 1.0), exponent)


def _es_keys_from_weights(weight, rng):
    """The E-S key for already-computed weights, which is the form the mission loops reuse."""
    return np.log(1.0 - rng.random(weight.shape)) / weight


def es_sort_keys(score, rng, exponent=PICK_WEIGHT_EXPONENT):
    """Efraimidis-Spirakis key `ln(random()) / greatest(score, 1)^exponent`, largest first.

    Taking the top k of that order is a weighted random sample without replacement with P(pick) proportional to
    score^exponent. The draw is taken from (0, 1] rather than [0, 1) so ln() never sees zero; the two differ only on
    a measure-zero point, where the -infinity key would sort last anyway.
    """
    return _es_keys_from_weights(es_pick_weights(score, exponent), rng)


def jitter_sort_keys(score, rng, width=JITTER_WIDTH):
    """`det + random() * 25`: the bounded-jitter alternative, which is strict tiering with a tie-breaker."""
    score = np.asarray(score, dtype=np.float64)
    return score + rng.random(score.shape) * width


# ---------------------------------------------------------------------------------------------------------------
# Selection mechanics.
# ---------------------------------------------------------------------------------------------------------------


def sample_mission(keys, rng, mission_length=MISSION_LENGTH, batch_multiplier=BATCH_MULTIPLIER):
    """Replay one mission's selection: take the top `mission_length * batch_multiplier` keys, keep a random subset.

    This is LabelService.findValidLabelsForType's first batch, which is the only one that runs when imagery checks
    all pass. Returned indices are positions in `keys`.

    @param keys: Sort keys for every candidate label of the chosen type; larger sorts first.
    @returns: Array of up to `mission_length` indices, without replacement.
    """
    keys = np.asarray(keys)
    n = keys.size
    if n == 0:
        return np.empty(0, dtype=np.intp)
    batch = min(n, mission_length * batch_multiplier)
    top = np.argpartition(-keys, batch - 1)[:batch] if batch < n else np.arange(n)
    return rng.choice(top, size=min(mission_length, top.size), replace=False)


def type_probabilities(weights, floor=TYPE_PROBABILITY_FLOOR):
    """getLabelTypeToValidate's draw: a floor per eligible type, the rest split by each type's outstanding count.

    @param weights: One outstanding-label count per eligible type, in a fixed order.
    @returns: Probabilities in the same order, summing to 1. A single type takes everything; all-zero weights split
              evenly, matching the service's own fallback.

    >>> [round(p, 4) for p in type_probabilities(np.array([90.0, 10.0]))]
    [0.884, 0.116]
    """
    weights = np.asarray(weights, dtype=np.float64)
    n = weights.size
    if n == 0:
        return np.empty(0, dtype=np.float64)
    if n == 1:
        return np.ones(1, dtype=np.float64)
    total = weights.sum()
    if total <= 0:
        return np.full(n, 1.0 / n)
    return floor + (1.0 - n * floor) * (weights / total)


def eligible_types(available_by_type, mission_length=MISSION_LENGTH, serve_no_sidewalk=False):
    """Types Validate will consider: enough labels for a whole mission, and NoSidewalk only when nothing else is.

    @param available_by_type: Mapping of label type name to how many labels of it the viewer could be served.
    @param serve_no_sidewalk: Keep NoSidewalk in the running even when other types are available. The app never
                              does this; it is how the report answers "and what if we did serve NoSidewalk?".
    @returns: List of type names in PRIMARY_LABEL_TYPES order.

    >>> eligible_types({"CurbRamp": 40, "NoSidewalk": 40, "Signal": 3})
    ['CurbRamp']
    >>> eligible_types({"NoSidewalk": 40})
    ['NoSidewalk']
    """
    avail = [t for t in PRIMARY_LABEL_TYPES if available_by_type.get(t, 0) >= mission_length]
    if serve_no_sidewalk or len(avail) == 1:
        return avail
    return [t for t in avail if t in PRIMARY_VALIDATE_LABEL_TYPES]


# ---------------------------------------------------------------------------------------------------------------
# Bucketing.
# ---------------------------------------------------------------------------------------------------------------


def status_of(agree, disagree, unsure, settled_margin=SETTLED_MARGIN):
    """Label each row with its consensus status: unvalidated / unsure-only / margin 1 / tied / decided.

    The buckets are disjoint and ordered by how much the crowd has settled: no votes at all, then votes that carry
    no verdict, then the two undecided shapes, then decided.

    >>> list(status_of(np.array([0, 0, 1, 1, 3]), np.array([0, 0, 0, 1, 0]), np.array([0, 2, 0, 0, 0])))
    ['unvalidated', 'unsure-only', 'margin 1', 'tied', 'decided']
    """
    agree = np.asarray(agree)
    disagree = np.asarray(disagree)
    unsure = np.asarray(unsure)
    out = np.full(agree.shape, "margin 1", dtype=object)
    m = margin(agree, disagree)
    out[m >= settled_margin] = "decided"
    tied = (m == 0) & (agree > 0)
    out[tied] = "tied"
    out[(agree == 0) & (disagree == 0) & (unsure > 0)] = "unsure-only"
    out[total_votes(agree, disagree, unsure) == 0] = "unvalidated"
    return out


def vote_bucket(votes):
    """Bucket a total vote count into the 0 / 1 / 2 / 3-4 / 5+ bands the maintainers reason in."""
    votes = np.asarray(votes)
    out = np.full(votes.shape, "5+", dtype=object)
    out[votes <= 4] = "3-4"
    out[votes == 2] = "2"
    out[votes == 1] = "1"
    out[votes == 0] = "0"
    return out


# ---------------------------------------------------------------------------------------------------------------
# Historical replay.
# ---------------------------------------------------------------------------------------------------------------


def replay_margins(validations, settled_margin=SETTLED_MARGIN):
    """Walk every validation in cast order and record what the label looked like immediately before each vote.

    This is the measurement behind "a quarter of 2026's votes landed on labels that were already settled": a vote is
    wasted if the label's margin already met `settled_margin` when it was cast, and it settles the label if the
    margin crossed that line because of it.

    Self-votes are dropped: a labeler validating their own label is a different mechanism, and counting it would
    credit or blame the queue for a label it never served.

    @param validations: Rows as dicts with label_id, label_type, validation_result, end_timestamp, source,
                        self_vote, is_ai. Order within a label_id is respected as given.
    @returns: List of per-vote dicts adding prior_votes, prior_margin, wasted and settled.

    >>> rows = [{'label_id': 1, 'label_type': 'CurbRamp', 'validation_result': r, 'end_timestamp': '2026-01-01',
    ...          'source': 'Validate', 'self_vote': False, 'is_ai': False} for r in ('Agree', 'Agree', 'Agree')]
    >>> [(v['prior_votes'], v['wasted'], v['settled']) for v in replay_margins(rows)]
    [(0, False, False), (1, False, True), (2, True, False)]
    """
    counts = {}
    out = []
    for row in validations:
        if row["self_vote"]:
            continue
        label_id = row["label_id"]
        agree, disagree, unsure = counts.get(label_id, (0, 0, 0))
        prior_votes = agree + disagree + unsure
        prior_margin = abs(agree - disagree)
        result = row["validation_result"]
        if result == "Agree":
            agree += 1
        elif result == "Disagree":
            disagree += 1
        else:
            unsure += 1
        counts[label_id] = (agree, disagree, unsure)
        post_margin = abs(agree - disagree)
        record = dict(row)
        record["prior_votes"] = prior_votes
        record["prior_margin"] = prior_margin
        record["wasted"] = prior_margin >= settled_margin
        record["settled"] = prior_margin < settled_margin <= post_margin
        out.append(record)
    return out


def settle_rate_by_prior_votes(replayed, max_prior=9):
    """How often the next vote settles a label, by how many votes the label already carried.

    The rate that matters for N_max is measured over votes cast while the label was **still undecided**: a vote on
    an already-settled label cannot settle anything, and mixing those in makes the series alternate with the parity
    of the vote count rather than show the crowd running out of information. Both denominators are returned so the
    report can show how much of each depth was already waste.

    @returns: List of dicts with prior_votes (the last bucket lumps everything deeper), votes, wasted,
              undecided_votes, settled_pct and unsure_pct (both over undecided_votes), ordered by prior_votes.

    >>> rows = [{'label_id': 1, 'label_type': 'CurbRamp', 'validation_result': 'Agree',
    ...          'end_timestamp': '2026', 'source': 'Validate', 'self_vote': False, 'is_ai': False}] * 3
    >>> [(r['prior_votes'], r['undecided_votes'], r['settled_pct']) for r in
    ...  settle_rate_by_prior_votes(replay_margins(rows))]
    [(0, 1, 0.0), (1, 1, 100.0), (2, 0, 0.0)]
    """
    buckets = {}
    for row in replayed:
        key = min(row["prior_votes"], max_prior)
        votes, wasted, undecided, settled, unsure = buckets.get(key, (0, 0, 0, 0, 0))
        buckets[key] = (
            votes + 1,
            wasted + (1 if row["wasted"] else 0),
            undecided + (0 if row["wasted"] else 1),
            settled + (1 if row["settled"] else 0),
            unsure + (1 if row["validation_result"] == "Unsure" and not row["wasted"] else 0),
        )
    out = []
    for key in sorted(buckets):
        votes, wasted, undecided, settled, unsure = buckets[key]
        out.append({
            "prior_votes": key,
            "votes": votes,
            "wasted": wasted,
            "undecided_votes": undecided,
            "settled_pct": 100.0 * settled / undecided if undecided else 0.0,
            "unsure_pct": 100.0 * unsure / undecided if undecided else 0.0,
        })
    return out


def waste_by(replayed, key_fn):
    """Share of votes that landed on an already-settled label, grouped by whatever `key_fn` returns.

    @param key_fn: Called with one replayed vote; its return value is the group.
    @returns: List of dicts with group, votes, wasted, wasted_pct, sorted by group.
    """
    buckets = {}
    for row in replayed:
        key = key_fn(row)
        votes, wasted = buckets.get(key, (0, 0))
        buckets[key] = (votes + 1, wasted + (1 if row["wasted"] else 0))
    return [
        {
            "group": key,
            "votes": buckets[key][0],
            "wasted": buckets[key][1],
            "wasted_pct": 100.0 * buckets[key][1] / buckets[key][0],
        }
        for key in sorted(buckets)
    ]


# ---------------------------------------------------------------------------------------------------------------
# Pool container and the two policies as data.
# ---------------------------------------------------------------------------------------------------------------


class Pool(object):
    """The servable label pool as parallel numpy arrays, plus the derived columns every section needs."""

    def __init__(self, columns):
        """@param columns: Mapping of pool.sql column name to a numpy array, all the same length."""
        self.label_id = columns["label_id"]
        self.label_type = columns["label_type"]
        self.agree = columns["agree_count"]
        self.disagree = columns["disagree_count"]
        self.unsure = columns["unsure_count"]
        self.correct_is_null = columns["correct_is_null"]
        self.own_labels_validated = columns["own_labels_validated"]
        self.high_quality = columns["high_quality"]
        self.low_quality = columns["low_quality"]
        self.stale = columns["stale"]
        self.recent = columns["recent"]
        self.ai_result = columns["ai_result"]

    def __len__(self):
        return int(self.label_id.size)

    def subset(self, mask):
        """A new Pool holding only the rows `mask` selects."""
        return Pool(
            {
                "label_id": self.label_id[mask],
                "label_type": self.label_type[mask],
                "agree_count": self.agree[mask],
                "disagree_count": self.disagree[mask],
                "unsure_count": self.unsure[mask],
                "correct_is_null": self.correct_is_null[mask],
                "own_labels_validated": self.own_labels_validated[mask],
                "high_quality": self.high_quality[mask],
                "low_quality": self.low_quality[mask],
                "stale": self.stale[mask],
                "recent": self.recent[mask],
                "ai_result": self.ai_result[mask],
            }
        )

    def without_no_sidewalk(self):
        """The pool as Validate normally sees it: NoSidewalk is held back unless it is the last type available."""
        return self.subset(self.label_type != "NoSidewalk")

    def status(self):
        return status_of(self.agree, self.disagree, self.unsure)

    def needs_votes(self):
        return needs_votes(self.agree, self.disagree, self.unsure)

    def triage(self):
        return triage(self.agree, self.disagree, self.unsure, self.ai_result)

    def new_labeler(self):
        """Labels by an author with few of their own labels validated, off an audit task nobody has flagged.

        This is the set the +150 bonus is *about*, and it does not move when the policy does, which is what makes
        the pick shares in the report comparable across policies. The two gates that pick a subset of it out for
        the bonus itself are `new_labeler_bonus_old` and `new_labeler_bonus_new`.
        """
        return (
            (self.own_labels_validated < NEW_LABELER_OWN_LABELS_VALIDATED) & ~self.low_quality & ~self.stale
        )

    def new_labeler_bonus_old(self):
        """The subset today's formula pays the bonus on: gated on `correct IS NULL`, which a lone AI vote clears."""
        return self.new_labeler() & self.correct_is_null

    def new_labeler_bonus_new(self):
        """The subset #4715 pays the bonus on: gated on `needs_votes`, so an AI-only label keeps it."""
        return self.new_labeler() & self.needs_votes()

    def old_score(self):
        return old_priority_score(self.agree, self.disagree, self.correct_is_null, self.own_labels_validated,
                                  self.high_quality, self.low_quality, self.stale, self.recent)

    def new_score(self):
        return new_priority_score(self.agree, self.disagree, self.unsure, self.own_labels_validated,
                                  self.high_quality, self.low_quality, self.stale, self.recent)


# Each policy is (deterministic score, sort key, which labels are eligible, what type selection weights on).
# 'old' is today's behaviour; 'new' is #4715. The three in between change one thing at a time, which is how the
# report can say whether the sampler or the retirement rule is doing the work.
POLICIES = {
    "old": {"score": "old", "key": "old", "queue": "any", "type_weight": "unvalidated"},
    "es1": {"score": "new", "key": "es1", "queue": "any", "type_weight": "unvalidated"},
    "es2": {"score": "new", "key": "es2", "queue": "any", "type_weight": "unvalidated"},
    "jitter": {"score": "new", "key": "jitter", "queue": "any", "type_weight": "unvalidated"},
    "new": {"score": "new", "key": "es2", "queue": "needs_votes", "type_weight": "needs_votes"},
}

POLICY_LABELS = {
    "old": "OLD (today)",
    "es1": "sampler only, P(pick) prop. score",
    "es2": "sampler only, P(pick) prop. score^2",
    "jitter": "sampler only, bounded jitter +25",
    "new": "NEW (retirement + score^2)",
}


def _policy_scores(pool, policy):
    return pool.old_score() if POLICIES[policy]["score"] == "old" else pool.new_score()


def _policy_keys(policy, scores, rng):
    kind = POLICIES[policy]["key"]
    if kind == "old":
        return old_sort_keys(scores, rng)
    if kind == "jitter":
        return jitter_sort_keys(scores, rng)
    return es_sort_keys(scores, rng, 1.0 if kind == "es1" else PICK_WEIGHT_EXPONENT)


def _key_sampler(policy, scores):
    """Bind a policy's sort key to a fixed score array, precomputing the part that does not change between missions.

    The E-S weight is the same for every mission drawn from the same pool snapshot, and recomputing
    `power(score, 2)` over a hundred thousand labels inside a 2,000-iteration loop is most of the runtime if it is
    not hoisted out.

    @returns: A callable taking an rng and returning one fresh draw of the sort key, largest first.
    """
    kind = POLICIES[policy]["key"]
    scores = np.asarray(scores, dtype=np.float64)
    if kind == "old":
        return lambda rng: old_sort_keys(scores, rng)
    if kind == "jitter":
        return lambda rng: jitter_sort_keys(scores, rng)
    weight = es_pick_weights(scores, 1.0 if kind == "es1" else PICK_WEIGHT_EXPONENT)
    return lambda rng: _es_keys_from_weights(weight, rng)


def _policy_eligible(pool, policy):
    """Boolean mask of the labels the policy's first queue would draw from."""
    if POLICIES[policy]["queue"] == "needs_votes":
        return pool.needs_votes()
    return np.ones(len(pool), dtype=bool)


def _policy_type_weights(pool, policy):
    """Per-label indicator of what type selection counts for this policy."""
    if POLICIES[policy]["type_weight"] == "needs_votes":
        return pool.needs_votes()
    return pool.correct_is_null


# ---------------------------------------------------------------------------------------------------------------
# (ii) Where the picks go.
# ---------------------------------------------------------------------------------------------------------------


def pick_probabilities(pool, policy, rng, missions_per_type=2000, serve_no_sidewalk=False):
    """Monte-Carlo the real selection procedure and return each label's share of served slots.

    Type selection and label selection are simulated separately, which is exactly how the app works: the type is
    drawn once per mission from `type_probabilities`, and the labels come from that type alone. Running a fixed
    number of missions per type and then weighting by the type's probability is the same expectation as drawing the
    type at random, with far less variance for the same runtime.

    A label type whose queue cannot fill a mission falls back to the whole type, mirroring the cascade's last step.

    @param missions_per_type: Missions simulated per eligible type; the plan asks for at least 2,000.
    @returns: Float array over the pool, summing to 1 -- the expected share of served slots each label receives.
    """
    scores = _policy_scores(pool, policy)
    eligible = _policy_eligible(pool, policy)
    weight_col = _policy_type_weights(pool, policy)

    available = {}
    for label_type in PRIMARY_LABEL_TYPES:
        available[label_type] = int(np.count_nonzero(pool.label_type == label_type))
    types = eligible_types(available, serve_no_sidewalk=serve_no_sidewalk)
    if not types:
        return np.zeros(len(pool), dtype=np.float64)

    weights = np.array([np.count_nonzero(weight_col & (pool.label_type == t)) for t in types], dtype=np.float64)
    probs = type_probabilities(weights)

    shares = np.zeros(len(pool), dtype=np.float64)
    for label_type, prob in zip(types, probs):
        of_type = pool.label_type == label_type
        idx = np.flatnonzero(of_type & eligible)
        if idx.size < MISSION_LENGTH:
            idx = np.flatnonzero(of_type)
        if idx.size == 0:
            continue
        counts = np.zeros(idx.size, dtype=np.int64)
        draw_keys = _key_sampler(policy, scores[idx])
        for _ in range(missions_per_type):
            np.add.at(counts, sample_mission(draw_keys(rng), rng), 1)
        total = counts.sum()
        if total:
            shares[idx] += prob * (counts / total)
    return shares


def share_by_group(shares, groups, order):
    """Sum per-label pick shares into named groups, as percentages.

    @param shares: Per-label share of served slots (summing to 1).
    @param groups: Per-label group name.
    @param order: Group names to report, in order.
    @returns: Dict of group name to percent of picks.
    """
    return {name: 100.0 * float(shares[groups == name].sum()) for name in order}


# ---------------------------------------------------------------------------------------------------------------
# (iv) Forward simulation.
# ---------------------------------------------------------------------------------------------------------------


def simulate_votes(pool, policy, n_votes, rng, p_correct, missions=None, serve_no_sidewalk=False):
    """Cast `n_votes` simulated validations under one policy and report where they landed.

    Counts are updated after every vote, so a label that settles mid-mission stops looking undecided to the next
    mission -- the app's own behaviour is coarser (counts move at submit), which makes this the optimistic case for
    both policies and so a fair comparison.

    @param p_correct: Probability a label is genuinely correct, estimated from the decided part of the pool.
    @param missions: Cap on missions simulated; defaults to exactly enough for `n_votes`.
    @returns: Dict of headline metrics, all counts of the simulated votes only.
    """
    agree = pool.agree.astype(np.int64).copy()
    disagree = pool.disagree.astype(np.int64).copy()
    unsure = pool.unsure.astype(np.int64).copy()
    correct_is_null = pool.correct_is_null.copy()
    truth = rng.random(len(pool)) < p_correct

    available = {t: int(np.count_nonzero(pool.label_type == t)) for t in PRIMARY_LABEL_TYPES}
    types = eligible_types(available, serve_no_sidewalk=serve_no_sidewalk)
    type_masks = {t: pool.label_type == t for t in types}
    weight_kind = POLICIES[policy]["type_weight"]
    queue_kind = POLICIES[policy]["queue"]

    votes_cast = np.zeros(len(pool), dtype=np.int64)
    started_at_zero = total_votes(agree, disagree, unsure) == 0
    on_decided = 0
    on_capped = 0
    newly_settled = 0
    cast = 0
    max_missions = missions if missions is not None else -(-n_votes // MISSION_LENGTH)

    for _ in range(max_missions):
        if cast >= n_votes or not types:
            break
        nv = needs_votes(agree, disagree, unsure)
        weight_col = nv if weight_kind == "needs_votes" else correct_is_null
        weights = np.array([np.count_nonzero(weight_col & type_masks[t]) for t in types], dtype=np.float64)
        label_type = types[int(rng.choice(len(types), p=type_probabilities(weights)))]

        of_type = type_masks[label_type]
        idx = np.flatnonzero(of_type & nv) if queue_kind == "needs_votes" else np.flatnonzero(of_type)
        if idx.size < MISSION_LENGTH:
            idx = np.flatnonzero(of_type)
        if idx.size == 0:
            continue

        if POLICIES[policy]["score"] == "old":
            scores = old_priority_score(agree[idx], disagree[idx], correct_is_null[idx],
                                        pool.own_labels_validated[idx], pool.high_quality[idx],
                                        pool.low_quality[idx], pool.stale[idx], pool.recent[idx])
        else:
            scores = new_priority_score(agree[idx], disagree[idx], unsure[idx], pool.own_labels_validated[idx],
                                        pool.high_quality[idx], pool.low_quality[idx], pool.stale[idx],
                                        pool.recent[idx])

        for position in sample_mission(_policy_keys(policy, scores, rng), rng):
            if cast >= n_votes:
                break
            i = int(idx[position])
            was_settled = abs(agree[i] - disagree[i]) >= SETTLED_MARGIN
            if was_settled:
                on_decided += 1
            if agree[i] + disagree[i] + unsure[i] >= MAX_CROWD_VOTES:
                on_capped += 1
            probs = VOTE_PROBS_IF_CORRECT if truth[i] else VOTE_PROBS_IF_INCORRECT
            roll = rng.random()
            if roll < probs[0]:
                agree[i] += 1
            elif roll < probs[0] + probs[1]:
                disagree[i] += 1
            else:
                unsure[i] += 1
            correct_is_null[i] = False
            votes_cast[i] += 1
            cast += 1
            if not was_settled and abs(agree[i] - disagree[i]) >= SETTLED_MARGIN:
                newly_settled += 1

    reached_zero = int(np.count_nonzero(started_at_zero & (votes_cast > 0)))
    return {
        "votes": cast,
        "on_decided_pct": 100.0 * on_decided / cast if cast else 0.0,
        "on_capped_pct": 100.0 * on_capped / cast if cast else 0.0,
        "zero_vote_labels_reached": reached_zero,
        "newly_settled": newly_settled,
        "max_votes_on_one_label": int(votes_cast.max()) if cast else 0,
        "votes_per_settled_label": cast / newly_settled if newly_settled else float("nan"),
    }


# ---------------------------------------------------------------------------------------------------------------
# CSV loading.
# ---------------------------------------------------------------------------------------------------------------


def _to_bool(value):
    """psql's CSV booleans: 't' / 'f', with an empty field for NULL (read as False)."""
    return value == "t"


def load_pool(path):
    """Read pool.sql's CSV into a Pool.

    @param path: Path to the exported pool.csv.
    @returns: Pool, with `correct_is_null` derived from the nullable `correct` column.
    """
    rows = {name: [] for name in ("label_id", "label_type", "agree_count", "disagree_count", "unsure_count",
                                  "correct_is_null", "own_labels_validated", "high_quality", "low_quality", "stale",
                                  "recent", "ai_result")}
    with open(path, newline="") as handle:
        for record in csv.DictReader(handle):
            rows["label_id"].append(int(record["label_id"]))
            rows["label_type"].append(record["label_type"])
            rows["agree_count"].append(int(record["agree_count"]))
            rows["disagree_count"].append(int(record["disagree_count"]))
            rows["unsure_count"].append(int(record["unsure_count"]))
            rows["correct_is_null"].append(record["correct"] == "")
            rows["own_labels_validated"].append(int(record["own_labels_validated"]))
            rows["high_quality"].append(_to_bool(record["high_quality"]))
            rows["low_quality"].append(_to_bool(record["low_quality"]))
            rows["stale"].append(_to_bool(record["stale"]))
            rows["recent"].append(_to_bool(record["recent"]))
            rows["ai_result"].append(record["ai_result"])
    return Pool(
        {
            "label_id": np.array(rows["label_id"], dtype=np.int64),
            "label_type": np.array(rows["label_type"], dtype=object),
            "agree_count": np.array(rows["agree_count"], dtype=np.int64),
            "disagree_count": np.array(rows["disagree_count"], dtype=np.int64),
            "unsure_count": np.array(rows["unsure_count"], dtype=np.int64),
            "correct_is_null": np.array(rows["correct_is_null"], dtype=bool),
            "own_labels_validated": np.array(rows["own_labels_validated"], dtype=np.int64),
            "high_quality": np.array(rows["high_quality"], dtype=bool),
            "low_quality": np.array(rows["low_quality"], dtype=bool),
            "stale": np.array(rows["stale"], dtype=bool),
            "recent": np.array(rows["recent"], dtype=bool),
            "ai_result": np.array(rows["ai_result"], dtype=object),
        }
    )


def load_validations(path):
    """Read validations.sql's CSV into the row dicts `replay_margins` expects, in export order."""
    out = []
    with open(path, newline="") as handle:
        for record in csv.DictReader(handle):
            out.append(
                {
                    "label_id": int(record["label_id"]),
                    "label_type": record["label_type"],
                    "validation_result": record["validation_result"],
                    "end_timestamp": record["end_timestamp"],
                    "source": record["source"],
                    "self_vote": _to_bool(record["self_vote"]),
                    "is_ai": _to_bool(record["is_ai"]),
                }
            )
    return out


# ---------------------------------------------------------------------------------------------------------------
# Report formatting.
# ---------------------------------------------------------------------------------------------------------------


def markdown_table(headers, rows):
    """Render a markdown table. Cells are stringified as given; numbers are formatted by the caller."""
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
    return "\n".join(lines)


def _pct(value):
    return "{0:.1f}".format(value)


def _int(value):
    return "{0:,}".format(int(value))


def _pool_composition_section(pool):
    """(i) Pool composition by consensus status, then by label type."""
    status = pool.status()
    nv = pool.needs_votes()
    tri = pool.triage()
    capped = crowd_capped_out(pool.agree, pool.disagree, pool.unsure)
    n = len(pool)
    rows = []
    for name in STATUS_ORDER:
        mask = status == name
        count = int(np.count_nonzero(mask))
        rows.append([
            name, _int(count), _pct(100.0 * count / n),
            _int(np.count_nonzero(mask & nv)), _int(np.count_nonzero(mask & capped)),
            _int(np.count_nonzero(mask & tri)),
        ])
    rows.append([
        "**total**", _int(n), "100.0", _int(np.count_nonzero(nv)), _int(np.count_nonzero(capped)),
        _int(np.count_nonzero(tri)),
    ])
    by_status = markdown_table(
        ["status", "labels", "% pool", "still needs votes", "retired at N_max", "triage"], rows
    )

    type_rows = []
    for label_type in PRIMARY_LABEL_TYPES:
        mask = pool.label_type == label_type
        count = int(np.count_nonzero(mask))
        if not count:
            continue
        type_rows.append([
            label_type, _int(count),
            _int(np.count_nonzero(mask & (status == "unvalidated"))),
            _int(np.count_nonzero(mask & (status == "decided"))),
            _int(np.count_nonzero(mask & nv)),
            _int(np.count_nonzero(mask & tri)),
        ])
    by_type = markdown_table(
        ["label type", "labels", "unvalidated", "decided", "needs votes", "triage"], type_rows
    )

    ai_only = int(np.count_nonzero((total_votes(pool.agree, pool.disagree, pool.unsure) == 1)
                                   & (pool.ai_result != "")))
    notes = [
        "Triage queue, by the predicate that puts a label there (a label can match more than one): capped out at "
        "{0}+ votes {1}, unsure-heavy {2}, human-vs-AI contested {3}; {4} distinct labels.".format(
            MAX_CROWD_VOTES, _int(np.count_nonzero(capped)),
            _int(np.count_nonzero(unsure_heavy(pool.agree, pool.disagree, pool.unsure))),
            _int(np.count_nonzero(ai_contested(pool.agree, pool.disagree, pool.ai_result))),
            _int(np.count_nonzero(tri))),
        "Labels by a new labeler (author under {0} own labels validated, audit task not low-quality or stale): {1} "
        "({2}% of the pool). Of those, {3} carry the +150 bonus under today's `correct IS NULL` gate and {4} carry "
        "it under the #4715 `needs_votes` gate.".format(
            NEW_LABELER_OWN_LABELS_VALIDATED, _int(np.count_nonzero(pool.new_labeler())),
            _pct(100.0 * np.count_nonzero(pool.new_labeler()) / n),
            _int(np.count_nonzero(pool.new_labeler_bonus_old())),
            _int(np.count_nonzero(pool.new_labeler_bonus_new()))),
        "Labels whose only vote is the AI's: {0}. A lone AI vote leaves margin 1, so the retirement rule keeps every "
        "one of them in the crowd queue until a human concurs.".format(_int(ai_only)),
    ]
    return by_status + "\n\n" + by_type + "\n\n" + "\n".join("- " + note for note in notes)


def _pick_share_section(pool, rng, missions_per_type, serve_no_sidewalk):
    """(ii) Expected share of served slots by status, plus the new-labeler and vote-count views."""
    status = pool.status()
    buckets = vote_bucket(total_votes(pool.agree, pool.disagree, pool.unsure))
    analytic = old_pick_weight(pool.old_score())
    analytic = analytic / analytic.sum()

    shares = {policy: pick_probabilities(pool, policy, rng, missions_per_type, serve_no_sidewalk)
              for policy in POLICIES}

    headers = ["status", "labels", "% pool", "OLD analytic"] + [POLICY_LABELS[p] for p in POLICIES]
    n = len(pool)
    analytic_by_status = share_by_group(analytic, status, STATUS_ORDER)
    shares_by_status = {p: share_by_group(shares[p], status, STATUS_ORDER) for p in POLICIES}
    rows = []
    for name in STATUS_ORDER:
        count = int(np.count_nonzero(status == name))
        rows.append([name, _int(count), _pct(100.0 * count / n), _pct(analytic_by_status[name])]
                    + [_pct(shares_by_status[p][name]) for p in POLICIES])
    by_status = markdown_table(headers, rows)

    new_labeler_sets = (
        ("by a new labeler", pool.new_labeler()),
        ("...and bonus-eligible today (correct IS NULL)", pool.new_labeler_bonus_old()),
        ("...and bonus-eligible under #4715 (needs votes)", pool.new_labeler_bonus_new()),
    )
    labeler_rows = []
    for name, mask in new_labeler_sets:
        labeler_rows.append([name, _int(np.count_nonzero(mask)), _pct(100.0 * np.count_nonzero(mask) / n),
                             _pct(100.0 * analytic[mask].sum())]
                            + [_pct(100.0 * shares[p][mask].sum()) for p in POLICIES])
    by_labeler = markdown_table(["label group", "labels", "% pool", "OLD analytic"]
                                + [POLICY_LABELS[p] for p in POLICIES], labeler_rows)

    bucket_rows = []
    for name in VOTE_BUCKET_ORDER:
        mask = buckets == name
        bucket_rows.append([
            name, _int(np.count_nonzero(mask)), _pct(100.0 * np.count_nonzero(mask) / n),
            _pct(100.0 * shares["old"][mask].sum()), _pct(100.0 * shares["new"][mask].sum()),
        ])
    by_bucket = markdown_table(
        ["votes on the label", "labels", "% pool", "% picks OLD", "% picks NEW"], bucket_rows
    )
    return by_status, by_labeler, by_bucket


def _replay_section(replayed):
    """(iii) The historical waste replay and the settle-rate table."""
    by_year = waste_by(replayed, lambda row: row["end_timestamp"][:4])
    by_source = waste_by(replayed, lambda row: row["source"])
    by_source.sort(key=lambda row: -row["votes"])
    settle = settle_rate_by_prior_votes(replayed)

    year_table = markdown_table(
        ["year", "votes", "cast at margin >= 2", "% wasted"],
        [[row["group"], _int(row["votes"]), _int(row["wasted"]), _pct(row["wasted_pct"])] for row in by_year],
    )
    source_table = markdown_table(
        ["source", "votes", "cast at margin >= 2", "% wasted"],
        [[row["group"], _int(row["votes"]), _int(row["wasted"]), _pct(row["wasted_pct"])]
         for row in by_source],
    )
    deepest = max(row["prior_votes"] for row in settle) if settle else 0
    settle_table = markdown_table(
        ["votes already on the label", "votes cast there", "of those, on an already-decided label",
         "still-undecided votes", "% of those that settled it", "% of those unsure"],
        [["{0}{1}".format(row["prior_votes"], "+" if row["prior_votes"] == deepest else ""), _int(row["votes"]),
          _int(row["wasted"]), _int(row["undecided_votes"]), _pct(row["settled_pct"]), _pct(row["unsure_pct"])]
         for row in settle],
    )
    total = len(replayed)
    wasted = sum(1 for row in replayed if row["wasted"])
    headline = "Of {0} non-self validations, {1} ({2}%) were cast on a label that was already decided.".format(
        _int(total), _int(wasted), _pct(100.0 * wasted / total) if total else "0.0")
    return headline, year_table, source_table, settle_table


def _simulation_section(pool, rng, n_votes, serve_no_sidewalk):
    """(iv) Forward simulation of the next K votes under the old and the new policy."""
    decided = margin(pool.agree, pool.disagree) >= SETTLED_MARGIN
    p_correct = float(np.count_nonzero(decided & (pool.agree > pool.disagree)) / max(np.count_nonzero(decided), 1))
    results = {policy: simulate_votes(pool, policy, n_votes, rng, p_correct, serve_no_sidewalk=serve_no_sidewalk)
               for policy in ("old", "new")}
    rows = [
        ["votes simulated", _int(results["old"]["votes"]), _int(results["new"]["votes"])],
        ["% on labels already decided", _pct(results["old"]["on_decided_pct"]),
         _pct(results["new"]["on_decided_pct"])],
        ["% on labels already at {0}+ votes".format(MAX_CROWD_VOTES), _pct(results["old"]["on_capped_pct"]),
         _pct(results["new"]["on_capped_pct"])],
        ["distinct zero-vote labels reached", _int(results["old"]["zero_vote_labels_reached"]),
         _int(results["new"]["zero_vote_labels_reached"])],
        ["labels newly settled", _int(results["old"]["newly_settled"]), _int(results["new"]["newly_settled"])],
        ["votes per label settled", "{0:.2f}".format(results["old"]["votes_per_settled_label"]),
         "{0:.2f}".format(results["new"]["votes_per_settled_label"])],
        ["most votes on any one label", _int(results["old"]["max_votes_on_one_label"]),
         _int(results["new"]["max_votes_on_one_label"])],
    ]
    table = markdown_table(["metric", "OLD (today)", "NEW (#4715)"], rows)
    model = (
        "Voter model: each label is genuinely correct with probability {0:.3f} (the share of the pool's decided "
        "labels that came out agree > disagree). A validator votes Agree/Disagree/Unsure with {1} on a correct "
        "label and {2} on an incorrect one.".format(p_correct, VOTE_PROBS_IF_CORRECT, VOTE_PROBS_IF_INCORRECT)
    )
    return table, model


def build_report(pool, validations, schema, seed=4715, votes=20000, missions_per_type=2000):
    """Assemble the whole markdown report, both with and without NoSidewalk.

    @param pool: Pool from `load_pool`, still holding NoSidewalk.
    @param validations: Rows from `load_validations`.
    @param schema: City schema the CSVs came from, for the header.
    @returns: The report as one markdown string.
    """
    parts = [
        "# Validate queue analysis -- `{0}` ({1})".format(schema, datetime.date.today().isoformat()),
        "",
        "Generated by `tools/analyze_validation_queue.py` from `tools/validation_queue/pool.sql` and "
        "`validations.sql`. Every number below comes from that run; none is typed by hand.",
        "",
        "Policy under test: a label still needs votes while `total_votes = 0 OR (|agree - disagree| < {0} AND "
        "total_votes < {1})`, priority is the additive score with `{2} / (1 + margin^2 + unsure)` as the "
        "consensus term, and pick probability is proportional to `score^{3:g}`. Pool rows: {4}; validations "
        "replayed: {5}; seed {6}; {7} missions simulated per type; {8} votes in the forward simulation.".format(
            SETTLED_MARGIN, MAX_CROWD_VOTES, int(CONSENSUS_NEED_MAX), PICK_WEIGHT_EXPONENT, _int(len(pool)),
            _int(len(validations)), seed, _int(missions_per_type), _int(votes)),
    ]

    variants = (
        ("excluding NoSidewalk", pool.without_no_sidewalk(),
         [row for row in validations if row["label_type"] != "NoSidewalk"], False),
        ("including NoSidewalk", pool, validations, True),
    )
    for title, variant_pool, variant_validations, serve_no_sidewalk in variants:
        rng = np.random.default_rng(seed)
        replayed = replay_margins(variant_validations)
        by_status, by_labeler, by_bucket = _pick_share_section(variant_pool, rng, missions_per_type,
                                                                serve_no_sidewalk)
        headline, year_table, source_table, settle_table = _replay_section(replayed)
        sim_table, sim_model = _simulation_section(variant_pool, rng, votes, serve_no_sidewalk)
        parts += [
            "",
            "## {0}{1}".format(title[0].upper(), title[1:]),
            "",
            "NoSidewalk is {0} here. Validate holds it back unless it is the only type with a full mission left, so "
            "the excluding-NoSidewalk tables are the ones that describe what validators actually see.".format(
                "left out" if "excluding" in title else "counted as if it were served like any other type"),
            "",
            "### (i) Pool composition",
            "",
            _pool_composition_section(variant_pool),
            "",
            "### (ii) Where the picks go",
            "",
            "Each column is 2,000+ simulated missions of the real procedure (order the type's labels by the sort "
            "key, take the top {0}, keep a random {1}), with the types weighted by that policy's own type "
            "selection. The three middle columns change only the sampler, so the gap between them and NEW is what "
            "the retirement rule buys.".format(MISSION_LENGTH * BATCH_MULTIPLIER, MISSION_LENGTH),
            "",
            by_status,
            "",
            "The new-labeler emphasis is the reason the sampler uses score^2 rather than a plain proportional "
            "draw. The first row is a fixed set of labels, so its shares are comparable across every column:",
            "",
            by_labeler,
            "",
            "Share of picks by how many votes a label already carries:",
            "",
            by_bucket,
            "",
            "### (iii) What the crowd already spent",
            "",
            headline,
            "",
            year_table,
            "",
            source_table,
            "",
            "Marginal value of a vote, by how many the label already had. The settle rate is measured over the "
            "votes cast while the label was still undecided, because a vote on a settled label cannot settle "
            "anything; the two columns before it say how much of each depth was already waste:",
            "",
            settle_table,
            "",
            "### (iv) Forward simulation of the next {0} votes".format(_int(votes)),
            "",
            sim_model,
            "",
            sim_table,
        ]
    parts.append("")
    return "\n".join(parts)


def main(argv=None):
    """CLI entry point: read the two CSVs, write the markdown report."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pool", required=True, help="pool.csv from tools/validation_queue/pool.sql")
    parser.add_argument("--validations", required=True,
                        help="validations.csv from tools/validation_queue/validations.sql")
    parser.add_argument("--schema", default="unknown", help="city schema the CSVs came from, for the report header")
    parser.add_argument("--votes", type=int, default=20000, help="votes to cast in the forward simulation")
    parser.add_argument("--missions", type=int, default=2000, help="missions simulated per label type")
    parser.add_argument("--seed", type=int, default=4715, help="RNG seed, so a rerun reproduces the report")
    parser.add_argument("--out", help="write the report here instead of stdout")
    args = parser.parse_args(argv)

    report = build_report(load_pool(args.pool), load_validations(args.validations), args.schema, seed=args.seed,
                          votes=args.votes, missions_per_type=args.missions)
    if args.out:
        with open(args.out, "w") as handle:
            handle.write(report)
    else:
        sys.stdout.write(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
