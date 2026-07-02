# --- !Ups
-- Set the owner of tables added in 326.sql and 327.sql, which were created without it. Every new table needs its owner
-- reassigned to sidewalk so the app role has the correct permissions on the prod server (see 309.sql for the pattern).
ALTER TABLE street_imagery OWNER TO sidewalk;
ALTER TABLE funnel_stat OWNER TO sidewalk;

# --- !Downs
