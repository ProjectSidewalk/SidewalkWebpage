# --- !Ups
INSERT INTO version VALUES ('11.19.0', now(), 'Validators in Gallery can say why they chose Disagree or Unsure.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.19.0';
