# --- !Ups
INSERT INTO version VALUES ('7.4.0', now(), 'City dropdown in navbar now shows the current city''s name.');

# --- !Downs
DELETE FROM version WHERE version_id = '7.4.0';
