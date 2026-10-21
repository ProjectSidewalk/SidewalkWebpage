# --- !Ups
-- No semicolons in the description: Play's parser splits statements on them even inside a string literal.
INSERT INTO version VALUES ('11.9.0', now(), 'Adds street re-audits when new imagery arrives, label editing from the label card, and cross-city mapper stats.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.9.0';
