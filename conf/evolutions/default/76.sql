# --- !Ups
CREATE TABLE auth_tokens (
  user_id character varying(254) NOT NULL,
  id character varying(254) NOT NULL,
  timestamp TIMESTAMPTZ
);