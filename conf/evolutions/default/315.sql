# --- !Ups
INSERT INTO version VALUES ('11.4.1', now(), 'AI tags more accurate, and AI validation/tags available on older imagery.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.4.1';
