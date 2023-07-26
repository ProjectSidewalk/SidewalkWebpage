# --- !Ups
INSERT INTO version VALUES ('7.15.3', now(), 'Maps in Taiwan now point to revealed villages.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.15.3';