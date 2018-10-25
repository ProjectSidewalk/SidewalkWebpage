package models.gsv

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class GSVModel(gsvPanoramaId: String, depthMap: String, panoMap: String)

class GSVModelTable(tag: Tag) extends Table[GSVModel](tag, Some("sidewalk"), "gsv_model") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def depthMap = column[String]("depth_map")
  def panoMap = column[String]("pano_map")

  def * = (gsvPanoramaId, depthMap, panoMap) <> ((GSVModel.apply _).tupled, GSVModel.unapply)
}

object GSVModelTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val gsvModels = TableQuery[GSVModelTable]
}