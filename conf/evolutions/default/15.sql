# --- !Ups
UPDATE role SET role = 'Registered' WHERE role = 'User';

INSERT INTO role VALUES ( 6, 'Anonymous' );

TRUNCATE TABLE user_clustering_session CASCADE;
ALTER TABLE user_clustering_session
  DROP COLUMN is_anonymous,
  DROP COLUMN ip_address,
  ALTER COLUMN user_id SET NOT NULL;

# --- !Downs
TRUNCATE TABLE user_clustering_session CASCADE;
ALTER TABLE user_clustering_session
  ADD COLUMN is_anonymous BOOLEAN NOT NULL,
  ADD COLUMN ip_address TEXT,
  ALTER COLUMN user_id DROP NOT NULL;

UPDATE user_role SET role_id = 1 WHERE role_id = 6;
DELETE FROM role WHERE role = 'Anonymous';

UPDATE role SET role = 'User' WHERE role = 'Registered';
