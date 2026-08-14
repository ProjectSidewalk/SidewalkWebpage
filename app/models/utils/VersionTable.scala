package models.utils

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

case class Version(versionId: String, versionStartTime: OffsetDateTime, description: Option[String])

class VersionTableDef(tag: Tag) extends Table[Version](tag, "version") {
  def versionId: Rep[String] = column[String]("version_id", O.PrimaryKey)
  // DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def versionStartTime: Rep[OffsetDateTime] = column[OffsetDateTime]("version_start_time")
  def description: Rep[Option[String]]      = column[Option[String]]("description")

  def * = (versionId, versionStartTime, description) <> ((Version.apply _).tupled, Version.unapply)
}

@ImplementedBy(classOf[VersionTable])
trait VersionTableRepository {}

object VersionTable {

  /**
   * Picks the current version: latest `version_start_time`, with numeric version-id components breaking ties.
   *
   * Versions released together share one `version_start_time` (their rows are inserted by a single release evolution),
   * so the timestamp alone can't order them — without the tiebreak, which of e.g. 11.6.1 / 11.7.0 counts as "current"
   * is arbitrary.
   *
   * @param versions All rows of the version table; must be non-empty.
   * @return         The row with the latest timestamp, ties broken by highest numeric version id.
   */
  def latestVersion(versions: Seq[Version]): Version =
    versions.maxBy(v => (v.versionStartTime.toInstant.toEpochMilli, semverKey(v.versionId)))

  /** Numeric sort key for a dotted version id: "11.7.0" -> (11, 7, 0). Non-numeric/missing components sort as 0. */
  private def semverKey(versionId: String): (Int, Int, Int) = {
    val parts = versionId.split('.').map(_.toIntOption.getOrElse(0)).padTo(3, 0)
    (parts(0), parts(1), parts(2))
  }
}

@Singleton
class VersionTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
    extends VersionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val versions = TableQuery[VersionTableDef]

  /** The version to display as current — the whole table is a handful of rows, so ordering happens in Scala. */
  def currentVersion(): Future[Version] =
    db.run(versions.result).map(VersionTable.latestVersion)
}
