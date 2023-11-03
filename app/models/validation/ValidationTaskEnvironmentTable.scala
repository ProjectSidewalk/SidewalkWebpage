package models.validation

import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class ValidationTaskEnvironment(validationTaskEnvironmentId: Int, missionId: Option[Int], browser: Option[String],
                                browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int],
                                screenHeight: Option[Int], operatingSystem: Option[String], ipAddress: Option[String],
                                language: String)

class ValidationTaskEnvironmentTable(tag: Tag) extends Table[ValidationTaskEnvironment](tag, "validation_task_environment") {
  def validationTaskEnvironmentId = column[Int]("validation_task_environment_id", O.PrimaryKey, O.AutoInc)
  def missionId = column[Option[Int]]("mission_id", O.Nullable)
  def browser = column[Option[String]]("browser", O.Nullable)
  def browserVersion = column[Option[String]]("browser_version", O.Nullable)
  def browserWidth = column[Option[Int]]("browser_width", O.Nullable)
  def browserHeight = column[Option[Int]]("browser_height", O.Nullable)
  def availWidth = column[Option[Int]]("avail_width", O.Nullable)
  def availHeight = column[Option[Int]]("avail_height", O.Nullable)
  def screenWidth = column[Option[Int]]("screen_width", O.Nullable)
  def screenHeight = column[Option[Int]]("screen_height", O.Nullable)
  def operatingSystem = column[Option[String]]("operating_system", O.Nullable)
  def ipAddress = column[Option[String]]("ip_address", O.Nullable)
  def language = column[String]("language", O.NotNull)

  def * = (validationTaskEnvironmentId, missionId, browser, browserVersion, browserWidth, browserHeight, availWidth,
    availHeight, screenWidth, screenHeight, operatingSystem, ipAddress, language) <> ((ValidationTaskEnvironment.apply _).tupled, ValidationTaskEnvironment.unapply)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("validation_task_environment_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
 * Data access object for the validation_task_environment table.
 */
object ValidationTaskEnvironmentTable {
  val db = play.api.db.slick.DB
  val validationTaskEnvironments = TableQuery[ValidationTaskEnvironmentTable]

  /**
   * Saves a new validation task environment.
   */
  def save(env: ValidationTaskEnvironment): Int = db.withTransaction { implicit session =>
    val validationTaskEnvironmentId: Int =
      (validationTaskEnvironments returning validationTaskEnvironments.map(_.validationTaskEnvironmentId)) += env
    validationTaskEnvironmentId
  }
}
