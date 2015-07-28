package models.audit

import java.sql.Timestamp

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class AuditTaskEnvironment(auditTaskEnvironmentId: Option[Int], auditTaskId: Int, browser: Option[String],
                                browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int],
                                screenHeight: Option[Int], operatingSystem: Option[String], ipAddress: Option[String])

/**
 *
 */
class AuditTaskEnvironmentTable(tag: Tag) extends Table[AuditTaskEnvironment](tag, Some("sidewalk"), "audit_task_environment") {
  def auditTaskEnvironmentId = column[Option[Int]]("audit_task_environment_id", O.PrimaryKey)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def browser = column[Option[String]]("browser")
  def browserVersion = column[Option[String]]("browser_version")
  def browserWidth = column[Option[Int]]("browswer_width")
  def browserHeight = column[Option[Int]]("browser_height")
  def availWidth = column[Option[Int]]("avail_width")
  def availHeight = column[Option[Int]]("avail_height")
  def screenWidth = column[Option[Int]]("screen_width")
  def screenHeight = column[Option[Int]]("screen_height")
  def operatingSystem = column[Option[String]]("operating_system")
  def ipAddress = column[Option[String]]("ip_address")

  def * = (auditTaskEnvironmentId, auditTaskId, browser, browserVersion, browserWidth, browserHeight,
    availWidth, availHeight, screenWidth, screenHeight, operatingSystem, ipAddress) <> ((AuditTaskEnvironment.apply _).tupled, AuditTaskEnvironment.unapply)
}

/**
 * Data access object for the audit_task_environment table
 */
object AuditTaskEnvironmentTable {
  val db = play.api.db.slick.DB
  val auditTaskEnvironments = TableQuery[AuditTaskEnvironmentTable]

  /**
   * Saves a new audit task environment
   *
   * Reference for getting the item that has been inserted right now.
   * http://stackoverflow.com/questions/21894377/returning-autoinc-id-after-insert-in-slick-2-0
   * @param env
   * @return
   */
  def save(env: AuditTaskEnvironment): Int = db.withTransaction { implicit session =>
    val auditTaskEnvironmentId: Option[Int] =
      (auditTaskEnvironments returning auditTaskEnvironments.map(_.auditTaskEnvironmentId)) += env
    auditTaskEnvironmentId.getOrElse(-1)
  }
}
