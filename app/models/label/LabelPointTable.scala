package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import com.vividsolutions.jts.geom.Point
import scala.slick.lifted.ForeignKeyQuery

case class LabelPoint(labelPointId: Int, labelId: Int, panoX: Int, panoY: Int, canvasX: Int, canvasY: Int,
                      heading: Float, pitch: Float, zoom: Int, lat: Option[Float], lng: Option[Float],
                      geom: Option[Point], computationMethod: Option[String])

class LabelPointTable(tag: slick.lifted.Tag) extends Table[LabelPoint](tag, Some("sidewalk"), "label_point") {
  def labelPointId = column[Int]("label_point_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def panoX = column[Int]("pano_x", O.NotNull)
  def panoY = column[Int]("pano_y", O.NotNull)
  def canvasX = column[Int]("canvas_x", O.NotNull)
  def canvasY = column[Int]("canvas_y", O.NotNull)
  def heading = column[Float]("heading", O.NotNull)
  def pitch = column[Float]("pitch", O.NotNull)
  def zoom = column[Int]("zoom", O.NotNull)
  def lat = column[Option[Float]]("lat", O.Nullable)
  def lng = column[Option[Float]]("lng", O.Nullable)
  def geom = column[Option[Point]]("geom", O.Nullable)
  def computationMethod = column[Option[String]]("computation_method", O.Nullable)

  def * = (labelPointId, labelId, panoX, panoY, canvasX, canvasY, heading, pitch, zoom,
    lat, lng, geom, computationMethod) <> ((LabelPoint.apply _).tupled, LabelPoint.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_point_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

/**
 * Data access object for the label table.
 */
object LabelPointTable {
  val db = play.api.db.slick.DB
  val labelPoints = TableQuery[LabelPointTable]

  // Some constants that used to be in this table in the database.
  val canvasHeight: Int = 480
  val canvasWidth: Int = 720
  val alphaX: Float = 4.6F
  val alphaY: Float = -4.65F

  /**
    * Find a label point.
    */
  def find(labelId: Int): Option[LabelPoint] = db.withSession { implicit session =>
    val labelList: List[LabelPoint] = labelPoints.filter(_.labelId === labelId).list
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
