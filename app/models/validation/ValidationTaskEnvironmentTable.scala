package models.validation

import com.google.inject.ImplementedBy
import models.mission.{Mission, MissionTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}


case class ValidationTaskEnvironment(validationTaskEnvironmentId: Int, missionId: Option[Int], browser: Option[String],
                                browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int],
                                screenHeight: Option[Int], operatingSystem: Option[String], ipAddress: Option[String],
                                language: String, cssZoom: Int, timestamp: Option[OffsetDateTime])

class ValidationTaskEnvironmentTableDef(tag: Tag) extends Table[ValidationTaskEnvironment](tag, "validation_task_environment") {
  def validationTaskEnvironmentId: Rep[Int] = column[Int]("validation_task_environment_id", O.PrimaryKey, O.AutoInc)
  def missionId: Rep[Option[Int]] = column[Option[Int]]("mission_id")
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

  def * = (validationTaskEnvironmentId, missionId, browser, browserVersion, browserWidth, browserHeight, availWidth,
    availHeight, screenWidth, screenHeight, operatingSystem, ipAddress, language, cssZoom, timestamp) <> ((ValidationTaskEnvironment.apply _).tupled, ValidationTaskEnvironment.unapply)

//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("validation_task_environment_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
}

@ImplementedBy(classOf[ValidationTaskEnvironmentTable])
trait ValidationTaskEnvironmentTableRepository {
  def insert(env: ValidationTaskEnvironment): DBIO[Int]
}

@Singleton
class ValidationTaskEnvironmentTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends ValidationTaskEnvironmentTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val validationTaskEnvironments = TableQuery[ValidationTaskEnvironmentTableDef]

  def insert(env: ValidationTaskEnvironment): DBIO[Int] = {
      (validationTaskEnvironments returning validationTaskEnvironments.map(_.validationTaskEnvironmentId)) += env
  }
}
