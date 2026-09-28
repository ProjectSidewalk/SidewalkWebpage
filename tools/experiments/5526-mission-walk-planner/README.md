# #5526: a planned walk for neighborhood missions, replayed against the greedy rule

Explore picks each neighborhood street greedily after the last one (`TaskContainer.nextTask`). Issue
[#5526](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5526) replaces that with a walk planned up front,
`public/js/common/WalkPlanner.js`, and keeps the greedy rule as the fallback. This experiment replays both, and a few
variants, over every region of the three dev-DB cities, so the planner's defaults rest on numbers rather than
intuition.

Ran at commit `29e816448` (to be updated by the lead to the review-fix commit), on base `2fbcd5a36`,
in Node 24 inside the web container, on the dev DB as of 2026-09-27.

## Running it

```bash
tools/experiments/5526-mission-walk-planner/export.sh          # writes data/<city>.json (gitignored), read-only
node tools/experiments/5526-mission-walk-planner/replay.mjs    # prints the tables and writes results.md
node tools/experiments/5526-mission-walk-planner/replay.mjs --city seattle --region 41 --seeds 20   # debugging
node tools/experiments/5526-mission-walk-planner/replay.mjs --perf   # the planning-time table below
```

The replay loads the real `WalkPlanner.js` (it evaluates the source file), so it measures the code that ships. The
whole run takes about 35 s. `results.md` is only written by an unfiltered run.

## What is replayed

`export.sh` takes each city's open streets exactly as `StreetEdgeTable.streets` does (status `open`, in a region
that isn't deleted, never the tutorial street), with live priority and geodesic length, sorted by id. That is only
approximately the order the server returns tasks in (`selectTasksInARegion` has no ORDER BY; one out-of-order id was
seen in two live regions), and the order matters only for ties in the `current` port.

For each region, up to 5 start streets are drawn the way the server draws one: uniformly at random among the
region's maximum-priority streets, in its stored orientation. They are drawn **without replacement**, so a region with
fewer than 5 maximum-priority streets gets each of them once (Seattle 332 starts over 79 regions, Teaneck 83 over 23,
Richmond 45 over 9). Every policy walks from the same starts, so the comparison is unbiased either way. Then every
policy walks **every** street in the region from that start, as a fresh user who has audited nothing would:

| Policy | Rule |
|---|---|
| `current` | A faithful port of `TaskContainer.nextTask`: connected candidates within 5 m, else 10 m, else 25 m of the finished street's end (either endpoint of the candidate); kept only if their priority quartile `min(floor(p / 0.25), 3)` equals the best remaining street's; the highest priority among them wins (ties in id order), else it jumps to the best remaining street. Orientation as in the real code: connected, or within 75 m of the finished end, starts at the nearer endpoint; otherwise the street is reversed when its default end has no unwalked endpoint within 25 m (a toggle, ported as is). |
| `current+nearest` | The same, but a jump goes to the *nearest* street among those with the maximum priority (the [#4717](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4717) Phase 2 idea). |
| `tolerant tol=t` | The same as `current`, with the quartile filter replaced by `priority ≥ best − t`. |
| `planner tol=t pen=m` | `WalkPlanner` with `priorityTolerance = t` and `oddStartPenaltyM = m`, started on the drawn street. |

## Definitions

All policies are measured by the replay with the same yardsticks, not by their own bookkeeping.

- **Jump:** a step whose start is more than the yardstick from the previous step's end. Its length is that gap. Every
  table is given twice:
  - **25 m (the headline).** Explore's own `CONNECTED_TASK_THRESHOLD`: a hop under 25 m is what the greedy rule
    calls connected and what a labeler experiences as walking on, not as a jump.
  - **10 m.** `WalkPlanner.NODE_TOLERANCE_M`, the graph the planner plans on and the lower bound is computed on. It
    counts 10–25 m hops as jumps, which the greedy rule makes more of (it treats them as connected), so it flatters
    the planner: in Seattle `current` makes 4.37 jumps/km at 10 m but 4.15 at 25 m.
- **jumps/km:** jumps divided by the region's street kilometres. The city figure is the km-weighted mean
  (Σ jumps / Σ km); "median region" is the unweighted median over regions.
- **median jump m:** the median over every jump in the city, all starts pooled.
- **jump m per km:** total jump metres per street kilometre walked (the deadheading; Explore never re-walks a street,
  so this is the ticket's "backtracked metres").
- **dead ends/km:** steps, other than the last, whose end has no unwalked street endpoint within the yardstick.
- **priority-AUC:** walk the streets in order and plot cumulative priority mass (Σ priority × length) against
  cumulative metres, both as fractions of the region's totals; take the area under that curve. Normalize it as
  `(A − A_worst) / (A_best − A_worst)`, where `A_best` is the area of the order that walks streets by descending
  priority and `A_worst` by ascending. So 1.0 means the walk covers high-priority metres first, 0 means last. A
  region whose streets all share one priority has no ordering to judge and is left out of the AUC columns. The city
  figure is the km-weighted mean over regions. It does not depend on the jump yardstick.
- **Lower bound / jumps ÷ lower bound:** `WalkPlanner.lowerBoundJumps` on the region's streets: for each connected
  component (endpoints merged at 10 m) max(1, odd-degree nodes / 2) trails, summed, minus one for the start. No walk
  can make fewer 10 m jumps. At 25 m a walk can come in under it (a 10–25 m hop between components is not counted),
  which is why a ratio below 1.00 appears in Richmond. The ratio is Σ jumps / Σ bound over the city.

Every number is the mean over a region's starts.

## Results

The full sweep (every policy, both yardsticks, all three cities) is in [`results.md`](results.md). The rows that
matter, at the **25 m** headline yardstick, with the 10 m figure in brackets where it differs in kind:

| City | Policy | jumps/km (10 m) | jump m per km | median jump | dead ends/km | priority-AUC | jumps ÷ bound |
|---|---|---|---|---|---|---|---|
| Seattle | `current` | 4.15 (4.37) | 3,745 | 787 m | 2.40 | 0.939 | 2.05 |
| | `current+nearest` | 4.05 (4.29) | 1,368 | 224 m | 2.39 | 0.939 | 2.00 |
| | planner 0.15 / 300 | 4.09 (4.22) | 1,141 | 177 m | 1.97 | 0.941 | 2.02 |
| Teaneck | `current` | 4.39 (4.61) | 2,162 | 447 m | 2.99 | 0.961 | 1.76 |
| | `current+nearest` | 4.30 (4.59) | 1,129 | 198 m | 3.03 | 0.958 | 1.72 |
| | planner 0.15 / 300 | 3.65 (3.82) | 852 | 168 m | 2.32 | 0.937 | 1.47 |
| Richmond | `current` | 3.34 (4.10) | 1,493 | 396 m | 3.24 | 1.000 | 1.33 |
| | `current+nearest` | 3.18 (3.77) | 569 | 120 m | 3.07 | 1.000 | 1.26 |
| | planner 0.15 / 300 | 2.50 (2.88) | 547 | 156 m | 2.28 | 0.998 | 0.99 |

## Planning time

Construct + plan, from `replay.mjs --perf` (Node 24 in the web container on an M-series Mac). "Cold" is the first
call in a fresh process, as on a page load; "warm" is the mean of 20 calls after 5. `PlanStats.ms` times `plan()`
alone, so the last two columns are what the logged `WalkPlan_Created` `ms` reports.

| Case | streets | construct + plan, cold | warm | of which plan(), cold | warm |
|---|---:|---:|---:|---:|---:|
| Seattle region 41 (largest dev region) | 773 | 31.4 ms | 9.0 ms | 24.1 ms | 6.7 ms |
| 25×25 lattice | 1,200 | 24.0 ms | 5.7 ms | 16.9 ms | 3.7 ms |
| comb, 600-street spine, two dead-end teeth per node | 1,800 | 66.5 ms | 41.4 ms | 56.3 ms | 36.6 ms |
| comb, 1,000-street spine | 3,000 | 133.6 ms | 107.5 ms | 117.7 ms | 99.6 ms |

The comb is the worst shape found: one priority tier holding every street and 1,200 dead ends, so each of its 600
jumps scans the whole tier. That scan is linear per jump, so the comb grows roughly quadratically; a street grid does
not. Cold timings vary by ±30% run to run. Seattle region 41 has one degenerate node where 318 street ends meet,
which is why the planner counts onward streets once per node rather than per candidate. Production region sizes have
not been checked against these.

## Reading the numbers

**The choice: `DEFAULT_PRIORITY_TOLERANCE = 0.15`, `ODD_START_PENALTY_M = 300`, unchanged by the 25 m re-run.** The
selection rule was "fewest 25 m jumps per km whose km-weighted priority-AUC is no more than 0.03 below `current` in
any city". 0.15 is the widest tolerance that passes; 0.2 fails in Seattle (0.889 against a floor of 0.909) and
Teaneck (0.878 against 0.931). The rule picks the same tolerance at the 10 m yardstick.

**The acceptance criterion was relaxed, and that is a decision for the maintainers.** The plan comment on #5526 said
priority coverage should be *no worse* than `current`. "Within 0.03" was introduced by this benchmark, and the chosen
default does not meet the original criterion: Teaneck's AUC falls 0.961 → 0.937 (−0.024; −0.027, 0.962 → 0.935, in
the run before the review fixes), and Richmond's 1.000 → 0.998. No planner setting meets "no worse" in all three
cities: Richmond is 0.998 or lower at every tolerance, 0.1 misses in Teaneck (0.957), and 0.05, which passes in
Seattle and Teaneck, makes *more* jumps than `current` in Seattle (4.94 against 4.15 per km).

What the planner wins, and what it doesn't:

- **Jump count in Seattle: about 1%, and no better than `current+nearest`.** At the 25 m yardstick Seattle goes
  4.15 → 4.09 jumps/km, while `current+nearest` alone reaches 4.05. The 10 m yardstick made this look like 3%
  (4.37 → 4.22), because it counts the 10–25 m hops the greedy rule treats as connected. Seattle's priorities step
  down gradually (0.67, 0.57, 0.5, 0.44, 0.4, …), so any gate tight enough to keep high-priority streets first also
  refuses the neighbouring street often; with the gate wide open (`tol=1`) the planner reaches 1.93 jumps/km, under
  the bound, but its AUC falls to 0.63.
- **Jump distance, everywhere.** Jump metres per km fall 70% in Seattle (3,745 → 1,141), 61% in Teaneck and 63% in
  Richmond; median jumps drop from 400–800 m to 150–180 m. `current+nearest` recovers most of this too (1,368 in
  Seattle), so the planner's margin over it is 17% in Seattle, 25% in Teaneck and 4% in Richmond, where
  `current+nearest`'s median jump is shorter than the planner's (120 m against 156 m) because the odd-start penalty
  sometimes buys a longer jump to save a later one.
- **Dead ends, everywhere.** 2.40 → 1.97 per km in Seattle, 2.99 → 2.32 in Teaneck, 3.24 → 2.28 in Richmond;
  `current+nearest` does not move them (2.39, 3.03, 3.07). Fewer dead ends is the trail planning itself: Fleury's rule
  and odd-node starts, which no nearest-jump tweak reproduces.
- **Jump count in the smaller cities.** Teaneck 4.39 → 3.65 (−17%) and Richmond 3.34 → 2.50 (−25%), against
  `current+nearest`'s 4.30 and 3.18. In an unaudited city (Richmond), where priority is flat, the planner is at the
  bound.
- **The odd-start penalty earns its keep** at every tolerance: at 0.15, 300 m cuts 25 m jumps 6% (Seattle), 7%
  (Teaneck) and 11% (Richmond) against no penalty, for slightly longer jumps. 1,000 m buys under 1% more and lengthens
  jumps (Seattle 1,141 → 1,209 m per km), so 300 stays.
- **`tolerant` shows the quartile rule is the main source of jumps** (Seattle 4.15 → 2.49 at `tol=1`) but, with no
  nearest-jump and no trail planning, its jumps stay long (~860 m median) and its AUC falls with the jumps.

A wider tolerance is a product decision, not a technical one: if walking contiguous streets matters more than
covering the most-needed streets first, 0.25 gives 3.00 / 3.08 / 2.50 jumps/km (25 m) at AUC 0.84 / 0.85 / 1.00.

## Caveats

- **Every replay is a fresh user.** Each walk starts from a region nobody has touched in this session. Real
  labelers often resume a partly-walked region, where the unwalked streets form a fragmented graph with more
  components and odd nodes; neither the planner's nor the greedy rule's numbers there are measured.
- **One user, alone.** Priorities are fixed for the whole replay; in production other users finish streets
  meanwhile, which is why Explore replans rather than trusting a plan for a whole session.
- **Not modelled in Explore's behaviour:** the tiny-street auto-complete at spawn, and the `switch`, `priority` and
  `giveUp` replans. Each replan starts a new plan from wherever the labeler is, so a session's jumps are those of
  several shorter plans, not of one whole-region plan.
- **Whole-region walks.** A real session is a few 152 m missions, not the whole region. The early part of the walk
  (what AUC weighs most) is what users actually see, but the jump rates are whole-region averages.
- **Dev-DB snapshot.** The dump's age is unknown, and dev priorities may not match production's distribution.
  Seattle and Teaneck priorities are one moment of a mature city; Richmond is an unaudited city with nearly flat
  priority (its AUC is close to 1.0 for every policy for that reason).
- **No imagery gaps.** Every street is assumed walkable; give-ups (#4922) and their replans are not modelled.
- **Ties in `current`.** The port breaks priority ties in id order; the server's order is only approximately that.
