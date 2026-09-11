package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._

/**
 * @param measurementSystem The units the user chose, or None to follow the site language.
 * @param communityService  Whether the user is tracking their time for community service hours.
 */
case class UserSettings(userId: String, measurementSystem: Option[MeasurementSystem.Value], communityService: Boolean)

class UserSettingsTableDef(tag: Tag) extends Table[UserSettings](tag, "user_settings") {
  def userId: Rep[String]                                     = column[String]("user_id", O.PrimaryKey)
  def measurementSystem: Rep[Option[MeasurementSystem.Value]] =
    column[Option[MeasurementSystem.Value]]("measurement_system")
  def communityService: Rep[Boolean] = column[Boolean]("community_service", O.Default(false))

  def * = (userId, measurementSystem, communityService) <> ((UserSettings.apply _).tupled, UserSettings.unapply)

  def user = foreignKey("user_settings_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
}

@ImplementedBy(classOf[UserSettingsTable])
trait UserSettingsTableRepository {}

/**
 * Choices a user makes on the Settings page that belong to their account rather than to one city (#3720). The table
 * lives in the shared `sidewalk_login` schema, so a choice made in one city applies in every city.
 *
 * A row is only written once the user changes something, so most accounts (nearly all of them anonymous) have none,
 * and a missing row means every setting is at its default.
 */
@Singleton
class UserSettingsTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
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
  def setMeasurementSystem(userId: String, system: Option[MeasurementSystem.Value]): DBIO[Int] = {
    val systemName: Option[String] = system.map(_.toString)
    sqlu"""
      INSERT INTO sidewalk_login.user_settings (user_id, measurement_system)
      VALUES ($userId, $systemName::sidewalk_login.measurement_system)
      ON CONFLICT (user_id) DO UPDATE SET measurement_system = EXCLUDED.measurement_system
    """
  }

  /**
   * Turns community service hour tracking on or off without touching the user's other settings.
   *
   * Also written to `user_role.community_service` until #5306 drops that column. Prod restarts cities one at a time,
   * so a city still on the previous release reads that column, and each city's run of evolution 385 syncs
   * `user_settings` from it.
   *
   * @param userId  The user making the choice.
   * @param enabled Whether they're tracking their time for community service hours.
   * @return        The number of `user_settings` rows written.
   */
  def setCommunityService(userId: String, enabled: Boolean): DBIO[Int] = {
    val saveSetting = sqlu"""
      INSERT INTO sidewalk_login.user_settings (user_id, community_service)
      VALUES ($userId, $enabled)
      ON CONFLICT (user_id) DO UPDATE SET community_service = EXCLUDED.community_service
    """
    val saveToUserRole = sqlu"UPDATE sidewalk_login.user_role SET community_service = $enabled WHERE user_id = $userId"
    saveToUserRole.andThen(saveSetting).transactionally
  }
}
