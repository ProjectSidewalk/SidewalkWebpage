package models.audit

import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class AuditTaskEnvironment(auditTaskEnvironmentId: Int, auditTaskId: Int, missionId: Int, browser: Option[String],
                                browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int],
                                screenHeight: Option[Int], operatingSystem: Option[String], ipAddress: Option[String])

/**
 *
 */
class AuditTaskEnvironmentTable(tag: Tag) extends Table[AuditTaskEnvironment](tag, Some("sidewalk"), "audit_task_environment") {
  def auditTaskEnvironmentId = column[Int]("audit_task_environment_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id")
  def missionId = column[Int]("mission_id")
  def browser = column[Option[String]]("browser")
  def browserVersion = column[Option[String]]("browser_version")
  def browserWidth = column[Option[Int]]("browser_width")
  def browserHeight = column[Option[Int]]("browser_height")
  def availWidth = column[Option[Int]]("avail_width")
  def availHeight = column[Option[Int]]("avail_height")
  def screenWidth = column[Option[Int]]("screen_width")
  def screenHeight = column[Option[Int]]("screen_height")
  def operatingSystem = column[Option[String]]("operating_system")
  def ipAddress = column[Option[String]]("ip_address")

  def * = (auditTaskEnvironmentId, auditTaskId, missionId, browser, browserVersion, browserWidth, browserHeight,
    availWidth, availHeight, screenWidth, screenHeight, operatingSystem, ipAddress) <> ((AuditTaskEnvironment.apply _).tupled, AuditTaskEnvironment.unapply)

  def auditTask = foreignKey("audit_task_environment_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission = foreignKey("audit_task_environment_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)
}

/**
 * Data access object for the audit_task_environment table
 */
object AuditTaskEnvironmentTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val auditTaskEnvironments = TableQuery[AuditTaskEnvironmentTable]

  /**
   * Saves a new audit task environment
   *
   * @param env
   * @return
   */
  def save(env: AuditTaskEnvironment): Future[Int] = db.run {
    (auditTaskEnvironments returning auditTaskEnvironments.map(_.auditTaskEnvironmentId)) += env
  }
}
