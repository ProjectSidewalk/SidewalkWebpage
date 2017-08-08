
# --- !Ups
INSERT INTO role (role_id, role) VALUES (4, 'Owner');
UPDATE role SET role = 'Researcher' WHERE role_id = 2;
UPDATE role SET role = 'Administrator' WHERE role_id = 3;

UPDATE user_role SET role_id = 0 WHERE role_id = 2;
UPDATE user_role SET role_id = 2 WHERE role_id = 3;
UPDATE user_role SET role_id = 3 WHERE role_id = 0;

DELETE FROM user_role WHERE user_id = '49787727-e427-4835-a153-9af6a83d1ed1';
DELETE FROM user_role WHERE user_id IN (
    SELECT user_id FROM user_role WHERE role_id = 3
) AND role_id < 3;
DELETE FROM user_role WHERE user_id IN (
    SELECT user_id FROM user_role WHERE role_id = 2
) AND role_id < 2;
INSERT INTO user_role (user_id, role_id) VALUES
    ('49787727-e427-4835-a153-9af6a83d1ed1', 4);


# --- !Downs
INSERT INTO user_role (user_id, role_id)
SELECT user_id, 1
FROM (
    SELECT user_id, role_id
    FROM user_role
    WHERE role_id > 1
) researchers;
INSERT INTO user_role (user_id, role_id)
SELECT user_id, 2
FROM (
    SELECT user_id, role_id
    FROM user_role
    WHERE role_id > 2
) admins;
INSERT INTO user_role (user_id, role_id) VALUES
    ('49787727-e427-4835-a153-9af6a83d1ed1', 3);

DELETE FROM user_role WHERE role_id = 4;

UPDATE user_role SET role_id = 0 WHERE role_id = 2;
UPDATE user_role SET role_id = 2 WHERE role_id = 3;
UPDATE user_role SET role_id = 3 WHERE role_id = 0;

UPDATE role SET role = 'Administrator' WHERE role_id = 2;
UPDATE role SET role = 'Researcher' WHERE role_id = 3;
DELETE FROM role WHERE role_id = 4;
