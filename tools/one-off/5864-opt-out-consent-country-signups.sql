-- =====================================================================
-- Opt existing accounts out of project news when they signed up in a country whose email law needs consent for a
-- newsletter (#5864). Written against evolution 426.
--
-- Everyone was opted in by default when the setting arrived, which the EU, Swiss, Canadian, NZ, Brazilian, Ecuadorian
-- and Chilean rules don't allow (see news-email-opt-out-countries in conf/application.conf). For each account this
-- takes its EARLIEST SignUp row across every city (accounts were merged when cities stopped having their own logins,
-- so some have several) and, when that city's schema is in the list below, stamps news_email_opt_out_at with the
-- sign-up time and the source never_consented, keeping an existing earlier stamp and its reason. Those users then see the Settings box unchecked, and ticking it is
-- the consent we never had. The schema list is every city whose country is NOT in news-email-opt-out-countries.
--
-- Looks across every city schema by itself, so run it ONCE: -m -c "seattle" through
-- sidewalk-server-tools/run-query-in-every-city.sh, whose read-only connections are why the SET below is here.
--
-- DRY RUN BY DEFAULT: prints how many accounts each city would opt out and writes nothing. To write, send the runner
-- a copy with `\set apply 1` in place of `\set apply 0`. SAFE TO RE-RUN. webpage_activity has no index on activity,
-- so this scans each city's table once: under a second for the dev database's 27 schemas.
-- =====================================================================
SET default_transaction_read_only = off;
\set QUIET on
\if :{?apply}
\else
  \set apply 0
\endif

CREATE TEMP TABLE sign_up_by_city (user_id TEXT, city_schema TEXT, signed_up_at TIMESTAMPTZ);

DO $$
DECLARE
  city_schema TEXT;
BEGIN
  FOR city_schema IN
    SELECT table_schema FROM information_schema.tables
    WHERE table_name = 'webpage_activity' AND table_schema LIKE 'sidewalk\_%'
    ORDER BY table_schema
  LOOP
    EXECUTE format(
      'INSERT INTO sign_up_by_city
       SELECT user_id, %1$L, MIN(timestamp) FROM %1$I.webpage_activity
       WHERE activity = ''SignUp'' AND user_id IS NOT NULL GROUP BY user_id',
      city_schema);
  END LOOP;
END $$;

-- Each account's first sign-up anywhere, then only those whose first city needs consent and who still exist.
CREATE TEMP TABLE to_opt_out AS
SELECT first_sign_up.user_id, first_sign_up.city_schema, first_sign_up.signed_up_at
FROM (
  SELECT DISTINCT ON (user_id) user_id, city_schema, signed_up_at
  FROM sign_up_by_city
  ORDER BY user_id, signed_up_at
) AS first_sign_up
INNER JOIN sidewalk_login.sidewalk_user ON sidewalk_user.user_id = first_sign_up.user_id
WHERE first_sign_up.city_schema IN (
  'sidewalk_amsterdam', 'sidewalk_bayonne_fr', 'sidewalk_zurich', 'sidewalk_zurich_infra3d',
  'sidewalk_winterthur_infra3d', 'sidewalk_burnaby', 'sidewalk_auckland', 'sidewalk_sao_paulo', 'sidewalk_cuenca',
  'sidewalk_rancagua', 'sidewalk_santiago'
);

\set QUIET off
SELECT city_schema, accounts_to_opt_out
FROM (
  SELECT city_schema, COUNT(*) AS accounts_to_opt_out, 0 AS sort_last FROM to_opt_out GROUP BY city_schema
  UNION ALL
  SELECT 'TOTAL', COUNT(*), 1 FROM to_opt_out
) AS summary
ORDER BY sort_last, city_schema;

\if :apply
  INSERT INTO sidewalk_login.user_settings (user_id, news_email_opt_out_at, news_email_opt_out_source)
  SELECT user_id, signed_up_at, 'never_consented' FROM to_opt_out
  ON CONFLICT (user_id) DO UPDATE
  SET news_email_opt_out_at     = LEAST(user_settings.news_email_opt_out_at, EXCLUDED.news_email_opt_out_at),
      news_email_opt_out_source = CASE
        WHEN user_settings.news_email_opt_out_at <= EXCLUDED.news_email_opt_out_at
          THEN user_settings.news_email_opt_out_source
        ELSE EXCLUDED.news_email_opt_out_source END;
\else
  \echo 'Dry run: nothing written. Re-run with \set apply 1 to opt these accounts out.'
\endif
