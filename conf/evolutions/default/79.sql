# --- !Ups
CREATE TABLE auth_tokens (
  user_id character varying(254) NOT NULL,
  id bytea NOT NULL,
  expiration_timestamp TIMESTAMPTZ NOT NULL
);

DELETE FROM user_login_info T1
USING user_login_info T2
WHERE T1.ctid < T2.ctid
AND T1.user_id = T2.user_id;

# --- !Downs
DROP TABLE auth_tokens;