# --- !Ups
-- No semicolons in the description: Play's parser splits statements on them even inside a string literal.
INSERT INTO version VALUES ('11.10.0', now(), 'Brings LabelMap and Gallery to phones and fixed users getting stuck in Zurich/Winterthur.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.10.0';
