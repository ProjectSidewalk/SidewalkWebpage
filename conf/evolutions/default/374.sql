# --- !Ups
-- No semicolons in the description: Play's parser splits statements on them even inside a string literal.
INSERT INTO version VALUES ('11.11.0', now(), 'Fixes mobile Validate bugs when showing Mapillary/Infra3d imagery, and LabelMap and label popups load faster.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.11.0';
