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
    heading: Double,
    pitch: Double,
    zoom: Double,
    lat: Option[Double],
    lng: Option[Double],
    geom: Option[Point],
    computationMethod: Option[String]
)

class LabelPointTableDef(tag: slick.lifted.Tag) extends Table[LabelPoint](tag, "label_point") {
  def labelPointId: Rep[Int]                 = column[Int]("label_point_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]                      = column[Int]("label_id")
  def panoX: Rep[Int]                        = column[Int]("pano_x")
  def panoY: Rep[Int]                        = column[Int]("pano_y")
  def canvasX: Rep[Int]                      = column[Int]("canvas_x")
  def canvasY: Rep[Int]                      = column[Int]("canvas_y")
  def heading: Rep[Double]                   = column[Double]("heading")
  def pitch: Rep[Double]                     = column[Double]("pitch")
  def zoom: Rep[Double]                      = column[Double]("zoom")
  def lat: Rep[Option[Double]]               = column[Option[Double]]("lat")
  def lng: Rep[Option[Double]]               = column[Option[Double]]("lng")
  def geom: Rep[Option[Point]]               = column[Option[Point]]("geom")
  def computationMethod: Rep[Option[String]] = column[Option[String]]("computation_method")

  def * = (labelPointId, labelId, panoX, panoY, canvasX, canvasY, heading, pitch, zoom, lat, lng, geom,
    computationMethod) <> ((LabelPoint.apply _).tupled, LabelPoint.unapply)

//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("label_point_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object LabelPointTable {
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
