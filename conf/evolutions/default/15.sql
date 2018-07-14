# --- !Ups
UPDATE role SET role = 'Registered' WHERE role = 'User';

INSERT INTO role VALUES ( 6, 'Anonymous' );

# --- !Downs
DELETE FROM role WHERE role = 'Anonymous';

UPDATE role SET role = 'User' WHERE role = 'Registered';
