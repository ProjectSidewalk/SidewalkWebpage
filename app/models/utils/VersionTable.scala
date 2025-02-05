package models.utils

import com.google.inject.ImplementedBy

import java.sql.Timestamp
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.Future

case class Version(versionId: String, versionStartTime: Timestamp, description: Option[String])

class VersionTableDef(tag: Tag) extends Table[Version](tag, "version") {
  def versionId: Rep[String] = column[String]("version_id", O.PrimaryKey)
  def versionStartTime: Rep[Timestamp] = column[Timestamp]("version_start_time")
  def description: Rep[Option[String]] = column[Option[String]]("description")

  def * = (versionId, versionStartTime, description) <> ((Version.apply _).tupled, Version.unapply)
}

@ImplementedBy(classOf[VersionTable])
trait VersionTableRepository {
  def currentVersionId(): Future[String]
  def currentVersionTimestamp(): Future[Timestamp]
}

@Singleton
class VersionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends VersionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val versions = TableQuery[VersionTableDef]

  /**
    * Returns current version ID.
    */
  def currentVersionId(): Future[String] = {
    db.run(versions.sortBy(_.versionStartTime.desc).map(_.versionId).result.head)
  }

  /**
    * Returns timestamp of most recent update.
    */
  def currentVersionTimestamp(): Future[Timestamp] = {
    db.run(versions.sortBy(_.versionStartTime.desc).map(_.versionStartTime).result.head)
  }
}
