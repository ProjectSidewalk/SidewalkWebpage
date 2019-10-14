# --- !Ups
INSERT INTO version VALUES ('6.6.3', now(), 'Changes how turkers are switched between audits and validations.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.6.3';
