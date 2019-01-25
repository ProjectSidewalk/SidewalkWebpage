package models.gsv

import models.utils.MyPostgresDriver.api._

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

case class GSVData(gsvPanoramaId: String, imageWidth: Int, imageHeight: Int, tileWidth: Int, tileHeight: Int,
  imageDate: String, imageryType: Int, copyright: String)

class GSVDataTable(tag: Tag) extends Table[GSVData](tag, Some("sidewalk"), "gsv_data") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def imageWidth = column[Int]("image_width")
  def imageHeight = column[Int]("image_height")
  def tileWidth = column[Int]("tile_width")
  def tileHeight = column[Int]("tile_height")
  def imageDate = column[String]("image_date")
  def imageryType = column[Int]("imagery_type")
  def copyright = column[String]("copyright")

  def * = (gsvPanoramaId, imageWidth, imageHeight, tileWidth, tileHeight, imageDate, imageryType, copyright) <>
    ((GSVData.apply _).tupled, GSVData.unapply)
}

object GSVDataTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val gsvDataRecords = TableQuery[GSVDataTable]

  /**
   * This method checks if the given panorama id already exists in the table
   * @param panoramaId Google Street View panorama Id
   * @return
   */
  def panoramaExists(panoramaId: String): Future[Boolean] = db.run(
    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).result.headOption).map(_.isDefined)

  def save(data: GSVData): Future[String] = db.run(
    ((gsvDataRecords returning gsvDataRecords.map(_.gsvPanoramaId)) += data).transactionally)

}
