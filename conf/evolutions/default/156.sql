# --- !Ups
UPDATE sidewalk_user
SET email = LOWER(email)
WHERE email <> LOWER(email);

UPDATE login_info
SET provider_key = LOWER(provider_key)
WHERE provider_key <> LOWER(provider_key);

# --- !Downs
