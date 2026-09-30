-- =====================================================================
-- Move webpage_activity rows off the shared "anonymous" account to no user at all (#4643). Written against
-- evolution 411, which lets user_id be empty. Run it after that deploy; before it, the UPDATE fails and changes nothing.
--
-- The app logs visits with no session as an empty user_id from 411 on, so only older rows need moving, and running
-- this twice is harmless. Each city's rows move in one statement, so a failed city changes nothing.
--
-- Per city, through sidewalk-server-tools/run-query-in-every-city.sh with -m, which sets the search_path and passes
-- the city name. Prints one row per city with how many rows moved. On the dev database, Seattle's 683k rows took 7 s.
-- =====================================================================
WITH moved AS (
  UPDATE webpage_activity
  SET user_id = NULL
  WHERE user_id = (SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = 'anonymous')
  RETURNING 1
)
SELECT :'city' AS city, COUNT(*) AS rows_moved FROM moved;
