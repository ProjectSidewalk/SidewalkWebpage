---
applyTo: "conf/evolutions/default/*.sql"
---
# Play evolution (schema) review — highest-value checks

- **One evolution file per PR.** Flag a PR minting a new-numbered file when its
  changes could fold into the PR's existing evolution.
- **Owner:** every `CREATE TABLE` must be followed by
  `ALTER TABLE <name> OWNER TO sidewalk;` in the same file. Flag any missing it.
  Tables ONLY — not enum types, views, or standalone sequences; SERIAL/identity
  sequences are covered automatically by the table's owner change.
- **Full constraints — don't lean on the app.** For each new/altered table flag
  missing: `NOT NULL` on never-null columns, `UNIQUE`/PK on natural keys & 1:1
  relationships, a `FOREIGN KEY` for every reference, a `CHECK` for bounded domains
  (severity 1–3, non-negative counts, 0–1 fractions, valid lat/lng). Each must be
  mirrored in the Slick model.
- **Closed value sets:** prefer a Postgres enum type (high-row / runtime-written /
  Scala-mirrored columns) or a `CHECK (col IN (...))` (tiny config tables) over a
  lookup table or bare text. When an enum replaces a same-named lookup table,
  `DROP TABLE` must precede `CREATE TYPE`.
- **Renames leave fossils.** An evolution renaming a table/column must also
  `ALTER TABLE ... RENAME CONSTRAINT` / `ALTER INDEX ... RENAME` every constraint
  and index embedding the old name (to `<table>_<column>_{fkey,key,pkey,check}`) and
  update the Slick name string. Flag a rename that omits this.
- **Parser trap:** no `;` inside a `-- comment` — Play's evolution parser splits
  statements on `;` and will break. Flag it.
- Both `# --- !Ups` and `# --- !Downs` sections must be present.
