# --- !Ups
INSERT INTO role (role_id, role) VALUES (4, 'Turker');

# --- !Downs
DELETE FROM role WHERE (role_id = 4 AND role = 'Turker');
DELETE FROM user_role WHERE role_id = 4;