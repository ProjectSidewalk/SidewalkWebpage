-- Hand-run sidewalk_login split, injected before evolution 252 (issue #4700). On mainline this
-- was done out-of-band in Oct 2024: draft evolutions 249-251 (CREATE SCHEMA + tables + Seattle
-- data copy) were deleted in commit 414bcb936 and run by hand. This is those scripts adapted for
-- the DC sandbox: same DDL, data copied from the DC city schema, per-city login tables then
-- dropped so later evolutions' unqualified references resolve to sidewalk_login via search_path.

-- 249: the schema.
CREATE SCHEMA IF NOT EXISTS sidewalk_login;
ALTER SCHEMA sidewalk_login OWNER TO sidewalk;

-- 250: the tables (DDL verbatim; grants trimmed to the roles that exist in the sandbox).
CREATE TABLE IF NOT EXISTS sidewalk_login.user_password_info (
    user_password_info_id SERIAL NOT NULL,
    login_info_id bigint NOT NULL,
    password VARCHAR(254) NOT NULL,
    salt VARCHAR(254),
    hasher VARCHAR(254) NOT NULL,
    PRIMARY KEY (user_password_info_id)
);
CREATE TABLE IF NOT EXISTS sidewalk_login.login_info(
    login_info_id BIGSERIAL NOT NULL,
    provider_id VARCHAR(254),
    provider_key VARCHAR(254),
    PRIMARY KEY (login_info_id)
);
CREATE TABLE IF NOT EXISTS sidewalk_login.user_login_info(
    user_login_info_id SERIAL NOT NULL,
    login_info_id bigint NOT NULL,
    user_id VARCHAR(254) NOT NULL,
    PRIMARY KEY (user_login_info_id)
);
CREATE INDEX IF NOT EXISTS user_login_info_login_info_id_idx ON sidewalk_login.user_login_info USING btree(login_info_id);
CREATE INDEX IF NOT EXISTS user_login_info_user_id_idx ON sidewalk_login.user_login_info USING btree(user_id);
CREATE TABLE IF NOT EXISTS sidewalk_login.sidewalk_user(
    user_id TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    PRIMARY KEY (user_id)
);
CREATE INDEX IF NOT EXISTS user_id_idx ON sidewalk_login.sidewalk_user USING btree(user_id);
CREATE INDEX IF NOT EXISTS username_idx ON sidewalk_login.sidewalk_user USING btree(username);
CREATE INDEX IF NOT EXISTS email_idx ON sidewalk_login.sidewalk_user USING btree(email);
CREATE TABLE sidewalk_login.auth_tokens (
    user_id character varying(254) NOT NULL,
    id bytea NOT NULL,
    expiration_timestamp TIMESTAMPTZ NOT NULL
);
ALTER TABLE sidewalk_login.user_password_info OWNER TO sidewalk;
ALTER TABLE sidewalk_login.login_info OWNER TO sidewalk;
ALTER TABLE sidewalk_login.user_login_info OWNER TO sidewalk;
ALTER TABLE sidewalk_login.sidewalk_user OWNER TO sidewalk;
ALTER TABLE sidewalk_login.auth_tokens OWNER TO sidewalk;

-- 251 adapted: copy DC's login data (unqualified names resolve to the DC city schema).
INSERT INTO sidewalk_login.sidewalk_user(user_id, username, email)
SELECT user_id, username, email FROM sidewalk.sidewalk_user;

INSERT INTO sidewalk_login.login_info(login_info_id, provider_id, provider_key)
SELECT login_info_id, provider_id, provider_key FROM sidewalk.login_info;
SELECT setval('sidewalk_login.login_info_login_info_id_seq', (SELECT MAX(login_info_id) FROM sidewalk_login.login_info));

INSERT INTO sidewalk_login.user_login_info(user_login_info_id, user_id, login_info_id)
SELECT user_login_info_id, user_id, login_info_id FROM sidewalk.user_login_info;
SELECT setval('sidewalk_login.user_login_info_user_login_info_id_seq', (SELECT MAX(user_login_info_id) FROM sidewalk_login.user_login_info));

INSERT INTO sidewalk_login.user_password_info (user_password_info_id, login_info_id, password, salt, hasher)
SELECT user_password_info_id, login_info_id, password, salt, hasher FROM sidewalk.user_password_info;
SELECT setval('sidewalk_login.user_password_info_user_password_info_id_seq', (SELECT MAX(user_password_info_id) FROM sidewalk_login.user_password_info));

-- role and user_role live in sidewalk_login on prod (moved out-of-band alongside the split; later
-- evolutions -- 313, 316, 337 -- reference them there explicitly). SET SCHEMA carries their FKs
-- along, so repoint user_role's FKs at the login-schema tables before the per-city drops below.
ALTER TABLE role SET SCHEMA sidewalk_login;
ALTER TABLE user_role SET SCHEMA sidewalk_login;
DO $do$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'sidewalk_login.user_role'::regclass AND contype = 'f' LOOP
    EXECUTE format('ALTER TABLE sidewalk_login.user_role DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $do$;
ALTER TABLE sidewalk_login.user_role
  ADD CONSTRAINT user_role_role_id_fkey FOREIGN KEY (role_id) REFERENCES sidewalk_login.role(role_id),
  ADD CONSTRAINT user_role_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);

-- 251's FK moves, unqualified (the DC city schema) referencing the login schema.
ALTER TABLE audit_task DROP CONSTRAINT IF EXISTS audit_task_user_id_fkey;
ALTER TABLE audit_task ADD CONSTRAINT audit_task_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE gallery_task_environment DROP CONSTRAINT IF EXISTS gallery_task_environment_user_id_fkey;
ALTER TABLE gallery_task_environment ADD CONSTRAINT gallery_task_environment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE gallery_task_interaction DROP CONSTRAINT IF EXISTS gallery_task_interaction_user_id_fkey;
ALTER TABLE gallery_task_interaction ADD CONSTRAINT gallery_task_interaction_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE label_history DROP CONSTRAINT IF EXISTS label_history_edited_by_fkey;
ALTER TABLE label_history ADD CONSTRAINT label_history_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE label_validation DROP CONSTRAINT IF EXISTS label_validation_user_id_fkey;
ALTER TABLE label_validation ADD CONSTRAINT label_validation_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE mission DROP CONSTRAINT IF EXISTS mission_user_id_fkey;
ALTER TABLE mission ADD CONSTRAINT mission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE route DROP CONSTRAINT IF EXISTS route_user_id_fkey;
ALTER TABLE route ADD CONSTRAINT route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE user_clustering_session DROP CONSTRAINT IF EXISTS user_clustering_session_user_id_fkey;
ALTER TABLE user_clustering_session ADD CONSTRAINT user_clustering_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE user_org DROP CONSTRAINT IF EXISTS user_org_user_id_fkey;
ALTER TABLE user_org ADD CONSTRAINT user_org_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE user_route DROP CONSTRAINT IF EXISTS user_route_user_id_fkey;
ALTER TABLE user_route ADD CONSTRAINT user_route_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE user_stat DROP CONSTRAINT IF EXISTS user_stat_user_id_fkey;
ALTER TABLE user_stat ADD CONSTRAINT user_stat_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE user_survey_option_submission DROP CONSTRAINT IF EXISTS user_survey_option_submission_user_id_fkey;
ALTER TABLE user_survey_option_submission ADD CONSTRAINT user_survey_option_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE user_survey_text_submission DROP CONSTRAINT IF EXISTS user_survey_text_submission_user_id_fkey;
ALTER TABLE user_survey_text_submission ADD CONSTRAINT user_survey_text_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE validation_task_comment DROP CONSTRAINT IF EXISTS validation_task_comment_user_id_fkey;
ALTER TABLE validation_task_comment ADD CONSTRAINT validation_task_comment_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);
ALTER TABLE webpage_activity DROP CONSTRAINT IF EXISTS webpage_activity_user_id_fkey;
ALTER TABLE webpage_activity ADD CONSTRAINT webpage_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES sidewalk_login.sidewalk_user(user_id);

-- Per-city login copies go away entirely (modern city schemas don't have them; leaving empty
-- husks would shadow sidewalk_login via search_path for every later unqualified reference).
-- CASCADE mops up any FK the list above missed -- 337.sql re-adds the canonical cross-schema set.
-- auth_tokens stays per-city (matches prod; it holds transient remember-me tokens, so truncate).
TRUNCATE auth_tokens;
DROP TABLE sidewalk.user_password_info;
DROP TABLE sidewalk.user_login_info;
DROP TABLE sidewalk.sidewalk_user CASCADE;
DROP TABLE sidewalk.login_info CASCADE;
