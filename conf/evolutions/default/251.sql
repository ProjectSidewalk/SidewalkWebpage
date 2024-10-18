# --- !Ups
INSERT INTO version VALUES ('7.20.9', now(), 'Simplifies Explore page Jump button options, nudging users towards Stuck button.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.20.9';
