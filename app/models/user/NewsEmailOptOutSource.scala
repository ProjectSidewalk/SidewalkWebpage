package models.user

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * Why an account stopped getting project news by email (#5864), stored as the `news_email_opt_out_source` enum in
 * `user_settings` beside the time it happened. Settings and the unsubscribe link are the user's own choice. The two
 * sign-up values tell an active decline (the box started checked and was turned off) from passive non-consent (it
 * started unchecked, as it does where email law needs consent, and was left so). `NeverConsented` is the backfill for
 * accounts from before the box existed that signed up where consent is needed. The last three come from the mailing
 * service: its own unsubscribe link, an address that bounced, and a spam report, which must never be re-mailed.
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
