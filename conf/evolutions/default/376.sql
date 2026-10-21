# --- !Ups
-- Record the licence a Panoramax picture is shared under (#5202). Panoramax contributors pick one per picture -- the
-- federated catalog serves CC-BY-SA-4.0, CC-BY-4.0 and etalab-2.0 side by side -- so unlike Mapillary's uniform
-- CC BY-SA it cannot be inferred from `source`. Without it, everything Project Sidewalk renders itself (a crop, a
-- self-hosted backup pano) can name the producer but not the licence, which CC BY-SA requires shown alongside.
-- Nullable: only Panoramax records one, and it starts complete because no Panoramax label exists yet.
-- Deliberately no CHECK constraint. The value set is open, not closed: it is whatever licence identifier the
-- contributor's own instance recorded, so a CHECK would reject an id we haven't seen and lose the one fact this
-- column exists to keep. ImageryAttribution falls back to showing an unrecognized id verbatim instead.
ALTER TABLE pano_data ADD COLUMN license TEXT;

# --- !Downs
ALTER TABLE pano_data DROP COLUMN license;
