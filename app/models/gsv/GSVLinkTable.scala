package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVLink(gsvPanoramaId: String, targetGsvPanoramaId: String, yawDeg: Double, roadArgb: String, description: String)

class GSVLinkTable(tag: Tag) extends Table[GSVLink](tag, Some("sidewalk"), "gsv_link") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def targetGsvPanoramaId = column[String]("target_panorama_id", O.NotNull)
  def yawDeg = column[Double]("yaw_deg", O.NotNull)
  def roadArgb = column[String]("road_argb", O.NotNull)
  def description = column[String]("description", O.NotNull)

  def * = (gsvPanoramaId, targetGsvPanoramaId, yawDeg, roadArgb, description) <> ((GSVLink.apply _).tupled, GSVLink.unapply)
}

object GSVLinkTable {
  val db = play.api.db.slick.DB
  val gsvLinks = TableQuery[GSVLinkTable]

  /**
    * This method checks if the link already exists or not.
    *
    * @param panoramaId Google Street View panorama id
    */
  def linkExists(panoramaId: String, targetPanoramaId: String): Boolean = db.withTransaction { implicit session =>
    gsvLinks.filter(x => x.gsvPanoramaId === panoramaId && x.targetGsvPanoramaId === targetPanoramaId).list.nonEmpty
  }

  /**
    * Save a GSVLink object.
    *
    * @param link GSVLink object
    */
  def save(link: GSVLink): String = db.withTransaction { implicit session =>
    gsvLinks += link
    link.gsvPanoramaId
  }
}
