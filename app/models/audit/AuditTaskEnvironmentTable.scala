package models.audit

import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class AuditTaskEnvironment(auditTaskEnvironmentId: Int, auditTaskId: Int, missionId: Int, browser: Option[String],
                                browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int],
                                screenHeight: Option[Int], operatingSystem: Option[String], ipAddress: Option[String],
                                language: String)

class AuditTaskEnvironmentTable(tag: Tag) extends Table[AuditTaskEnvironment](tag, Some("sidewalk"), "audit_task_environment") {
  def auditTaskEnvironmentId = column[Int]("audit_task_environment_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
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

  def * = (auditTaskEnvironmentId, auditTaskId, missionId, browser, browserVersion, browserWidth, browserHeight,
    availWidth, availHeight, screenWidth, screenHeight, operatingSystem, ipAddress, language) <> ((AuditTaskEnvironment.apply _).tupled, AuditTaskEnvironment.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("audit_task_environment_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("audit_task_environment_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
 * Data access object for the audit_task_environment table.
 */
object AuditTaskEnvironmentTable {
  val db = play.api.db.slick.DB
  val auditTaskEnvironments = TableQuery[AuditTaskEnvironmentTable]

  /**
   * Saves a new audit task environment.
   */
  def save(env: AuditTaskEnvironment): Int = db.withTransaction { implicit session =>
    val auditTaskEnvironmentId: Int =
      (auditTaskEnvironments returning auditTaskEnvironments.map(_.auditTaskEnvironmentId)) += env
    auditTaskEnvironmentId
  }
}
