# --- !Ups
-- When, and why, the user stopped getting project news by email (#5864). Both NULL, or no row, means they still get it.
-- news_email_consented_at is when they last ticked the box themselves (Settings, or a sign-up form where it starts
-- unchecked), which is the proof of consent the EU-style rules ask for and what the never-consented backfill must not
-- override. Named for the one category it covers, since password resets are never opt-out-able. The table is shared by
-- every city, and an ALTER locks it even when the column is already there, so each city's run after the first checks
-- before taking that lock. CREATE TYPE has no IF NOT EXISTS, hence the pg_type check, and the type needs the shared
-- owner or no other city could ever alter it.
-- Semicolons inside the block are doubled to survive Play's statement splitter (see docs/evolutions.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type
                 WHERE typname = 'news_email_opt_out_source' AND typnamespace = 'sidewalk_login'::regnamespace) THEN
    CREATE TYPE sidewalk_login.news_email_opt_out_source AS ENUM (
      'settings', 'sign_up_opted_out', 'sign_up_not_opted_in', 'unsubscribe_link', 'never_consented',
      'mailing_service', 'bounce', 'complaint'
    );;
    ALTER TYPE sidewalk_login.news_email_opt_out_source OWNER TO sidewalk;;
  END IF;;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'sidewalk_login' AND table_name = 'user_settings'
                   AND column_name = 'news_email_opt_out_source') THEN
    ALTER TABLE sidewalk_login.user_settings
      ADD COLUMN IF NOT EXISTS news_email_opt_out_at TIMESTAMPTZ,
      ADD COLUMN news_email_opt_out_source sidewalk_login.news_email_opt_out_source,
      ADD CONSTRAINT user_settings_news_email_opt_out_source_matches_at_check
        CHECK ((news_email_opt_out_at IS NULL) = (news_email_opt_out_source IS NULL));;
  END IF;;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'sidewalk_login' AND table_name = 'user_settings'
                   AND column_name = 'news_email_consented_at') THEN
    ALTER TABLE sidewalk_login.user_settings ADD COLUMN news_email_consented_at TIMESTAMPTZ;;
  END IF;;
END $$;

# --- !Downs
-- partial-downs: the column is shared by every city, so the first city to roll back would drop it from under the
-- cities still on this release, and the previous release never reads it. Keeping it also keeps the opt-outs.
