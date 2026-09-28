# #5526: a planned walk for neighborhood missions, replayed against today's rule

Explore picks each neighborhood street greedily after the last one (`TaskContainer.nextTask`). Issue
[#5526](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5526) replaces that with a walk planned up front,
`public/js/common/WalkPlanner.js`. This experiment replays both, and a few variants, over every region of the three
dev-DB cities, so the planner's defaults rest on numbers rather than intuition.

Ran at commit `29e816448` (the `WalkPlanner.js` this branch ships), on base `2fbcd5a36`,
in Node 24 inside the web container, on the dev DB as of 2026-09-27.

## Running it

```bash
tools/experiments/5526-mission-walk-planner/export.sh          # writes data/<city>.json (gitignored), read-only
node tools/experiments/5526-mission-walk-planner/replay.mjs    # prints the tables and writes results.md
node tools/experiments/5526-mission-walk-planner/replay.mjs --city seattle --region 41 --seeds 20   # debugging
```

The replay loads the real `WalkPlanner.js` (it evaluates the source file), so it measures the code that ships. The
whole run takes about 35 s. `results.md` is only written by an unfiltered run.

## What is replayed

`export.sh` takes each city's open streets exactly as `StreetEdgeTable.streets` does (status `open`, in a region
that isn't deleted, never the tutorial street), with live priority and geodesic length, sorted by id, which is the
order the server returns tasks in and so the tie order today's rule sees.

For each region and each of 5 seeds, the start street is drawn the way the server draws it: uniformly at random
among the region's maximum-priority streets, in its stored orientation. Then every policy walks **every** street in
the region from that start, as a fresh user who has audited nothing would:

| Policy | Rule |
|---|---|
| `current` | A faithful port of `TaskContainer.nextTask`: connected candidates within 5 m, else 10 m, else 25 m of the finished street's end (either endpoint of the candidate); kept only if their priority quartile `min(floor(p / 0.25), 3)` equals the best remaining street's; the highest priority among them wins (ties in server order), else it jumps to the best remaining street. Orientation as in the real code: connected, or within 75 m of the finished end, starts at the nearer endpoint; otherwise the street is reversed when its default end has no unwalked endpoint within 25 m (a toggle, ported as is). |
| `current+nearest` | The same, but a jump goes to the *nearest* street among those with the maximum priority (the [#4717](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4717) Phase 2 idea). |
| `tolerant tol=t` | The same as `current`, with the quartile filter replaced by `priority ≥ best − t`. |
| `planner tol=t pen=m` | `WalkPlanner` with `priorityTolerance = t` and `oddStartPenaltyM = m`, started on the drawn street. |

## Definitions

All policies are measured by the replay with one yardstick, not by their own bookkeeping.

- **Jump:** a step whose start is more than `WalkPlanner.NODE_TOLERANCE_M` (10 m) from the previous step's end. Its
  length is that gap. Today's rule treats up to 25 m as connected, so a few percent of `current`'s jumps are 10–25 m
  hops it would not call jumps (in Teaneck, 4.60 jumps/km at 10 m against 4.38 at 25 m).
- **jumps/km:** jumps divided by the region's street kilometres. The city figure is the km-weighted mean
  (Σ jumps / Σ km); "median region" is the unweighted median over regions.
- **median jump m:** the median over every jump in the city, all seeds pooled.
- **jump m per km:** total jump metres per street kilometre walked (the deadheading; Explore never re-walks a street,
  so this is the ticket's "backtracked metres").
- **dead ends/km:** steps, other than the last, whose end has no unwalked street endpoint within 10 m.
- **priority-AUC:** walk the streets in order and plot cumulative priority mass (Σ priority × length) against
  cumulative metres, both as fractions of the region's totals; take the area under that curve. Normalize it as
  `(A − A_worst) / (A_best − A_worst)`, where `A_best` is the area of the order that walks streets by descending
  priority and `A_worst` by ascending. So 1.0 means the walk covers high-priority metres first, 0 means last. A
  region whose streets all share one priority has no ordering to judge and is left out of the AUC columns. The city
  figure is the km-weighted mean over regions.
- **Lower bound / jumps ÷ lower bound:** `WalkPlanner.lowerBoundJumps` on the region's streets: for each connected
  component (endpoints merged at 10 m) max(1, odd-degree nodes / 2) trails, summed, minus one for the start. No walk
  can make fewer jumps. The ratio is Σ jumps / Σ bound over the city.

Every number is the mean of the 5 seeds for that region.

## Results

### seattle

79 regions, 23993 streets, 2263.0 km; jump lower bound 4584 (2.03 per km). Largest region 41 (773 streets) plans in 8.4 ms.

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | priority-AUC | priority-AUC (median region) | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 4.37 | 4.34 | 737 | 3749 | 2.69 | 0.939 | 0.944 | 2.16 |
| current+nearest | 4.30 | 4.23 | 212 | 1372 | 2.68 | 0.939 | 0.944 | 2.12 |
| tolerant tol=0.25 | 3.34 | 3.43 | 755 | 2926 | 2.76 | 0.884 | 0.882 | 1.65 |
| tolerant tol=0.5 | 2.87 | 2.99 | 775 | 2560 | 2.75 | 0.811 | 0.810 | 1.42 |
| tolerant tol=1 | 2.75 | 2.81 | 775 | 2443 | 2.75 | 0.791 | 0.793 | 1.36 |
| planner tol=0.05 pen=0 | 5.39 | 5.33 | 153 | 1487 | 2.92 | 0.988 | 0.992 | 2.66 |
| planner tol=0.05 pen=300 | 5.08 | 4.97 | 202 | 1609 | 2.16 | 0.988 | 0.992 | 2.51 |
| planner tol=0.05 pen=1000 | 5.08 | 4.95 | 205 | 1731 | 2.14 | 0.988 | 0.992 | 2.51 |
| planner tol=0.1 pen=0 | 4.78 | 4.70 | 127 | 1153 | 2.87 | 0.956 | 0.970 | 2.36 |
| planner tol=0.1 pen=300 | 4.50 | 4.36 | 176 | 1257 | 2.15 | 0.961 | 0.969 | 2.22 |
| planner tol=0.1 pen=1000 | 4.41 | 4.35 | 179 | 1303 | 2.14 | 0.956 | 0.967 | 2.18 |
| planner tol=0.15 pen=0 | 4.57 | 4.49 | 119 | 1063 | 2.86 | 0.936 | 0.946 | 2.26 |
| planner tol=0.15 pen=300 | 4.24 | 4.18 | 168 | 1147 | 2.16 | 0.941 | 0.950 | 2.09 |
| planner tol=0.15 pen=1000 | 4.20 | 4.15 | 172 | 1214 | 2.14 | 0.937 | 0.947 | 2.07 |
| planner tol=0.2 pen=0 | 4.10 | 4.01 | 110 | 901 | 2.77 | 0.891 | 0.895 | 2.02 |
| planner tol=0.2 pen=300 | 3.70 | 3.64 | 158 | 944 | 2.10 | 0.892 | 0.896 | 1.83 |
| planner tol=0.2 pen=1000 | 3.67 | 3.62 | 160 | 992 | 2.10 | 0.890 | 0.891 | 1.81 |
| planner tol=0.25 pen=0 | 3.58 | 3.68 | 105 | 778 | 2.68 | 0.837 | 0.850 | 1.77 |
| planner tol=0.25 pen=300 | 3.19 | 3.25 | 148 | 802 | 2.09 | 0.840 | 0.854 | 1.57 |
| planner tol=0.25 pen=1000 | 3.16 | 3.23 | 152 | 846 | 2.07 | 0.839 | 0.851 | 1.56 |
| planner tol=0.5 pen=0 | 3.33 | 3.41 | 100 | 640 | 2.63 | 0.769 | 0.797 | 1.65 |
| planner tol=0.5 pen=300 | 2.91 | 2.99 | 125 | 639 | 2.09 | 0.767 | 0.802 | 1.44 |
| planner tol=0.5 pen=1000 | 2.90 | 3.01 | 127 | 671 | 2.08 | 0.767 | 0.790 | 1.43 |
| planner tol=1 pen=0 | 2.49 | 2.61 | 92 | 427 | 2.48 | 0.629 | 0.638 | 1.23 |
| planner tol=1 pen=300 | 2.10 | 2.24 | 98 | 393 | 2.09 | 0.629 | 0.637 | 1.04 |
| planner tol=1 pen=1000 | 2.10 | 2.24 | 98 | 398 | 2.09 | 0.629 | 0.637 | 1.04 |

### teaneck

23 regions, 2134 streets, 199.3 km; jump lower bound 498 (2.50 per km). Largest region 12 (131 streets) plans in 0.2 ms.

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | priority-AUC | priority-AUC (median region) | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 4.60 | 4.38 | 429 | 2173 | 3.24 | 0.962 | 0.973 | 1.84 |
| current+nearest | 4.57 | 4.55 | 190 | 1139 | 3.29 | 0.958 | 0.966 | 1.83 |
| tolerant tol=0.25 | 4.03 | 3.89 | 433 | 1900 | 3.45 | 0.906 | 0.924 | 1.61 |
| tolerant tol=0.5 | 3.56 | 3.55 | 454 | 1710 | 3.54 | 0.812 | 0.831 | 1.42 |
| tolerant tol=1 | 3.55 | 3.55 | 456 | 1715 | 3.55 | 0.812 | 0.831 | 1.42 |
| planner tol=0.05 pen=0 | 4.86 | 4.91 | 152 | 1088 | 3.11 | 0.991 | 0.992 | 1.95 |
| planner tol=0.05 pen=300 | 4.59 | 4.64 | 185 | 1158 | 2.49 | 0.990 | 0.993 | 1.84 |
| planner tol=0.05 pen=1000 | 4.58 | 4.63 | 190 | 1201 | 2.49 | 0.990 | 0.993 | 1.83 |
| planner tol=0.1 pen=0 | 4.34 | 4.36 | 122 | 893 | 3.12 | 0.951 | 0.963 | 1.74 |
| planner tol=0.1 pen=300 | 4.11 | 4.37 | 165 | 950 | 2.54 | 0.955 | 0.968 | 1.64 |
| planner tol=0.1 pen=1000 | 4.09 | 4.28 | 168 | 959 | 2.53 | 0.955 | 0.968 | 1.64 |
| planner tol=0.15 pen=0 | 4.14 | 4.30 | 121 | 831 | 3.07 | 0.931 | 0.952 | 1.66 |
| planner tol=0.15 pen=300 | 3.91 | 4.18 | 161 | 872 | 2.53 | 0.935 | 0.964 | 1.56 |
| planner tol=0.15 pen=1000 | 3.89 | 4.12 | 163 | 896 | 2.54 | 0.934 | 0.961 | 1.56 |
| planner tol=0.2 pen=0 | 3.76 | 3.85 | 108 | 693 | 3.03 | 0.876 | 0.905 | 1.51 |
| planner tol=0.2 pen=300 | 3.43 | 3.58 | 144 | 695 | 2.48 | 0.877 | 0.921 | 1.37 |
| planner tol=0.2 pen=1000 | 3.43 | 3.58 | 146 | 715 | 2.48 | 0.877 | 0.921 | 1.37 |
| planner tol=0.25 pen=0 | 3.68 | 3.76 | 105 | 654 | 3.06 | 0.849 | 0.875 | 1.47 |
| planner tol=0.25 pen=300 | 3.27 | 3.27 | 130 | 652 | 2.48 | 0.849 | 0.872 | 1.31 |
| planner tol=0.25 pen=1000 | 3.27 | 3.27 | 131 | 665 | 2.47 | 0.849 | 0.873 | 1.31 |
| planner tol=0.5 pen=0 | 3.08 | 2.93 | 92 | 483 | 2.98 | 0.671 | 0.645 | 1.23 |
| planner tol=0.5 pen=300 | 2.68 | 2.57 | 97 | 458 | 2.56 | 0.668 | 0.672 | 1.07 |
| planner tol=0.5 pen=1000 | 2.68 | 2.57 | 97 | 465 | 2.56 | 0.668 | 0.672 | 1.07 |
| planner tol=1 pen=0 | 2.98 | 2.85 | 91 | 460 | 2.98 | 0.649 | 0.638 | 1.19 |
| planner tol=1 pen=300 | 2.59 | 2.52 | 95 | 432 | 2.58 | 0.648 | 0.637 | 1.03 |
| planner tol=1 pen=1000 | 2.59 | 2.52 | 95 | 440 | 2.58 | 0.648 | 0.637 | 1.03 |

### richmond

9 regions, 704 streets, 45.7 km; jump lower bound 112 (2.45 per km). Largest region 83 (144 streets) plans in 0.2 ms.

| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km | priority-AUC | priority-AUC (median region) | jumps / lower bound |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | 4.11 | 4.20 | 335 | 1544 | 4.02 | 1.000 | 1.000 | 1.68 |
| current+nearest | 3.71 | 3.54 | 101 | 546 | 3.60 | 1.000 | 1.000 | 1.51 |
| tolerant tol=0.25 | 4.11 | 4.20 | 335 | 1544 | 4.02 | 1.000 | 1.000 | 1.68 |
| tolerant tol=0.5 | 4.03 | 4.20 | 357 | 1524 | 4.00 | 0.956 | 0.951 | 1.64 |
| tolerant tol=1 | 3.95 | 3.94 | 362 | 1487 | 3.95 | 0.862 | 0.865 | 1.61 |
| planner tol=0.05 pen=0 | 3.45 | 3.59 | 102 | 548 | 3.35 | 0.998 | 0.998 | 1.41 |
| planner tol=0.05 pen=300 | 2.88 | 3.17 | 120 | 511 | 2.72 | 0.998 | 0.998 | 1.17 |
| planner tol=0.05 pen=1000 | 2.87 | 3.17 | 120 | 510 | 2.71 | 0.998 | 0.998 | 1.17 |
| planner tol=0.1 pen=0 | 3.45 | 3.59 | 102 | 548 | 3.35 | 0.998 | 0.998 | 1.41 |
| planner tol=0.1 pen=300 | 2.88 | 3.17 | 120 | 511 | 2.72 | 0.998 | 0.998 | 1.17 |
| planner tol=0.1 pen=1000 | 2.87 | 3.17 | 120 | 510 | 2.71 | 0.998 | 0.998 | 1.17 |
| planner tol=0.15 pen=0 | 3.45 | 3.59 | 102 | 548 | 3.35 | 0.998 | 0.998 | 1.41 |
| planner tol=0.15 pen=300 | 2.88 | 3.17 | 120 | 511 | 2.72 | 0.998 | 0.998 | 1.17 |
| planner tol=0.15 pen=1000 | 2.87 | 3.17 | 120 | 510 | 2.71 | 0.998 | 0.998 | 1.17 |
| planner tol=0.2 pen=0 | 3.45 | 3.59 | 102 | 545 | 3.35 | 0.997 | 0.997 | 1.41 |
| planner tol=0.2 pen=300 | 2.88 | 3.17 | 120 | 502 | 2.72 | 0.996 | 0.996 | 1.17 |
| planner tol=0.2 pen=1000 | 2.87 | 3.17 | 120 | 501 | 2.71 | 0.996 | 0.996 | 1.17 |
| planner tol=0.25 pen=0 | 3.45 | 3.59 | 102 | 545 | 3.35 | 0.997 | 0.997 | 1.41 |
| planner tol=0.25 pen=300 | 2.88 | 3.17 | 120 | 502 | 2.72 | 0.996 | 0.996 | 1.17 |
| planner tol=0.25 pen=1000 | 2.87 | 3.17 | 120 | 501 | 2.71 | 0.996 | 0.996 | 1.17 |
| planner tol=0.5 pen=0 | 3.36 | 3.59 | 100 | 515 | 3.31 | 0.757 | 0.733 | 1.37 |
| planner tol=0.5 pen=300 | 2.78 | 3.02 | 117 | 451 | 2.70 | 0.760 | 0.744 | 1.13 |
| planner tol=0.5 pen=1000 | 2.77 | 3.02 | 117 | 451 | 2.69 | 0.760 | 0.744 | 1.13 |
| planner tol=1 pen=0 | 3.35 | 3.59 | 100 | 501 | 3.31 | 0.700 | 0.681 | 1.37 |
| planner tol=1 pen=300 | 2.71 | 2.81 | 117 | 437 | 2.67 | 0.723 | 0.710 | 1.11 |
| planner tol=1 pen=1000 | 2.70 | 2.81 | 117 | 436 | 2.67 | 0.723 | 0.710 | 1.10 |

_5 seeds per region; 36 s total._

## Reading the numbers

**The choice: `DEFAULT_PRIORITY_TOLERANCE = 0.15`, `ODD_START_PENALTY_M = 300`.** The rule was "fewest jumps per
km whose km-weighted priority-AUC is no more than 0.03 below `current` in any city". 0.15 is the widest tolerance
that passes; 0.2 fails in Seattle (0.892 against 0.939) and Teaneck (0.877 against 0.962).

Against `current`, the chosen setting:

| City | jumps/km | jump m per km | median jump | dead ends/km | priority-AUC | jumps ÷ bound |
|---|---|---|---|---|---|---|
| Seattle | 4.37 → 4.24 (−3%) | 3,749 → 1,147 (−69%) | 737 → 168 m | 2.69 → 2.16 | 0.939 → 0.941 | 2.16 → 2.09 |
| Teaneck | 4.60 → 3.91 (−15%) | 2,173 → 872 (−60%) | 429 → 161 m | 3.24 → 2.53 | 0.962 → 0.935 | 1.84 → 1.56 |
| Richmond | 4.11 → 2.88 (−30%) | 1,544 → 511 (−67%) | 335 → 120 m | 4.02 → 2.72 | 1.000 → 0.998 | 1.68 → 1.17 |

- **In a mature city, fewer jumps and priority-first pull against each other.** Seattle's priorities step down
  gradually (0.67, 0.57, 0.5, 0.44, 0.4, …), so any gate tight enough to keep high-priority streets first also
  refuses the neighbouring street often. With the gate wide open (`tol=1`) the planner reaches 2.10 jumps/km, 1.04×
  the bound, but its AUC falls to 0.63. At 0.15 the planner's win in Seattle is mostly *shorter* jumps (a jump lands
  on the nearest good street, not the region's first-by-id best one) and fewer dead ends, not fewer jumps. In an
  unaudited city (Richmond), where priority is flat, the planner gets close to the bound (1.17×).
- **The odd-start penalty earns its keep** at every tolerance: at 0.15, 300 m cuts jumps 7% (Seattle), 6% (Teaneck)
  and 17% (Richmond) against no penalty, for slightly longer jumps. 1,000 m buys at most another 1% and lengthens
  jumps further, so 300 stays.
- **`current+nearest` alone recovers most of the jump distance** (Seattle 3,749 → 1,372 m/km) but none of the jump
  count or dead ends. The planner's remaining margin over it is the dead ends (2.68 → 2.16 in Seattle) and the jump
  count in the smaller cities.
- **`tolerant` shows the quartile rule is the main source of jumps** (Seattle 4.37 → 2.75 at `tol=1`) but, with no
  nearest-jump and no trail planning, its jumps stay long (~775 m median) and its AUC falls with the jumps.

A wider tolerance is a product decision, not a technical one: if walking contiguous streets matters more than
covering the most-needed streets first, 0.25 gives 3.19 / 3.27 / 2.88 jumps/km at AUC 0.84 / 0.85 / 1.00.

## Caveats

- **One user, alone.** Priorities are fixed for the whole replay; in production other users finish streets
  meanwhile, which is why Explore replans rather than trusting a plan for a whole session.
- **Whole-region walks.** A real session is a few 152 m missions, not the whole region. The early part of the walk
  (what AUC weighs most) is what users actually see, but the jump rates are whole-region averages.
- **Dev-DB snapshot.** Seattle and Teaneck priorities are one moment of a mature city; Richmond is an unaudited
  city with nearly flat priority (its AUC is close to 1.0 for every policy for that reason).
- **No imagery gaps.** Every street is assumed walkable; give-ups (#4922) and their replans are not modelled.
- **Jump yardstick.** Jumps are geometric (> 10 m); a planner step that continues through a node merged at 10 m
  can, rarely, have a gap of 10–20 m and is then counted as a jump here, which errs against the planner.
