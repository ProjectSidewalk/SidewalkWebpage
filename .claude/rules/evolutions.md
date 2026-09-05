---
paths:
  - "conf/evolutions/**"
---

# Evolutions

Read `docs/evolutions.md` before writing or editing one. The rules that have caused outages or whole cleanup PRs:

- **Numbers are gapless.** Take exactly `highest-on-your-branch + 1`; Play stops reading at the first missing
  number, so a skipped-ahead file silently never applies. **One evolution file per PR**, folding later changes into
  it. After a merge from `develop` lands on your number, renumber *yours* (`git mv`, grep for the old number) and
  reload a page; your Down must actually work, because Play runs it during the swap.
- **Every `CREATE TABLE` is followed by `ALTER TABLE <name> OWNER TO sidewalk;`** in the same evolution. Tables
  only: sequences follow automatically, and enum types/views don't need it.
- **Full constraints up front** (`NOT NULL`, `UNIQUE`/`PRIMARY KEY`, `FOREIGN KEY`, `CHECK` on bounded domains),
  mirrored in the Slick `*Table.scala`. Closed value sets are enum types (with a `createEnumJdbcType` mapper) or a
  `CHECK (col IN (...))` for tiny config tables, never lookup tables or bare text.
- **Renaming a column or table renames nothing else.** Rename its constraints and indexes back to
  `<table>_<column>_{fkey,key,pkey,check}` and update the name strings in the Slick model.
- **Write for prod scale.** Joins/`EXISTS` over correlated subqueries and `NOT IN`; name the index behind every
  join/filter on a big table before you're done. The evolution runs on 54 schemas in sequence.
- Cached distance columns must match their runtime recompute; changing a distance query recomputes its caches in the
  same evolution.
- `make lint-evolutions` before pushing. No `;` inside a `--` comment. 2-space indent, no table aliases.
