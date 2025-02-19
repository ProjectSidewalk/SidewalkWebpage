package models.audit

import com.google.inject.ImplementedBy
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}


case class AuditTaskEnvironment(auditTaskEnvironmentId: Int, auditTaskId: Int, missionId: Int, browser: Option[String],
                                browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int],
                                screenHeight: Option[Int], operatingSystem: Option[String], ipAddress: Option[String],
                                language: String, cssZoom: Int, timestamp: Option[OffsetDateTime])

class AuditTaskEnvironmentTableDef(tag: Tag) extends Table[AuditTaskEnvironment](tag, "audit_task_environment") {
  def auditTaskEnvironmentId: Rep[Int] = column[Int]("audit_task_environment_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId: Rep[Int] = column[Int]("audit_task_id")
  def missionId: Rep[Int] = column[Int]("mission_id")
  def browser: Rep[Option[String]] = column[Option[String]]("browser")
  def browserVersion: Rep[Option[String]] = column[Option[String]]("browser_version")
  def browserWidth: Rep[Option[Int]] = column[Option[Int]]("browser_width")
  def browserHeight: Rep[Option[Int]] = column[Option[Int]]("browser_height")
  def availWidth: Rep[Option[Int]] = column[Option[Int]]("avail_width")
  def availHeight: Rep[Option[Int]] = column[Option[Int]]("avail_height")
  def screenWidth: Rep[Option[Int]] = column[Option[Int]]("screen_width")
  def screenHeight: Rep[Option[Int]] = column[Option[Int]]("screen_height")
  def operatingSystem: Rep[Option[String]] = column[Option[String]]("operating_system")
  def ipAddress: Rep[Option[String]] = column[Option[String]]("ip_address")
  def language: Rep[String] = column[String]("language")
  def cssZoom: Rep[Int] = column[Int]("css_zoom")
  def timestamp: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("timestamp")

  def * = (auditTaskEnvironmentId, auditTaskId, missionId, browser, browserVersion, browserWidth, browserHeight,
    availWidth, availHeight, screenWidth, screenHeight, operatingSystem, ipAddress, language, cssZoom, timestamp) <> ((AuditTaskEnvironment.apply _).tupled, AuditTaskEnvironment.unapply)

//  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
//    foreignKey("audit_task_environment_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTableDef])(_.auditTaskId)
//
//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("audit_task_environment_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
}

@ImplementedBy(classOf[AuditTaskEnvironmentTable])
trait AuditTaskEnvironmentTableRepository {
  def insert(env: AuditTaskEnvironment): DBIO[Int]
}

@Singleton
class AuditTaskEnvironmentTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends AuditTaskEnvironmentTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val auditTaskEnvironments = TableQuery[AuditTaskEnvironmentTableDef]

  /**
   * Saves a new audit task environment.
   */
  def insert(env: AuditTaskEnvironment): DBIO[Int] = {
    (auditTaskEnvironments returning auditTaskEnvironments.map(_.auditTaskEnvironmentId)) += env
  }
}
