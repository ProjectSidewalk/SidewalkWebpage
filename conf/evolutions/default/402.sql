# --- !Ups
-- Who to contact for repairs and service requests, shown on the landing page as "contact <name> directly" (#5462).
-- Partner cities asked for this so residents don't mistake Project Sidewalk for an official reporting channel. NULL
-- in both columns (the default) means the city has no notice, so the landing page is unchanged.
ALTER TABLE config
  ADD COLUMN official_contact_name TEXT,
  ADD COLUMN official_contact_url TEXT,
  ADD CONSTRAINT config_official_contact_both_or_neither_check
    CHECK ((official_contact_name IS NULL) = (official_contact_url IS NULL)),
  ADD CONSTRAINT config_official_contact_url_https_check
    CHECK (official_contact_url IS NULL OR official_contact_url LIKE 'https://%');

# --- !Downs
ALTER TABLE config
  DROP COLUMN IF EXISTS official_contact_url,
  DROP COLUMN IF EXISTS official_contact_name;
