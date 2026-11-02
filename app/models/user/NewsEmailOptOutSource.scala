package models.user

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * Why an account stopped getting project news by email (#5864), stored as `news_email_opt_out_source` in
 * `user_settings` beside when it happened. Settings and the unsubscribe link are the user's own choice. The two
 * sign-up values split a box turned off from one left off where it starts unchecked. `NeverConsented` is the
 * backfill for older accounts from consent-law countries. The last three will come from the mailing service: its own
 * unsubscribe link, a bounced address, and a spam report, which must never be re-mailed.
 */
enum NewsEmailOptOutSource(val name: String) extends NamedEnum {
  case Settings         extends NewsEmailOptOutSource("settings")
  case SignUpOptedOut   extends NewsEmailOptOutSource("sign_up_opted_out")
  case SignUpNotOptedIn extends NewsEmailOptOutSource("sign_up_not_opted_in")
  case UnsubscribeLink  extends NewsEmailOptOutSource("unsubscribe_link")
  case NeverConsented   extends NewsEmailOptOutSource("never_consented")
  case MailingService   extends NewsEmailOptOutSource("mailing_service")
  case Bounce           extends NewsEmailOptOutSource("bounce")
  case Complaint        extends NewsEmailOptOutSource("complaint")
}

object NewsEmailOptOutSource extends PgEnumCompanion[NewsEmailOptOutSource]("news_email_opt_out_source")
