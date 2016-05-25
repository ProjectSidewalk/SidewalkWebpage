package models.gsv

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class GSVData(gsvPanoramaId: String, imageWidth: Int, imageHeight: Int, tileWidth: Int, tileHeight: Int,
                   imageDate: String, imageryType: Int, copyright: String)

class GSVDataTable(tag: Tag) extends Table[GSVData](tag, Some("sidewalk"), "gsv_data") {
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.PrimaryKey)
  def imageWidth = column[Int]("image_width", O.NotNull)
  def imageHeight = column[Int]("image_height", O.NotNull)
  def tileWidth = column[Int]("tile_width", O.NotNull)
  def tileHeight = column[Int]("tile_height", O.NotNull)
  def imageDate = column[String]("image_date", O.NotNull)
  def imageryType = column[Int]("imagery_type", O.NotNull)
  def copyright = column[String]("copyright", O.NotNull)

  def * = (gsvPanoramaId, imageWidth, imageHeight, tileWidth, tileHeight, imageDate, imageryType, copyright) <>
    ((GSVData.apply _).tupled, GSVData.unapply)
}

object GSVDataTable {
  val db = play.api.db.slick.DB
  val gsvDataRecords = TableQuery[GSVDataTable]

  /**
    * This method checks if the given panorama id already exists in the table
    * @param panoramaId Google Street View panorama Id
    * @return
    */
  def panoramaExists(panoramaId: String): Boolean = db.withTransaction { implicit session =>
    gsvDataRecords.filter(_.gsvPanoramaId === panoramaId).list.nonEmpty
  }

  def save(data: GSVData): String = db.withTransaction { implicit session =>
    gsvDataRecords += data
    data.gsvPanoramaId
  }

}
