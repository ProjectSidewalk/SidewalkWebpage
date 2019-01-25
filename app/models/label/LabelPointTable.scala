package models.label

import models.utils.MyPostgresDriver.api._
import com.vividsolutions.jts.geom.Point

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class LabelPoint(labelPointId: Int, labelId: Int, svImageX: Int, svImageY: Int, canvasX: Int, canvasY: Int,
  heading: Float, pitch: Float, zoom: Int, canvasHeight: Int, canvasWidth: Int,
  alphaX: Float, alphaY: Float, lat: Option[Float], lng: Option[Float], geom: Option[Point])

/**
 *
 */
class LabelPointTable(tag: slick.lifted.Tag) extends Table[LabelPoint](tag, Some("sidewalk"), "label_point") {
  def labelPointId = column[Int]("label_point_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id")
  def svImageX = column[Int]("sv_image_x")
  def svImageY = column[Int]("sv_image_y")
  def canvasX = column[Int]("canvas_x")
  def canvasY = column[Int]("canvas_y")
  def heading = column[Float]("heading")
  def pitch = column[Float]("pitch")
  def zoom = column[Int]("zoom")
  def canvasHeight = column[Int]("canvas_height")
  def canvasWidth = column[Int]("canvas_width")
  def alphaX = column[Float]("alpha_x")
  def alphaY = column[Float]("alpha_y")
  def lat = column[Option[Float]]("lat")
  def lng = column[Option[Float]]("lng")
  def geom = column[Option[Point]]("geom")

  def * = (labelPointId, labelId, svImageX, svImageY, canvasX, canvasY, heading, pitch, zoom,
    canvasHeight, canvasWidth, alphaX, alphaY, lat, lng, geom) <> ((LabelPoint.apply _).tupled, LabelPoint.unapply)

  def label = foreignKey("label_point_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

}

/**
 * Data access object for the label table
 */
object LabelPointTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val labelPoints = TableQuery[LabelPointTable]

  /**
   * Find a label point
   *
   * @param labelId
   * @return
   */
  def find(labelId: Int): Future[Option[LabelPoint]] = {
    db.run(labelPoints.filter(_.labelId === labelId).result.headOption)
  }

  /**
   * Stores a label point into the label_point table
   * @param point
   * @return
   */
  def save(point: LabelPoint): Future[Int] = db.run(
    ((labelPoints returning labelPoints.map(_.labelPointId)) += point).transactionally)

  /**
   * Todo. I need to
   * SELECT label_point_id, ST_SetSRID(ST_Point(lng, lat),4326) from sidewalk.label_point
   */
}