# Database evolutions

Schema changes are **Play evolutions**: numbered SQL files in `conf/evolutions/default/`, each with a `# --- !Ups`
and a `# --- !Downs` section. They apply automatically when the app next starts or serves a page (`autoApply` and
`autoApplyDowns` are both on), to every city schema in turn. This page is the full set of rules for writing one;
[`docs/architecture.md`](architecture.md) has the one-paragraph summary and
[`docs/deployment-and-stages.md`](deployment-and-stages.md) covers what happens to evolutions on deploy and rollback.

Run `make lint-evolutions` before pushing. It is the static check CI enforces: a semicolon inside a `--` comment
(Play splits statements on every `;`, comments included, and then executes the orphaned text) and missing
`!Ups`/`!Downs` markers.

## Numbering

**Numbers must be gapless.** Play's evolutions reader walks 1, 2, 3, … and stops at the first missing file, so a file
that skips ahead of a number an in-flight PR "owns" is silently never read: the app boots fine and the evolution just
doesn't apply. Always take exactly `highest-on-your-branch + 1` and resolve a collision with another in-flight PR at
merge time.

**One evolution file per PR.** All of a PR's schema changes go in a single file, even when they land in separate
commits or feel like separate concerns. Until the PR merges nothing has shipped, so fold later changes into the
existing file rather than minting the next number, which also collides faster with other in-flight PRs.

**Renumbering after a merge from `develop`.** In-flight PRs claim numbers concurrently, so a merge routinely lands
someone else's file on the number yours is using. Renumber yours (never theirs; theirs has shipped):

1. `git mv conf/evolutions/default/<old>.sql conf/evolutions/default/<new>.sql`, where `<new>` is one past the highest
   number now in the directory. Grep the repo for the old number and update every reference: evolution comments, the
   PR description, planning docs, and the branch's own commit messages if you're rewriting them.
2. Load any page. The local DB needs no manual cleanup: Play stores each applied evolution's `revert_script` in
   `<schema>.play_evolutions`, so when develop's file lands on the id yours was applied under, the hash mismatch makes
   it run *your* saved downs and then develop's ups, followed by your new number's ups. This is silent, and it means
   **your Down has to actually work**: a broken one fails here and leaves the row in `applying_down`, which is the
   state behind Play's "inconsistent state" error and does need hand-fixing.

## Every `CREATE TABLE` needs `ALTER TABLE <name> OWNER TO sidewalk;`

Put it in the same evolution (see 309.sql for the pattern). On the prod server, evolutions run as an admin role, so a
new table would otherwise be owned by that role and the `sidewalk` app role would lack permissions on it. This is
easy to forget, and a missed one has to be patched by a later evolution (321.sql fixed 314.sql; 329.sql fixed
326.sql and 327.sql). It applies to **tables only**:

- **SERIAL / identity sequences** are covered automatically. `ALTER TABLE … OWNER TO` recursively reassigns any
  sequence a column owns.
- **Enum types, views, and standalone sequences do not get an owner change.** The app only needs default
  `USAGE`/`SELECT` on those, which it already has, and they're never altered at runtime.

## Give every table its full set of constraints

