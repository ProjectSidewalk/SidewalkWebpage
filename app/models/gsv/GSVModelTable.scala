package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class GSVModel(gsvPanoramaId: String, depthMap: String, panoMap: String)

class GSVModelTable(tag: Tag) extends Table[GSVModel](tag, Some("sidewalk"), "gsv_model") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def depthMap = column[String]("depth_map", O.NotNull)
  def panoMap = column[String]("pano_map", O.NotNull)

  def * = (gsvPanoramaId, depthMap, panoMap) <> ((GSVModel.apply _).tupled, GSVModel.unapply)
}

object GSVModelTable {
  val db = play.api.db.slick.DB
  val gsvModels = TableQuery[GSVModelTable]
}
