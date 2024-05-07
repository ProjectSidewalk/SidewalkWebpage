# --- !Ups
-- Create Login Schema to unify login systems.
CREATE SCHEMA IF NOT EXISTS sidewalk_login;
ALTER SCHEMA sidewalk_login OWNER TO sidewalk;

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
    login_info_id bigint SERIAL NOT NULL,
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
    user_id TEXT[] UNIQUE NOT NULL,
    username TEXT[] UNIQUE NOT NULL,
    email TEXT[] NOT NULL,
    PRIMARY KEY (user_id)
);
CREATE INDEX user_id_idx ON sidewalk_login.sidewalk_user USING btree(user_id);
CREATE INDEX username_idx ON sidewalk_login.sidewalk_user USING btree(username);
CREATE INDEX email_idx ON sidewalk_login.sidewalk_user USING btree(email);
ALTER TABLE sidewalk_login.sidewalk_user OWNER TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.sidewalk_user TO sidewalk;
GRANT ALL ON TABLE sidewalk_login.sidewalk_user TO postgres;

# --- !Downs
DROP SCHEMA IF EXISTS sidewalk_login CASCADE;
