INSERT INTO version VALUES ('6.5.0', now(), 'Now automatically routed between audits and validations, and labels are shown on mini map when returning.');

# --- !Downs
DELETE FROM version WHERE version_id = '6.5.0';
