package models.user

import java.sql.Timestamp
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.io.Source

case class Version(versionId: String, versionStartTime: Timestamp, description: Option[String])

class VersionTable(tag: Tag) extends Table[Version](tag, Some("sidewalk"), "version") {
  def versionId = column[String]("version_id", O.PrimaryKey)
  def versionStartTime = column[Timestamp]("version_start_time", O.NotNull)
  def description = column[Option[String]]("description")

  def * = (versionId, versionStartTime, description) <> ((Version.apply _).tupled, Version.unapply)
}

/**
  * Data access object for the version table.
  */
object VersionTable {
  val db = play.api.db.slick.DB
  val versions = TableQuery[VersionTable]

  /**
    * Returns current version ID.
    */
  def currentVersionId(): String = db.withSession { implicit session =>
    versions.sortBy(_.versionStartTime.desc).list.head.versionId
  }

  /**
    * Returns timestamp of most recent update.
    */
  def currentVersionTimestamp(): String = db.withSession { implicit session =>
    versions.sortBy(_.versionStartTime.desc).list.head.versionStartTime.toString
  }

  /**
    * Read in Google Maps API key from google_maps_api_key.txt (ask Mikey Saugstad for the file if you don't have it).
    */
  def getGoogleMapsAPIKey(): String = {
    val bufferedSource = Source.fromFile("google_maps_api_key.txt")
    val lines = bufferedSource.getLines()
    val key: String = lines.next()
    bufferedSource.close
    key
  }
}
