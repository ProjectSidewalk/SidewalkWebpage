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

`MaxCrowdVotes = 5` is where the crowd stops paying: by the fifth vote a quarter of the votes still arriving on
undecided labels are Unsure, up from 7% at the first vote, which is the crowd telling us it cannot decide (see
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
- **The exponent is a dial, not a constant of nature.** It decides how much of the additive score survives into the
  serve rate: on Seattle's pool, new labelers' labels take 22.1% of picks at exponent 1 (plain proportional sampling)
  and 34.6% at 2. See [Evidence](#evidence-seattle-2026-09).

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
production snapshot, 304,948 non-deleted labels and 422,284 validations. Nothing here is typed by hand. Those three
counts are direct `count(*)`s against the schema; every other number comes from the tool's report, and the tables are
its **excluding-`NoSidewalk`** half, which is what validators actually see (a mission takes `NoSidewalk` only when no
other type has a full mission left).

"Honest servable pool" means the exact joins and filters the label query applies, so it counts what Validate could
actually serve today: **206,657** labels excluding `NoSidewalk`, of which **33.1%** already have
a decided outcome. Two inflations to be aware of when reading the issue's original figures: `NoSidewalk` labels
(50,806, which missions avoid whenever another type is available) and tutorial labels
(36,112, which the queue never serves at all).

### Pool composition

| status | labels | % pool | still needs votes | retired at N_max | triage |
|---|---|---|---|---|---|
| unvalidated | 8,533 | 4.1 | 8,533 | 0 | 0 |
| unsure-only | 10,202 | 4.9 | 10,201 | 1 | 871 |
| margin 1 | 111,384 | 53.9 | 110,155 | 1,229 | 2,456 |
| tied | 8,204 | 4.0 | 7,648 | 556 | 3,321 |
| decided | 68,334 | 33.1 | 0 | 0 | 0 |
| **total** | 206,657 | 100.0 | 136,537 | 1,786 | 6,648 |

| label type | labels | unvalidated | decided | needs votes | triage |
|---|---|---|---|---|---|
| CurbRamp | 99,879 | 6,376 | 23,856 | 75,984 | 1,880 |
| NoCurbRamp | 44,094 | 868 | 20,925 | 22,842 | 1,187 |
| Obstacle | 17,793 | 99 | 7,569 | 9,201 | 1,606 |
| SurfaceProblem | 37,147 | 293 | 13,273 | 23,524 | 1,914 |
| Crosswalk | 6,156 | 94 | 2,156 | 3,974 | 37 |
| Signal | 1,588 | 803 | 555 | 1,012 | 24 |

Zero-vote labels: 8,533. Unsure-only: 10,202. The pool is dominated by margin-1 labels
(111,384), **45,147** of which carry only the AI's vote — exactly the case a second, human vote
should confirm, and exactly what the "nothing is retired by the AI alone" rule keeps in the crowd queue.

### Vote-count buckets among undecided labels

The 138,323 labels in the pool that are still undecided (`|agree − disagree| < SettledMargin`), by how many votes they
already carry. The "≥ this many" column is what a cap set at that number would retire into the expert queue, so the
column *is* the sizing table for `MaxCrowdVotes`. It is computed from the same `pool.csv` export with the same
module's predicates; its 5-row (1,786) is the `retired at N_max` total above.

| total votes | undecided labels | ≥ this many votes | % of undecided |
|---|---|---|---|
| 0 | 8,533 | 138,323 | 100.0 |
| 1 | 102,329 | 129,790 | 93.8 |
| 2 | 12,424 | 27,461 | 19.9 |
| 3 | 10,922 | 15,037 | 10.9 |
| 4 | 2,329 | 4,115 | 3.0 |
| 5 | 1,073 | 1,786 | 1.3 |
| 6 | 377 | 713 | 0.5 |
| 7 | 191 | 336 | 0.2 |
| 8+ | 145 | 145 | 0.1 |

`MaxCrowdVotes = 5` retires **1,786** undecided labels (1.3% of the undecided set) into the
expert queue. A cap of 4 would retire 4,115, a cap of 6 only 713.

### Where picks land

Each column is 2,000+ simulated missions of the real procedure — order a type's labels by that policy's sort key, take
the top 50, keep a random 10 — with types weighted by that policy's own type selection. `OLD (today)` is the
`det + random() · (426 − det)` key over the whole pool; the three middle columns change only the sampler, keeping the
new score and the old (unretired) eligibility, so the gap between them and `NEW` is what the retirement rule buys.

| status | labels | % pool | OLD analytic | OLD (today) | sampler only, P(pick) prop. score | sampler only, P(pick) prop. score^2 | sampler only, bounded jitter +25 | NEW (retirement + score^2) |
|---|---|---|---|---|---|---|---|---|
| unvalidated | 8,533 | 4.1 | 7.9 | 9.4 | 9.0 | 11.9 | 34.5 | 12.6 |
| unsure-only | 10,202 | 4.9 | 9.6 | 11.2 | 6.9 | 6.8 | 0.3 | 6.4 |
| margin 1 | 111,384 | 53.9 | 48.8 | 45.4 | 58.3 | 62.0 | 2.4 | 71.4 |
| tied | 8,204 | 4.0 | 9.3 | 10.4 | 7.4 | 10.3 | 62.8 | 9.6 |
| decided | 68,334 | 33.1 | 24.4 | 23.6 | 18.5 | 9.0 | 0.0 | 0.0 |

Decided labels take **23.6%** of picks under the `det + random() · (426 − det)` sort key. Fixing only
the randomization is not enough: proportional sampling still sends 18.5% of picks at them. The
retirement rule is what removes the waste — with it, the figure is 0.0%.

| label group | labels | % pool | OLD analytic | OLD (today) | sampler only, P(pick) prop. score | sampler only, P(pick) prop. score^2 | sampler only, bounded jitter +25 | NEW (retirement + score^2) |
|---|---|---|---|---|---|---|---|---|
| by a new labeler | 29,258 | 14.2 | 21.2 | 23.3 | 22.1 | 34.6 | 100.0 | 37.0 |
| ...and bonus-eligible today (correct IS NULL) | 2,650 | 1.3 | 10.5 | 13.0 | 4.4 | 8.1 | 97.6 | 7.5 |
| ...and bonus-eligible under #4715 (needs votes) | 17,827 | 8.6 | 16.7 | 18.8 | 19.0 | 33.1 | 100.0 | 37.0 |

New labelers' labels are 29,258 of the pool (14.2%), and they go from **23.3%** of picks today to **37.0%** under this
PR. Two changes are behind that, and the table does not let them be attributed cleanly, because every column that
isolates the sampler already carries the new score:

- **The bonus gate.** Moving it from `label.correct IS NULL` to `needsVotes` takes the new-labeler labels that
  actually carry the +150 from **2,650** to **17,827** — the same bonus, reaching 6.7× as many labels, because under
  the `needsVotes` gate a lone AI *Agree* does not disqualify a label.
- **The exponent.** Holding eligibility fixed, the same score gives new labelers **22.1%** of picks at
  `PickWeightExponent = 1` and **34.6%** at 2; the retirement rule adds the last 2.4 points to reach 37.0%.

So the 37.0% is a deliberate increase over today's 23.3%, not a side effect. If maintainers want new labelers back
near today's share, `NewLabelerBonus` (150) is the knob to turn — it is the term the widened gate multiplied across
the set — and `PickWeightExponent` is the second.

### Historical replay

Replaying every validation in timestamp order (self-votes excluded) and asking what the label's margin was at the
moment the vote was cast: of 417,930 non-self validations, 72,769 (17.4%) were cast on a label that was already
decided.

| year | votes | cast at margin >= 2 | % wasted |
|---|---|---|---|
| 2019 | 46,583 | 4,375 | 9.4 |
| 2020 | 26,291 | 33 | 0.1 |
| 2021 | 67,826 | 235 | 0.3 |
| 2022 | 77,544 | 16,038 | 20.7 |
| 2023 | 41,746 | 14,542 | 34.8 |
| 2024 | 32,819 | 10,546 | 32.1 |
| 2025 | 53,467 | 8,533 | 16.0 |
| 2026 | 71,654 | 18,467 | 25.8 |

| source | votes | cast at margin >= 2 | % wasted |
|---|---|---|---|
| Validate | 243,904 | 42,101 | 17.3 |
| SidewalkAI | 103,632 | 20,872 | 20.1 |
| ValidateMobile | 54,849 | 5,382 | 9.8 |
| Old data, unknown source | 6,923 | 830 | 12.0 |
| ExternalTagValidationASSETS2024 | 5,716 | 3,112 | 54.4 |
| GalleryImage | 1,134 | 262 | 23.1 |
| AdminUserDashboard | 926 | 1 | 0.1 |
| ExpertValidate | 360 | 76 | 21.1 |
| GalleryExpandedImage | 264 | 43 | 16.3 |
| LabelSearchPage | 109 | 52 | 47.7 |
| LabelMap | 38 | 7 | 18.4 |
| AdminLabelSearchTab | 33 | 16 | 48.5 |
| GalleryExpandedThumbs | 30 | 14 | 46.7 |
| GalleryThumbs | 8 | 1 | 12.5 |
| AdminContributionsTab | 4 | 0 | 0.0 |

This is a live property of the selection policy, not legacy debris: **25.8%** of the votes cast in
2026 landed on a label that was already at `margin >= SettledMargin` when the vote was cast.

The marginal value of a vote, by how many the label already carried. The settle rate is measured over the votes cast
while the label was still undecided, because a vote on a settled label cannot settle anything:

| votes already on the label | votes cast there | of those, on an already-decided label | still-undecided votes | % of those that settled it | % of those unsure |
|---|---|---|---|---|---|
| 0 | 203,066 | 0 | 203,066 | 0.0 | 8.3 |
| 1 | 103,035 | 0 | 103,035 | 68.0 | 7.2 |
| 2 | 55,424 | 35,579 | 19,845 | 10.9 | 19.6 |
| 3 | 27,142 | 14,551 | 12,591 | 48.0 | 19.4 |
| 4 | 12,899 | 9,666 | 3,233 | 16.9 | 23.7 |
| 5 | 6,591 | 4,605 | 1,986 | 38.2 | 25.8 |
| 6 | 3,552 | 2,880 | 672 | 19.2 | 28.4 |
| 7 | 2,026 | 1,641 | 385 | 29.9 | 29.4 |
| 8 | 1,236 | 1,099 | 137 | 23.4 | 25.5 |
| 9+ | 2,959 | 2,748 | 211 | 29.9 | 22.7 |

The settle rate alternates with the parity of the vote count rather than decaying — a vote arriving at an odd count is
the one that can open a margin of 2, so **68.0%** of second votes settle their label against 10.9% of third votes and
**38.2%** of sixth votes. What does decay is the volume and the confidence: the still-undecided votes arriving at
depth 5 are 1,986, under 1% of the 203,066 that arrive at depth 0, and the Unsure share of them has climbed from
7.2% at one prior vote to 25.8% at five. Past five votes the crowd is spending its time on labels it has already told
us it cannot call, which is what the cap stops.

### Forward simulation

20,000 simulated votes over the real pool, with missions of 10, each policy choosing its own label type and
drawing with its own sampler, and counts updated per vote. The voter model is printed in the tool's own report.

| metric | OLD (today) | NEW (#4715) |
|---|---|---|
| votes simulated | 20,000 | 20,000 |
| % on labels already decided | 25.7 | 0.0 |
| % on labels already at 5+ votes | 4.9 | 0.0 |
| distinct zero-vote labels reached | 1,489 | 2,228 |
| labels newly settled | 6,389 | 9,465 |
| votes per label settled | 3.13 | 2.11 |
| most votes on any one label | 4 | 4 |

Votes landing on already-decided labels: 25.7% → **0.0%**. Distinct zero-vote labels reached: 1,489 →
**2,228**. Labels settled by those 20,000 votes: 6,389 → **9,465**, i.e. 3.13 votes per settled label → **2.11**.
The cap does not bind at this horizon — the deepest label reaches 4 votes under both policies — so the retirement
rule's gain here is entirely the decided labels it stops serving, not labels rescued from over-validation; the 5-vote
cap pays off on the 1,786 labels that are *already* past it.

### Triage queue size

6,648 Seattle labels qualify for `Triage`: 1,786 capped out, 2,030
unsure-heavy, 3,029 AI-contested (the three overlap).

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
