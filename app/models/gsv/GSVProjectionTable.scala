package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVProjection(gsvPanoramaId: String, projectionType: String, panoYawDeg: Double, tiltYawDeg: Double, tiltPitchDeg: Double)

class GSVProjectionTable(tag: Tag) extends Table[GSVProjection](tag, Some("sidewalk"), "gsv_projection") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def projectionType = column[String]("projection_type", O.NotNull)
  def panoYawDeg = column[Double]("pano_yaw_deg", O.NotNull)
  def tiltYawDeg = column[Double]("tilt_yaw_deg", O.NotNull)
  def tiltPitchDeg = column[Double]("tilt_pitch_deg", O.NotNull)

  def * = (gsvPanoramaId, projectionType, panoYawDeg, tiltYawDeg, tiltPitchDeg) <> ((GSVProjection.apply _).tupled, GSVProjection.unapply)
}

object GSVProjectionTable {
  val db = play.api.db.slick.DB
  val gsvProjections = TableQuery[GSVProjectionTable]
}
