# --- !Ups
-- One-time backfill: title-case Houston's neighborhood names, which were imported ALL CAPS before fill-new-schema.sh
-- learned to normalize them (issue #4596). Scoped to Houston via current_schema() -- during evolution application the
-- city's own schema is on the search_path, so this is a plain no-op for every other deployment. A read-only dry-run
-- across all sites showed the other all-caps cities (CDMX, La Piedad, Rancagua, ...) carry local conventions -- Spanish
-- connector words, "Unidad Vecinal" (UV) codes, dotted org acronyms -- that initcap would mangle, so they are deferred
-- to a per-city review rather than swept here.
--
-- Rule (identical to the importer): title-case a name that is entirely uppercase AND is either multi-word or a single
-- token of 5+ characters -- shorter single tokens are treated as acronyms and left alone. COLLATE "default" makes
-- initcap use the database's UTF-8 collation instead of the name column's POSIX collation, under which initcap treats
-- accented letters as word boundaries and corrupts them. Houston is all-ASCII, but this keeps the statement identical
-- to the importer and correct for any accented data.
UPDATE region SET name = initcap(name COLLATE "default")
WHERE current_schema() = 'sidewalk_houston'
  AND name = upper(name) AND name ~ '[[:alpha:]]' AND (name LIKE '% %' OR char_length(name) >= 5);

# --- !Downs
-- One-way data normalization: the original casing is not stored, so there is nothing to restore automatically.
