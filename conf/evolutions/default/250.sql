-- Create tables and indexes for login tables and grant "sidewalk" user access

# --- !Ups

-- TABLE: user_password_info
CREATE TABLE sidewalk_login.user_password_info (
    user_password_info_id SERIAL NOT NULL,
    login_info_id bigint NOT NULL,
    password VARCHAR(254) NOT NULL,
    salt VARCHAR(254),
    hasher VARCHAR(254) NOT NULL,
    PRIMARY KEY (user_password_info_id)
);
ALTER TABLE sidewalk_login.user_password_info OWNER TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.user_password_info TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.user_password_info TO postgres;

-- TABLE: login_info
CREATE TABLE sidewalk_login.login_info(
    login_info_id BIGSERIAL NOT NULL,
    provider_id VARCHAR(254),
    provider_key VARCHAR(254),
    PRIMARY KEY (login_info_id)
);
ALTER TABLE sidewalk_login.login_info OWNER TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.login_info TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.login_info TO postgres;

-- TABLE: user_login_info
CREATE TABLE sidewalk_login.user_login_info(
    user_login_info_id SERIAL NOT NULL,
    login_info_id bigint NOT NULL,
    user_id VARCHAR(254) NOT NULL,
    PRIMARY KEY (user_login_info_id)
);
CREATE INDEX user_login_info_login_info_id_idx ON sidewalk_login.user_login_info USING btree(login_info_id);
CREATE INDEX user_login_info_user_id_idx ON sidewalk_login.user_login_info USING btree(user_id);
ALTER TABLE sidewalk_login.user_login_info OWNER TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.user_login_info TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.user_login_info TO postgres;

-- TABLE: sidewalk_user
CREATE TABLE sidewalk_login.sidewalk_user(
    user_id TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    PRIMARY KEY (user_id)
);
CREATE INDEX user_id_idx ON sidewalk_login.sidewalk_user USING btree(user_id);
CREATE INDEX username_idx ON sidewalk_login.sidewalk_user USING btree(username);
CREATE INDEX email_idx ON sidewalk_login.sidewalk_user USING btree(email);
ALTER TABLE sidewalk_login.sidewalk_user OWNER TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.sidewalk_user TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.sidewalk_user TO postgres;

# --- !Downs
-- TABLE: user_password_info
DROP TABLE IF EXISTS sidewalk_login.user_password_info;

-- TABLE: login_info
DROP TABLE IF EXISTS sidewalk_login.login_info;

-- TABLE: user_login_info
DROP TABLE IF EXISTS sidewalk_login.user_login_info;
DROP INDEX IF EXISTS user_login_info_login_info_id_idx;
DROP INDEX IF EXISTS user_login_info_user_id_idx;

-- TABLE: sidewalk_user
DROP TABLE IF EXISTS sidewalk_login.sidewalk_user;
DROP INDEX IF EXISTS user_id_idx;
DROP INDEX IF EXISTS username_idx;
DROP INDEX IF EXISTS email_idx;
