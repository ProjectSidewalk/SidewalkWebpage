package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import com.vividsolutions.jts.geom.Point
import scala.slick.lifted.ForeignKeyQuery

case class LabelPoint(labelPointId: Int, labelId: Int, svImageX: Int, svImageY: Int, canvasX: Int, canvasY: Int,
                      heading: Float, pitch: Float, zoom: Int, canvasHeight: Int, canvasWidth: Int,
                      alphaX: Float, alphaY: Float, lat: Option[Float], lng: Option[Float], geom: Option[Point],
                      computationMethod: Option[String])

class LabelPointTable(tag: slick.lifted.Tag) extends Table[LabelPoint](tag, Some("sidewalk"), "label_point") {
  def labelPointId = column[Int]("label_point_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def svImageX = column[Int]("sv_image_x", O.NotNull)
  def svImageY = column[Int]("sv_image_y", O.NotNull)
  def canvasX = column[Int]("canvas_x", O.NotNull)
  def canvasY = column[Int]("canvas_y", O.NotNull)
  def heading = column[Float]("heading", O.NotNull)
  def pitch = column[Float]("pitch", O.NotNull)
  def zoom = column[Int]("zoom", O.NotNull)
  def canvasHeight = column[Int]("canvas_height", O.NotNull)
  def canvasWidth = column[Int]("canvas_width", O.NotNull)
  def alphaX = column[Float]("alpha_x", O.NotNull)
  def alphaY = column[Float]("alpha_y", O.NotNull)
  def lat = column[Option[Float]]("lat", O.Nullable)
  def lng = column[Option[Float]]("lng", O.Nullable)
  def geom = column[Option[Point]]("geom", O.Nullable)
  def computationMethod = column[Option[String]]("computation_method", O.Nullable)

  def * = (labelPointId, labelId, svImageX, svImageY, canvasX, canvasY, heading, pitch, zoom,
    canvasHeight, canvasWidth, alphaX, alphaY, lat, lng, geom, computationMethod) <> ((LabelPoint.apply _).tupled, LabelPoint.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_point_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

/**
 * Data access object for the label table.
 */
object LabelPointTable {
  val db = play.api.db.slick.DB
  val labelPoints = TableQuery[LabelPointTable]

  /**
    * Find a label point.
    */
  def find(labelId: Int): Option[LabelPoint] = db.withSession { implicit session =>
    val labelList = labelPoints.filter(_.labelId === labelId).list
    labelList.headOption
  }

  /**
   * Stores a label point into the label_point table.
   */
  def save(point: LabelPoint): Int = db.withTransaction { implicit session =>
    val labelPointId: Int =
      (labelPoints returning labelPoints.map(_.labelPointId)) += point
    labelPointId
  }
}
