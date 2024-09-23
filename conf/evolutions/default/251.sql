-- Move data from city schemas to new login data schema
-- TODO: Copy login data from ALL cities to login schema
-- TODO: Among duplicates across cities, keep data from most recently logged in user.
-- TODO: Update pkey sequence to the end of the data's sequence

-- Copy all login info from Pittsburgh into the new sidewalk_login schema
INSERT INTO sidewalk_login.sidewalk_user(user_id, username, email)
SELECT user_id, username, email FROM sidewalk_pittsburgh.sidewalk_user;

INSERT INTO sidewalk_login.login_info(login_info_id, provider_id, provider_key)
SELECT login_info_id, provider_id, provider_key FROM sidewalk_pittsburgh.login_info;

INSERT INTO sidewalk_login.user_login_info(user_login_info_id, user_id, login_info_id)
SELECT user_login_info_id, user_id, login_info_id FROM sidewalk_pittsburgh.user_login_info;

INSERT INTO sidewalk_login.user_password_info (user_password_info_id, login_info_id, "password", salt, hasher)
SELECT user_password_info_id, login_info_id, "password", salt, hasher FROM sidewalk_pittsburgh.user_password_info;