Don't lean on the app to enforce integrity. When you `CREATE TABLE` (or `ALTER` one), add every constraint the data
model implies: `NOT NULL` on any column the app never writes null to, `UNIQUE` on a natural key or one-to-one
relationship (or make it the `PRIMARY KEY`), a `FOREIGN KEY` for every reference to another table, and a `CHECK`
for a bounded domain (a severity `1`–`3`, a non-negative count, a `0`–`1` fraction, a valid lat/lng). A missing
constraint silently rots into bad data; backfilling ones that should have been there from the start has cost whole
PRs (#3574 for FKs, #3944 for NOT NULL/UNIQUE/PK/CHECK).

**Mirror each in the Slick model** so schema and code agree: a non-`Option` `column[T]` means `NOT NULL`,
`def pk = primaryKey(...)` declares a composite PK (single-column PKs use `O.PrimaryKey` inline),
`index(..., unique = true)` a UNIQUE, and `foreignKey(...)` an FK. A column `DEFAULT` is mirrored with
`O.Default(...)`; it's DDL-only in Slick and we never generate DDL, so it's documentation, but a `*Table.scala`
should say what the schema does. Two things `O.Default` can't express, because it holds a *value* rather than an
expression: a **volatile default** (`now()`, `CURRENT_TIMESTAMP`), where `O.Default(OffsetDateTime.now)` would
freeze an arbitrary instant into the model, so write `// DEFAULT now() in the DB` instead; and a **CHECK
constraint**, which has no Slick DSL, so leave a comment noting the invariant.

## Closed value sets: enum types or CHECKs, not lookup tables or bare text

When a column can only hold a fixed set of values, pick between two tools (#4103):

- A **Postgres enum type** when the column is on a high-row-count table, is written at runtime, or is mirrored by a
  Scala enum. It makes the DB self-describing (readable raw SQL and dumps, no join to a lookup table, no
  hand-maintained Scala id map that nothing validates) and fails loudly on drift. Wire it up like the existing ones
  (`pano_source`, `validation_option`, `street_edge_status`, `mission_type`, `way_type`): a Scala `Enumeration`
  object whose string values match the enum labels, plus a `createEnumJdbcType` mapper in `MyPostgresProfile`.
  Growing a set later is fine; `ALTER TYPE ... ADD VALUE` has prod precedent (331/332/339).
- A plain **`CHECK (col IN (...))`** for tiny script-seeded config/cache tables (e.g. `config.open_status`,
  `funnel_stat.funnel_type`), where the enum's join/space/mapping benefits are nil.

Two gotchas: tables and types share a namespace, so when an enum replaces a lookup table of the same name,
`DROP TABLE` must precede `CREATE TYPE`; and enum values are compared as enum literals in SQL, so a raw-SQL filter
built from user input must validate values first (an invalid literal is a Postgres error, not an empty result).

## Renaming a table or column renames nothing else

Postgres keeps a constraint's or index's original name when you rename the table or column it belongs to, so the
old name sticks and silently drifts from what it enforces. An evolution that renames a column (or table) must also
`ALTER TABLE … RENAME CONSTRAINT` / `ALTER INDEX … RENAME` every constraint and index whose name embeds the old
identifier, back to the `<table>_<column>_{fkey,key,pkey,check}` convention, and update the matching name string in
the Slick model (`foreignKey`/`index`/`primaryKey`). Skipping this forces a later evolution to patch the fossils:
337.sql had to rename three, e.g. `user_org_org_id_fkey` → `user_team_team_id_fkey`, left over from an old
`user_org` → `user_team` rename.

## Write for production scale, and finish with an efficiency pass

The dev DB is small enough that any SQL looks fast; prod tables are not (`label`, `label_validation`,
`label_history` run to hundreds of thousands of rows per schema, `user_stat` to ~1M), and an evolution applies to
**every** city schema in sequence on deploy, so a slow statement multiplies by 54. Concretely:

- **Prefer joins to correlated subqueries.** A scalar subquery in a SELECT list or a per-row `IN (SELECT …)` /
  `NOT IN (SELECT …)` re-executes per outer row; the same lookup as a `JOIN`/`LEFT JOIN` (or `EXISTS`/`NOT EXISTS`,
  which the planner turns into semi/anti-joins) lets the planner pick a hash join and stays fast when the outer set
  is large. `NOT IN` also has the NULL trap: one NULL in the subquery result silently empties the whole result set.
- **A join can keep a scalar subquery's fail-loudly property.** If a scalar subquery is doing double duty as a
  one-to-one assert ("more than one row returned"), a `LEFT JOIN` that fans out into a PRIMARY KEY/UNIQUE violation
  on the receiving table fails just as loudly with a better plan.
- **Before an evolution is done, walk every statement and name its access path** on the big tables: which index
  serves each join/filter column (check with `\d`; don't assume), and what the driving row count is at prod scale.
  A statement with no index behind it on a large table needs a rewrite or a justification comment.
- City schemas differ by ~1000x in size, so `EXPLAIN` against the largest local schema, not the smallest.

## Cached distance columns

Distances are measured geodesically (`ST_Length(geom::geography)`; see [`style-guide.md`](style-guide.md)). Cached
distance columns (`user_stat.meters_audited`, `labels_per_meter` and the `high_quality` flag derived from it,
`region_completion`, `route.distance_meters`) must equal what their runtime recompute would produce, so changing a
distance query means recomputing its caches in the same evolution, and the nightly refresh that maintains them has to
reach every row a full recompute would touch (#4774). `GeodesicDistanceSpec` checks both against the connected
database; it needs a *seeded* one, since its cache-freshness tests cancel on empty tables.

## A new table that cross-schema queries read

`ConfigTable`'s fan-out queries read other cities' schemas, and each city instance applies its own evolutions when it
restarts, so mid-rollout an updated instance can query a schema that hasn't applied the new evolution yet. See
[`docs/deployment-and-stages.md`](deployment-and-stages.md) → "Adding a table that cross-schema queries read" for
the two ways to handle it.

## Style

2-space indent (don't copy the 4-space style of old files), no table aliases, comments start with a capital letter
and end with a period. A `--` comment must not contain a semicolon.
