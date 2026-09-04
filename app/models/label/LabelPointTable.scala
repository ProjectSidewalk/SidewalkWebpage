package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.Point
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class LabelPoint(
    labelPointId: Int,
    labelId: Int,
    panoX: Int,
    panoY: Int,
    canvasX: Int,
    canvasY: Int,
    canvasWidth: Int,
    canvasHeight: Int,
    heading: Double,
    pitch: Double,
    zoom: Double,
    lat: Option[Double],
    lng: Option[Double],
    geom: Option[Point],
    computationMethod: Option[ComputationMethod.Value]
)

class LabelPointTableDef(tag: slick.lifted.Tag) extends Table[LabelPoint](tag, "label_point") {
  def labelPointId: Rep[Int] = column[Int]("label_point_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]      = column[Int]("label_id")
  def panoX: Rep[Int]        = column[Int]("pano_x")
  def panoY: Rep[Int]        = column[Int]("pano_y")
  def canvasX: Rep[Int]      = column[Int]("canvas_x")
  def canvasY: Rep[Int]      = column[Int]("canvas_y")
  // The frame canvasX/canvasY are expressed in (#5085). DEFAULT 720/480 covers rows that predate evolution 374; a
  // CHECK keeps both positive.
  def canvasWidth: Rep[Int]    = column[Int]("canvas_width", O.Default(LabelPointTable.canvasWidth))
  def canvasHeight: Rep[Int]   = column[Int]("canvas_height", O.Default(LabelPointTable.canvasHeight))
  def heading: Rep[Double]     = column[Double]("heading")
  def pitch: Rep[Double]       = column[Double]("pitch")
  def zoom: Rep[Double]        = column[Double]("zoom")
  def lat: Rep[Option[Double]] = column[Option[Double]]("lat")
  def lng: Rep[Option[Double]] = column[Option[Double]]("lng")
  def geom: Rep[Option[Point]] = column[Option[Point]]("geom")
  def computationMethod: Rep[Option[ComputationMethod.Value]] =
    column[Option[ComputationMethod.Value]]("computation_method")

  def * = (labelPointId, labelId, panoX, panoY, canvasX, canvasY, canvasWidth, canvasHeight, heading, pitch, zoom, lat,
    lng, geom, computationMethod) <> ((LabelPoint.apply _).tupled, LabelPoint.unapply)

  def label       = foreignKey("label_point_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def labelUnique = index("label_point_label_id_key", labelId, unique = true)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object LabelPointTable {

  /**
   * The boxed Explore frame, 720x480 logical px: the frame of every label stored before evolution 374, of AI labels
   * (never drawn on a canvas, so their canvas_x/canvas_y are this frame's center), and the fallback when a client
   * omits the frame. A human label's own frame is `LabelPoint.canvasWidth/canvasHeight`, never these (#5085).
   */
  val canvasHeight: Int = 480
  val canvasWidth: Int  = 720
}

@ImplementedBy(classOf[LabelPointTable])
trait LabelPointTableRepository {}

@Singleton
class LabelPointTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends LabelPointTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelPoints = TableQuery[LabelPointTableDef]

  def insert(point: LabelPoint): DBIO[Int] = {
    (labelPoints returning labelPoints.map(_.labelPointId)) += point
  }
}
