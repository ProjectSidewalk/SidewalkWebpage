# --- !Ups
-- Who to contact for repairs and service requests, shown on the landing page as "contact <name> directly" (#5462).
-- Partner cities asked for this so residents don't mistake Project Sidewalk for an official reporting channel. NULL
-- in both columns (the default) means the city has no notice, so the landing page is unchanged. The length caps match
-- ConfigService.OfficialContactMaxNameLength / OfficialContactMaxUrlLength.
ALTER TABLE config
  ADD COLUMN official_contact_name TEXT
    CHECK (char_length(btrim(official_contact_name)) BETWEEN 1 AND 100),
  ADD COLUMN official_contact_url TEXT
    CHECK (official_contact_url LIKE 'https://%' AND char_length(official_contact_url) <= 500),
  ADD CONSTRAINT config_official_contact_both_or_neither_check
    CHECK ((official_contact_name IS NULL) = (official_contact_url IS NULL));

# --- !Downs
ALTER TABLE config
  DROP COLUMN IF EXISTS official_contact_url,
  DROP COLUMN IF EXISTS official_contact_name;
