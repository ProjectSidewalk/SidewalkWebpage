# --- !Ups
INSERT INTO version VALUES ('8.0.2', now(), 'Adds configs for Cliffside Park, NJ & Blackhawk Hills, IL');

# --- !Downs
DELETE FROM version WHERE version_id = '8.0.2';
