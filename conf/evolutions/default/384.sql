# --- !Ups
-- No semicolons in the description: Play's parser splits statements on them even inside a string literal.
INSERT INTO version VALUES ('11.12.0', now(), 'Adds the legacy Washington, DC database as a modern deployment, French language support, Panoramax imagery support, and improvements to AccessScore.');

# --- !Downs
DELETE FROM version WHERE version_id = '11.12.0';
