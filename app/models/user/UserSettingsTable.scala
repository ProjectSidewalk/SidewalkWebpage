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
 */
case class UserSettings(
    userId: String,
    measurementSystem: Option[MeasurementSystem],
    communityService: Boolean,
    newsEmailOptOutAt: Option[OffsetDateTime],
    newsEmailOptOutSource: Option[NewsEmailOptOutSource]
)

/** An account's project-news opt-out: when it happened and why. */
case class NewsEmailOptOut(at: OffsetDateTime, source: NewsEmailOptOutSource)

class UserSettingsTableDef(tag: Tag) extends Table[UserSettings](tag, "user_settings") {
  def userId: Rep[String]                               = column[String]("user_id", O.PrimaryKey)
  def measurementSystem: Rep[Option[MeasurementSystem]] = column[Option[MeasurementSystem]]("measurement_system")
  def communityService: Rep[Boolean]                    = column[Boolean]("community_service", O.Default(false))
  def newsEmailOptOutAt: Rep[Option[OffsetDateTime]]    = column[Option[OffsetDateTime]]("news_email_opt_out_at")
  def newsEmailOptOutSource: Rep[Option[NewsEmailOptOutSource]] =
    column[Option[NewsEmailOptOutSource]]("news_email_opt_out_source")

  def * = (userId, measurementSystem, communityService, newsEmailOptOutAt, newsEmailOptOutSource).mapTo[UserSettings]

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
          news_email_opt_out_source = COALESCE(user_settings.news_email_opt_out_source, EXCLUDED.news_email_opt_out_source)
    """
  }

  /** @return The number of `user_settings` rows written: 0 when the user was already getting project news. */
  def optInToNewsEmail(userId: String): DBIO[Int] = {
    sqlu"""
      UPDATE sidewalk_login.user_settings SET news_email_opt_out_at = NULL, news_email_opt_out_source = NULL
      WHERE user_id = $userId AND news_email_opt_out_at IS NOT NULL
    """
  }

  /** @return When and why the user stopped getting project news by email, or None if they still do. */
  def getNewsEmailOptOut(userId: String): DBIO[Option[NewsEmailOptOut]] =
    userSettings
      .filter(_.userId === userId)
      .map(settings => (settings.newsEmailOptOutAt, settings.newsEmailOptOutSource))
      .result
      .headOption
      .map(_.flatMap { case (at, source) => at.zip(source).map(NewsEmailOptOut.apply.tupled) })
}
