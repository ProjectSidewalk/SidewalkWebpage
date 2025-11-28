# --- !Ups
-- Add a new role for the dummy SidewalkAI user.
INSERT INTO sidewalk_login.role (role_id, role)
SELECT 7, 'AI'
WHERE NOT EXISTS (SELECT 1 FROM sidewalk_login.role WHERE role = 'AI');

UPDATE sidewalk_login.user_role SET role_id = 7 WHERE user_id = '51b0b927-3c8a-45b2-93de-bd878d1e5cf4';

# --- !Downs
UPDATE sidewalk_login.user_role SET role_id = 1 WHERE role_id = 7;

DELETE FROM sidewalk_login.role WHERE role = 'AI';
