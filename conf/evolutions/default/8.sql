
# --- !Ups
INSERT INTO role (role_id, role) VALUES (5, 'Owner');
INSERT INTO user_role (user_id, role_id) VALUES
  ('49787727-e427-4835-a153-9af6a83d1ed1', 5);

UPDATE role SET role = 'Turker' WHERE role_id = 2;
UPDATE role SET role = 'Administrator' WHERE role_id = 4;

UPDATE user_role SET role_id = 0 WHERE role_id = 2;
UPDATE user_role SET role_id = 2 WHERE role_id = 4;
UPDATE user_role SET role_id = 4 WHERE role_id = 0;

DELETE FROM user_role WHERE user_id IN (
  SELECT user_id FROM user_role WHERE role_id = 5
) AND role_id < 5;
DELETE FROM user_role WHERE user_id IN (
  SELECT user_id FROM user_role WHERE role_id = 4
) AND role_id < 4;
DELETE FROM user_role WHERE user_id IN (
  SELECT user_id FROM user_role WHERE role_id = 3
) AND role_id < 3;
DELETE FROM user_role WHERE user_id IN (
  SELECT user_id FROM user_role WHERE role_id = 2
) AND role_id < 2;


# --- !Downs
INSERT INTO user_role (user_id, role_id)
  SELECT user_id, 1
  FROM (
         SELECT user_id, role_id
         FROM user_role
         WHERE role_id > 2
       ) researchers_to_owner;
INSERT INTO user_role (user_id, role_id)
  SELECT user_id, 3
  FROM (
         SELECT user_id, role_id
         FROM user_role
         WHERE role_id > 3
       ) admins_and_owner;
INSERT INTO user_role (user_id, role_id)
  SELECT user_id, 4
  FROM (
         SELECT user_id, role_id
         FROM user_role
         WHERE role_id > 4
       ) owner;

DELETE FROM user_role WHERE role_id = 5;

UPDATE user_role SET role_id = 0 WHERE role_id = 2;
UPDATE user_role SET role_id = 2 WHERE role_id = 4;
UPDATE user_role SET role_id = 4 WHERE role_id = 0;

UPDATE role SET role = 'Administrator' WHERE role_id = 2;
UPDATE role SET role = 'Turker' WHERE role_id = 4;
DELETE FROM role WHERE role_id = 5;
