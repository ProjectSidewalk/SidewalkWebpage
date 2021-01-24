package models.gallery

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class GalleryTaskEnvironment(galleryTaskEnvironmentId: Int, browser: Option[String],
                                browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int],
                                screenHeight: Option[Int], operatingSystem: Option[String], ipAddress: Option[String],
                                language: String)

class GalleryTaskEnvironmentTable(tag: Tag) extends Table[GalleryTaskEnvironment](tag, Some("sidewalk"), "gallery_task_environment") {
  def galleryTaskEnvironmentId = column[Int]("gallery_task_environment_id", O.PrimaryKey, O.AutoInc)
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

  def * = (galleryTaskEnvironmentId, browser, browserVersion, browserWidth, browserHeight, availWidth,
    availHeight, screenWidth, screenHeight, operatingSystem, ipAddress, language) <> ((GalleryTaskEnvironment.apply _).tupled, GalleryTaskEnvironment.unapply)
}

/**
 * Data access object for the gallery_task_environment table
 */
object GalleryTaskEnvironmentTable {
  val db = play.api.db.slick.DB
  val galleryTaskEnvironments = TableQuery[GalleryTaskEnvironmentTable]

  /**
   * Saves a new gallery task environment
   *
   * @param env
   * @return
   */
  def save(env: GalleryTaskEnvironment): Int = db.withTransaction { implicit session =>
    val galleryTaskEnvironmentId: Int =
      (galleryTaskEnvironments returning galleryTaskEnvironments.map(_.galleryTaskEnvironmentId)) += env
    galleryTaskEnvironmentId
  }
}
