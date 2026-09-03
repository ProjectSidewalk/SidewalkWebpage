# How Validate picks labels

Every Validate surface — desktop `/validate`, `/mobile`, and `/expertValidate` (alias `/adminValidate`) — draws from
one pipeline: `LabelTable.retrieveLabelListForValidationQuery` selects candidate labels,
`LabelService.getLabelTypeToValidate` picks the label type for the mission, and
`LabelService.retrieveLabelListForValidation` assembles the mission. What that pipeline is *allowed* to serve, and in
what order, is a policy, and the whole policy lives in one object: `app/models/validation/ValidationQueuePolicy.scala`.
This page is the human-facing companion to that object (#4715). The ScalaDoc there points here; when a number or a
predicate changes, change it in the object and update this page in the same commit.

The values are in code rather than `conf/` because the predicates are Slick expressions shared by the label query and
the per-type counts, and because a per-city override of a correctness policy is not something we want. Lifting a value
into `application.conf` is a one-file change if a deployment ever needs a different one.

## Three queues

A *queue* is a predicate over a label. It composes with everything else the query already enforces — the label is not
yours, you have not validated it, its imagery is renderable by your viewer, its audit task and region exist, tutorial
streets are excluded, and only the primary label types are served.

| Queue | Predicate | Who draws from it |
|---|---|---|
| `NeedsVotes` | `totalVotes = 0` OR (`margin < SettledMargin` AND `totalVotes < MaxCrowdVotes`) | the crowd, first |
| `Triage` | `margin < SettledMargin` AND (capped out OR unsure-heavy OR AI-contested) | Expert Validate, first |
| `Any` | everything the viewer can render | the fallback for both |

where `totalVotes = agree_count + disagree_count + unsure_count` and `margin = |agree_count − disagree_count|`.

- **capped out** — `totalVotes >= MaxCrowdVotes`. The crowd has had its five swings and is still undecided.
- **unsure-heavy** — `unsure_count >= UnsureHeavyMinVotes` and `unsure_count >= agree_count + disagree_count`. The
  validators who looked mostly said "I can't tell".
- **AI-contested** — the label has an AI assessment and the humans lean the other way. The AI's own vote sits inside
  `agree_count`/`disagree_count`, so it is subtracted before the comparison: an AI *Agree* is contested when
  `disagree_count > agree_count − 1`, an AI *Disagree* when `agree_count > disagree_count − 1`. Only undecided labels
  qualify — humans who have already out-voted the AI are finished, not stuck.

## Cascades

A page draws from a *cascade*: a list of queues drained in order until the mission is full. Each later queue only tops
up what the earlier ones could not fill, and it excludes what they already returned.

| Page | Cascade |
|---|---|
| `/validate`, `/mobile` | `NeedsVotes` → `Any` |
| `/expertValidate`, `/adminValidate` (default) | `Triage` → `NeedsVotes` → `Any` |
| `/expertValidate?triage=false` | `NeedsVotes` → `Any` |

`Any` is the tail of every cascade on purpose: it is what keeps the game endless when a label type has nothing left
that needs votes (#2929).

## The retirement rule

```
needsVotes(label) := totalVotes = 0
                  OR (margin < SettledMargin AND totalVotes < MaxCrowdVotes)
```

Two concurring votes retire a label, and so does hitting the vote cap without a decision. Three things follow that are
easy to get wrong:

- **Unsure votes count toward the cap.** A 0-agree / 0-disagree / 5-unsure label has consumed five validator-minutes
  and is not going to be settled by a sixth; it belongs in the expert triage queue, not in the crowd's stream.
- **Nothing is retired by the AI alone.** A lone AI vote leaves the label at `margin = 1` and `totalVotes = 1`, so
  `needsVotes` is still true and the crowd keeps being asked until a human concurs. Retirement always takes two
  concurring votes or the cap.
- **`unvalidatedOnly` is orthogonal.** It is a separate opt-in filter on `label.correct IS NULL` that applies inside
  whichever queue is active; it is not a queue of its own.

`MaxCrowdVotes = 5` is where the crowd stops paying: the marginal settle rate of the next vote falls off sharply by the
fifth vote while the share of those votes that are Unsure climbs, which is the crowd telling us it cannot decide (see
[Evidence](#evidence-seattle-2026-09)). Labels that reach the cap undecided are exactly what the `Triage` queue hands
to an expert.

## The priority score

Within a queue, every candidate gets a deterministic score in `(0, 425]`:

| Term | Points | When |
|---|---|---|
| New-labeler bonus | 150 | the labeler's `user_stat.own_labels_validated < 50`, the label still `needsVotes`, and its audit task is neither low-quality nor stale |
| High-quality-labeler bonus | 50 | `user_stat.high_quality` |
| Consensus need | `200 / (1 + margin² + unsure_count)` | always |
| Recency bonus | 25 | the label was placed within the last 7 days |

The new-labeler gate is `needsVotes`, not `label.correct IS NULL`: a single AI *Agree* sets `correct`, and a new
labeler's very first labels are the ones most worth a human's eyes, so the bonus follows the queue's own definition of
"this label still needs a validation".

The consensus term folds unsure votes into the same denominator as the margin, so one unsure vote lowers the need
exactly as much as one lone agree does:

| agree / disagree / unsure | Consensus need |
|---|---|
| 0 / 0 / 0 | 200 |
| 1 / 0 / 0 | 100 |
| 0 / 0 / 1 | 100 |
| 1 / 1 / 0 | 200 |
| 0 / 0 / 2 | 67 |
| 1 / 1 / 1 | 100 |
| 2 / 2 / 1 | 100 |
| 2 / 0 / 0 | 40 — and retired, `margin = SettledMargin` |

## The sampler

The score is turned into a serve rate by an Efraimidis–Spirakis weighted sample without replacement. Each candidate
row gets a key and the query takes the top rows by that key:

```sql
ORDER BY ln(random()) / power(greatest(score, 1), 2) DESC
```

This is the exponential-race form of the same sampler: `−ln(U)/w` is an Exponential(w) draw, so the smallest such draw
(largest key, since the sign is folded in) wins, and taking the top *k* keys gives **P(pick) ∝ score²**. Concretely, a
label scoring 425 is served about 18× as often as one scoring 100, and about 180,000× as often as one scoring 1.

Three properties are the point of choosing this over the alternatives:

- **Noise never inverts priority in aggregate.** A higher score is always a strictly higher expected serve rate.
- **No label is ever certain to be served.** Concurrent validators draw independent samples spread across the whole
  eligible pool, with no coordination and no shared "top 50" for everyone to pile onto.
- **The exponent is a dial, not a constant of nature.** `PickWeightExponent = 2` keeps new labelers' labels at roughly
  the share of picks the additive score implies; exponent 1 (plain proportional sampling) cuts that share by more than
  half. See [Evidence](#evidence-seattle-2026-09).

Bounded jitter (`score + random() * 25`) was considered and rejected: it is effectively strict tiering, so every
concurrent validator gets the same handful of top-scoring labels, which recreates the pile-on the sampler exists to
prevent.

`greatest(score, 1)` guards the division. Postgres `random()` is in `[0, 1)`; `ln(0) = -Infinity` sorts last, which is
harmless. Each batch is a fresh sample, so `findValidLabelsForType`'s accumulator dedupe and its `drop(offset)` behave
the same as for any other randomized query, and its post-query shuffle (which de-clusters the 50 → 10 selection) still
applies.

## Label-type selection

`getLabelTypeToValidate` picks the mission's label type before any labels are drawn.
`getAvailableValidationsLabelsByType` returns, per label type, how many labels the user could validate at all and how
many of those each queue holds — computed with the *same* predicates as the label query, so type selection and label
selection cannot disagree about what "needs validation" means.

1. Keep types with at least one full mission's worth of available labels, honoring a requested type if there is one.
2. Walk the cascade and take the **first queue in which some type can fill a whole mission**. That queue decides both
   which types are in play and what they are weighted by. For `Any` the weights are uniform — it is the fallback, and
   its counts carry no priority signal.
3. Drop `NoSidewalk` unless it is the only type left (validating it is near-always trivial).
4. Give every remaining type a 2% floor and split the rest in proportion to its weight, then draw.

## Expert Validate's `?triage=`

`GET /expertValidate?triage=<bool>` and `GET /adminValidate?triage=<bool>` take an optional boolean that **defaults to
true**: an expert minute goes to the labels the crowd cannot finish. `?triage=false` gives the same stream `/validate`
serves. `/validate` and `/mobile` have no such parameter and always use the crowd cascade.

The flag rides `ValidateHelper.ValidateParams` as `triage`, which `require`s `adminVersion` the same way `labelType`
and `userIds` do, and `ValidateController.paramsAllowedFor` rebuilds a non-admin's params without the admin-only
fields — so a non-admin who posts `triage: true` gets the crowd cascade. The Twirl views embed it in
`param.validateParams`, and `public/js/validate/src/data/Form.js` sends it back as `validate_params.triage`; the JSON
reader defaults a missing field to `false`, so a tab opened before the field existed still submits successfully.

The mode is visible only in the URL and in the embedded params — there is no user-facing string for it, so there is
nothing to translate.

## Tunables

All of these are `val`s in `ValidationQueuePolicy`, pinned by `test/service/ValidationQueueSpec.scala`.

| Constant | Value | What moving it does |
|---|---|---|
| `SettledMargin` | 2 | How far apart agree and disagree must be to call a label decided. Raising it keeps labels in the crowd queue longer and shrinks the retired set; lowering it to 1 would retire a label on its very first vote. |
| `MaxCrowdVotes` | 5 | How many votes an undecided label may collect before the crowd stops being asked. Lowering it moves more labels into `Triage` (expert workload up, crowd waste down); raising it does the reverse. |
| `UnsureHeavyMinVotes` | 2 | How many unsure votes make a label "unsure-heavy" for `Triage` (it must also be at least the number of agree + disagree votes). Lowering it to 1 pulls single-unsure labels into the expert queue. |
| `NewLabelerOwnLabelsValidated` | 50 | How long a labeler counts as new. Raising it spreads the new-labeler bonus over more people, diluting the fast-feedback effect it exists for. |
| `NewLabelerBonus` | 150 | Weight of "this person is new and needs feedback". It is the largest single term, so it dominates the serve rate for new labelers' labels. |
| `HighQualityLabelerBonus` | 50 | Weight of "this labeler is known good". Mild by design: a good labeler's label is worth confirming, not worth crowding out fresh work. |
| `ConsensusNeedMax` | 200 | The score a zero-vote label gets from consensus need alone, and the scale of the whole decay curve. |
| `RecencyBonus` / `RecencyWindowDays` | 25 / 7 | Freshness nudge (#3018). Small on purpose: it breaks ties toward recent work without outranking the consensus need. |
| `PickWeightExponent` | 2 | How sharply the score translates into a serve rate. 1 is plain proportional sampling; 2 squares the gaps and keeps the new-labeler emphasis where the additive score puts it. |

`MaxScore` (425) is the sum of the four terms. It is documented for readers and is not used in the sort.

## Evidence (Seattle, 2026-09)

Every number below is pasted from `tools/analyze_validation_queue.py` (see
[Re-running the analysis](#re-running-the-analysis)) against the Seattle city schema of the dev DB dump — a recent
production snapshot, {{SEATTLE_LABELS}} labels and {{SEATTLE_VALIDATIONS}} validations. Nothing here is typed by hand.

"Honest servable pool" means the exact joins and filters the label query applies, so it counts what Validate could
actually serve today: **{{POOL_SIZE}}** labels excluding `NoSidewalk`, of which **{{POOL_DECIDED_PCT}}%** already have
a decided outcome. Two inflations to be aware of when reading the issue's original figures: `NoSidewalk` labels
({{POOL_NOSIDEWALK}}, which missions avoid whenever another type is available) and tutorial labels
({{SEATTLE_TUTORIAL_LABELS}}, which the queue never serves at all).

### Pool composition

<!-- Track D: table (i) — one row per status (unvalidated / unsure-only / margin 1 / tied / decided), with counts,
     % of pool, and the "retired by MaxCrowdVotes" and "triage" columns. -->
{{TABLE_POOL_COMPOSITION}}

<!-- Track D: table (i), per-label-type breakdown of the same statuses. -->
{{TABLE_POOL_BY_TYPE}}

Zero-vote labels: {{POOL_UNVALIDATED}}. Unsure-only: {{POOL_UNSURE_ONLY}}. The pool is dominated by margin-1 labels
({{POOL_MARGIN1}}), **{{POOL_AI_ONLY}}** of which carry only the AI's vote — exactly the case a second, human vote
should confirm, and exactly what the "nothing is retired by the AI alone" rule keeps in the crowd queue.

### Vote-count buckets among undecided labels

<!-- Track D: distribution of totalVotes among undecided (margin < SettledMargin) labels — one row per vote count,
     plus a cumulative "≥ N votes" column. This is the table that sizes MaxCrowdVotes. -->
{{TABLE_VOTE_COUNT_BUCKETS}}

`MaxCrowdVotes = 5` retires **{{RETIRED_AT_5}}** undecided labels ({{RETIRED_AT_5_PCT}}% of the undecided set) into the
expert queue. A cap of 4 would retire {{RETIRED_AT_4}}, a cap of 6 only {{RETIRED_AT_6}}.

### Where picks land

<!-- Track D: table (ii) — expected share of picks by pool status under each policy: the jitter-to-ceiling key
     (det + random()·(426 − det)), analytic and Monte-Carlo; weighted sampling at exponent 1; and at exponent 2 over
     the crowd cascade. -->
{{TABLE_PICK_SHARE}}

Decided labels take **{{PICK_SHARE_DECIDED_OLD}}%** of picks under a `det + random()·(426 − det)` sort key. Fixing only
the randomization is not enough: proportional sampling still sends {{PICK_SHARE_DECIDED_ES1}}% of picks at them. The
retirement rule is what removes the waste — with it, the figure is {{PICK_SHARE_DECIDED_NEW}}%.

<!-- Track D: table (ii), the new-labeler share of picks under each policy (pool share vs. pick share). -->
{{TABLE_NEW_LABELER_PICK_SHARE}}

New labelers' labels are about 1% of the pool. They take {{NEW_LABELER_SHARE_OLD}}% of picks under the
jitter-to-ceiling key, {{NEW_LABELER_SHARE_ES1}}% at `PickWeightExponent = 1`, and {{NEW_LABELER_SHARE_ES2}}% at
`PickWeightExponent = 2` — which is why the exponent is 2.

### Historical replay

Replaying every validation in timestamp order (self-votes excluded) and asking what the label's margin was at the
moment the vote was cast:

<!-- Track D: table (iii) — share of votes cast at margin ≥ SettledMargin, by year and by source. -->
{{TABLE_WASTE_BY_YEAR_AND_SOURCE}}

This is a live property of the selection policy, not legacy debris: **{{WASTE_2026_PCT}}%** of the votes cast in
2026 landed on a label that was already at `margin >= SettledMargin` when the vote was cast.

<!-- Track D: table (iii) — settle rate of the next vote by how many votes the label already had, with the Unsure
     share of those votes. This is the table that justifies MaxCrowdVotes. -->
{{TABLE_SETTLE_RATE_BY_PRIOR_VOTES}}

A second vote settles **{{SETTLE_RATE_AT_1}}%** of one-vote labels, with {{UNSURE_SHARE_AT_1}}% of those votes Unsure.
By the fifth vote the marginal settle rate is **{{SETTLE_RATE_AT_5}}%** and the Unsure share has risen to
{{UNSURE_SHARE_AT_5}}%. That is the crossover the cap is set at.

### Forward simulation

{{SIM_VOTES}} simulated votes over the real pool, with missions of 10, each policy choosing its own label type and
drawing with its own sampler, and counts updated per vote. The voter model is printed in the tool's own report.

<!-- Track D: table (iv) — forward-simulation outcome rows: % of votes landing on already-decided labels, % on labels
     already at the cap, distinct zero-vote labels reached, labels newly settled, max votes on any one label, and
     votes per settled label; one column per policy. -->
{{TABLE_FORWARD_SIMULATION}}

Votes landing on already-decided labels: {{SIM_WASTE_OLD}}% → **{{SIM_WASTE_NEW}}%**. Distinct zero-vote labels
reached: {{SIM_REACH_OLD}} → **{{SIM_REACH_NEW}}**. Most votes any one label collects: {{SIM_MAX_OLD}} →
**{{SIM_MAX_NEW}}**.

### Triage queue size

{{TRIAGE_SIZE}} Seattle labels qualify for `Triage`: {{TRIAGE_CAPPED}} capped out, {{TRIAGE_UNSURE_HEAVY}}
unsure-heavy, {{TRIAGE_AI_CONTESTED}} AI-contested (the three overlap).

## Re-running the analysis

```bash
# tools/validation_queue/run.sh <schema> <out-dir>
tools/validation_queue/run.sh sidewalk_seattle tmp/validation-queue
```

Run it from the host with both containers up. It exports two CSVs with `psql` through the `db` container
(`tools/validation_queue/pool.sql`, the honest servable pool; `tools/validation_queue/validations.sql`, every
validation for the replay), then runs `tools/analyze_validation_queue.py` in the web container, where numpy lives, and
writes `report.md` into the output directory. The output directory must be inside the repo so the web container can
see it; `tmp/` is gitignored, so keep the CSVs there and never commit them.

The tool reads either schema shape — it checks `max(id)` in the schema's `play_evolutions` and selects the label-type
expression accordingly — so it runs against a city schema that has not caught up to the current evolution level.

To point the analysis at a different city, pass that schema name; `readonly_user` needs `USAGE` on it.

## QA

Validate cannot be browser-automated (it needs live street-view panoramas), so this is a manual checklist. Run the app
locally against your dev schema — `make dev` then `npm start`, or `make qa-worktree wt=<name>` for a worktree — then:

1. Sign in as an admin and open `/expertValidate`. In devtools, `svv.validateParams.triage === true`. The labels
   served should be ties, unsure-heavy, or high-vote-count labels (the admin panel lists each label's votes).
2. `/expertValidate?triage=false` → `svv.validateParams.triage === false`, and the stream looks like plain Validate.
3. `/validate` as a non-admin → `svv.validateParams.triage === false`, and every label served has fewer than
   `MaxCrowdVotes` votes with `|agree − disagree| < SettledMargin` (check the current label's
   `agree_count`/`disagree_count`/`unsure_count`).
4. `/validate?unvalidatedOnly=true` still serves labels.
5. `/mobile` (or `/validate` with a mobile UA, which redirects) loads and embeds `triage: false`.
6. Tamper test: from the `/validate` tab, POST `/validationTask/moreLabels` with `validate_params.admin_version=true`
   and `triage=true` → 200, labels returned without `admin_data`.
7. Finish a mission on `/validate` → the next mission arrives (this is the cascade plus type-selection path).

## Follow-ups

Tracked on #4715; none of these are implemented here.

- **Reliability-weighted stopping** — weight each vote by `user_stat.accuracy` and retire on posterior confidence
  rather than a raw margin, so a good validator's single vote can settle a label and a contested one automatically
  draws more.
- **AI vote policy** — weight AI votes by measured per-label-type accuracy, and/or route a sample of AI-decided labels
  to humans as an audit.
- **Soft reservations** — hold a label served to an active mission for a short TTL, to cut concurrent pile-ons.
- **The AI pipeline's own selection** — `getLabelsToValidateWithAi` picks its labels independently of this policy and
  deserves the same audit.
- **A triage badge on Expert Validate** — the mode is currently visible only in the URL; a badge needs strings in all
  six locales.
- **Ordering inside `Triage`** — it uses the same sampler as every other queue; ordering by vote count or by how long
  a label has been stuck may serve experts better.
- **Per-city tunables** — the constants are global; a deployment with a very different validator population might want
  its own.
