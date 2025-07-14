package models.utils

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.Future

case class Version(versionId: String, versionStartTime: OffsetDateTime, description: Option[String])

class VersionTableDef(tag: Tag) extends Table[Version](tag, "version") {
  def versionId: Rep[String]                = column[String]("version_id", O.PrimaryKey)
  def versionStartTime: Rep[OffsetDateTime] = column[OffsetDateTime]("version_start_time")
  def description: Rep[Option[String]]      = column[Option[String]]("description")

  def * = (versionId, versionStartTime, description) <> ((Version.apply _).tupled, Version.unapply)
}

@ImplementedBy(classOf[VersionTable])
trait VersionTableRepository {}

@Singleton
class VersionTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends VersionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val versions = TableQuery[VersionTableDef]

  def currentVersion(): Future[Version] = {
    db.run(versions.sortBy(_.versionStartTime.desc).result.head)
  }
}
