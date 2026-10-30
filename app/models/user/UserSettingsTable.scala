package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.{given, *}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.*
import scala.concurrent.ExecutionContext

/**
 * @param measurementSystem     The units the user chose, or None to follow the site language.
 * @param communityService      Whether the user is tracking their time for community service hours.
 * @param newsEmailOptOutAt     When the user stopped getting project news by email (#5864), or None if they still do.
 * @param newsEmailOptOutSource Why, set exactly when `newsEmailOptOutAt` is (a CHECK enforces it).
 * @param newsEmailConsentedAt  When the user last ticked the news box themselves, the proof of consent; None if never.
 */
case class UserSettings(
    userId: String,
    measurementSystem: Option[MeasurementSystem],
    communityService: Boolean,
    newsEmailOptOutAt: Option[OffsetDateTime],
    newsEmailOptOutSource: Option[NewsEmailOptOutSource],
    newsEmailConsentedAt: Option[OffsetDateTime]
)

/** An account's project-news opt-out: when it happened and why. */
case class NewsEmailOptOut(at: OffsetDateTime, source: NewsEmailOptOutSource)

/** Where an account stands on project news: opted out (and why), and when they last consented, if ever. */
case class NewsEmailStatus(optOut: Option[NewsEmailOptOut], consentedAt: Option[OffsetDateTime])

class UserSettingsTableDef(tag: Tag) extends Table[UserSettings](tag, "user_settings") {
  def userId: Rep[String]                               = column[String]("user_id", O.PrimaryKey)
  def measurementSystem: Rep[Option[MeasurementSystem]] = column[Option[MeasurementSystem]]("measurement_system")
  def communityService: Rep[Boolean]                    = column[Boolean]("community_service", O.Default(false))
  def newsEmailOptOutAt: Rep[Option[OffsetDateTime]]    = column[Option[OffsetDateTime]]("news_email_opt_out_at")
  def newsEmailOptOutSource: Rep[Option[NewsEmailOptOutSource]] =
    column[Option[NewsEmailOptOutSource]]("news_email_opt_out_source")
  def newsEmailConsentedAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("news_email_consented_at")

  def * = (userId, measurementSystem, communityService, newsEmailOptOutAt, newsEmailOptOutSource, newsEmailConsentedAt)
    .mapTo[UserSettings]

  def user = foreignKey("user_settings_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
}

@ImplementedBy(classOf[UserSettingsTable])
trait UserSettingsTableRepository {}

/**
 * Choices a user makes on the Settings page that belong to their account rather than to one city (#3720). The table
 * lives in the shared `sidewalk_login` schema, so a choice made in one city applies in every city.
 *
 * A row is only written once the user changes something; a missing row means every setting is at its default.
 */
@Singleton
class UserSettingsTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(using ec: ExecutionContext)
    extends UserSettingsTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userSettings = TableQuery[UserSettingsTableDef]

  /**
   * Saves the user's units choice without touching their other settings.
   *
   * @param userId The user making the choice.
   * @param system The units to show distances in, or None to follow the site language.
   * @return       The number of rows written.
   */
  def setMeasurementSystem(userId: String, system: Option[MeasurementSystem]): DBIO[Int] = {
    sqlu"""
      INSERT INTO sidewalk_login.user_settings (user_id, measurement_system)
      VALUES ($userId, $system)
      ON CONFLICT (user_id) DO UPDATE SET measurement_system = EXCLUDED.measurement_system
    """
  }

  /**
   * Turns community service hour tracking on or off without touching the user's other settings.
   *
   * @param userId  The user making the choice.
   * @param enabled Whether they're tracking their time for community service hours.
   * @return        The number of `user_settings` rows written.
   */
  def setCommunityService(userId: String, enabled: Boolean): DBIO[Int] = {
    sqlu"""
      INSERT INTO sidewalk_login.user_settings (user_id, community_service)
      VALUES ($userId, $enabled)
      ON CONFLICT (user_id) DO UPDATE SET community_service = EXCLUDED.community_service
    """
  }

  /**
   * Opts the user out of project news by email without touching their other settings (#5864). A repeat opt-out
   * (Settings box, then newsletter link) keeps the first time and reason rather than looking more recent.
   * @return The number of `user_settings` rows written.
   */
  def optOutOfNewsEmail(userId: String, source: NewsEmailOptOutSource): DBIO[Int] = {
    sqlu"""
      INSERT INTO sidewalk_login.user_settings (user_id, news_email_opt_out_at, news_email_opt_out_source)
      VALUES ($userId, now(), $source)
      ON CONFLICT (user_id) DO UPDATE
      SET news_email_opt_out_at     = COALESCE(user_settings.news_email_opt_out_at, EXCLUDED.news_email_opt_out_at),
          news_email_opt_out_source =
            COALESCE(user_settings.news_email_opt_out_source, EXCLUDED.news_email_opt_out_source)
    """
  }

  /**
   * Records that the user ticked the news box themselves, which both subscribes them and is the proof of consent the
   * never-consented backfill must leave alone. The latest tick is kept, being the one any question would be about.
   * @return The number of `user_settings` rows written.
   */
  def consentToNewsEmail(userId: String): DBIO[Int] = {
    sqlu"""
      INSERT INTO sidewalk_login.user_settings (user_id, news_email_consented_at)
      VALUES ($userId, now())
      ON CONFLICT (user_id) DO UPDATE
      SET news_email_consented_at = EXCLUDED.news_email_consented_at,
          news_email_opt_out_at = NULL, news_email_opt_out_source = NULL
    """
  }

  /** @return Where the user stands on project news by email; all None for a user with no settings row. */
  def getNewsEmailStatus(userId: String): DBIO[NewsEmailStatus] =
    userSettings
      .filter(_.userId === userId)
      .map(settings => (settings.newsEmailOptOutAt, settings.newsEmailOptOutSource, settings.newsEmailConsentedAt))
      .result
      .headOption
      .map {
        case Some((at, source, consentedAt)) =>
          NewsEmailStatus(at.zip(source).map(NewsEmailOptOut.apply.tupled), consentedAt)
        case None => NewsEmailStatus(None, None)
      }
}
