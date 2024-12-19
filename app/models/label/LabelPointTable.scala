package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current
import com.vividsolutions.jts.geom.Point
import models.utils.MyPostgresDriver

import javax.inject.{Inject, Singleton}


case class LabelPoint(labelPointId: Int, labelId: Int, panoX: Int, panoY: Int, canvasX: Int, canvasY: Int,
                      heading: Float, pitch: Float, zoom: Int, lat: Option[Float], lng: Option[Float],
                      geom: Option[Point], computationMethod: Option[String])

class LabelPointTableDef(tag: slick.lifted.Tag) extends Table[LabelPoint](tag, "label_point") {
  def labelPointId: Rep[Int] = column[Int]("label_point_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int] = column[Int]("label_id")
  def panoX: Rep[Int] = column[Int]("pano_x")
  def panoY: Rep[Int] = column[Int]("pano_y")
  def canvasX: Rep[Int] = column[Int]("canvas_x")
  def canvasY: Rep[Int] = column[Int]("canvas_y")
  def heading: Rep[Float] = column[Float]("heading")
  def pitch: Rep[Float] = column[Float]("pitch")
  def zoom: Rep[Int] = column[Int]("zoom")
  def lat: Rep[Option[Float]] = column[Option[Float]]("lat")
  def lng: Rep[Option[Float]] = column[Option[Float]]("lng")
  def geom: Rep[Option[Point]] = column[Option[Point]]("geom")
  def computationMethod: Rep[Option[String]] = column[Option[String]]("computation_method")

  def * = (labelPointId, labelId, panoX, panoY, canvasX, canvasY, heading, pitch, zoom,
    lat, lng, geom, computationMethod) <> ((LabelPoint.apply _).tupled, LabelPoint.unapply)

//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("label_point_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
}

@ImplementedBy(classOf[LabelPointTable])
trait LabelPointTableRepository {
  def insert(point: LabelPoint): DBIO[Int]
}

@Singleton
class LabelPointTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends LabelPointTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val labelPoints = TableQuery[LabelPointTableDef]

  // Some constants that used to be in this table in the database.
  val canvasHeight: Int = 480
  val canvasWidth: Int = 720
  val alphaX: Float = 4.6F
  val alphaY: Float = -4.65F

  /**
    * Find a label point.
    */
//  def find(labelId: Int): Option[LabelPoint] = {
//    val labelList: List[LabelPoint] = labelPoints.filter(_.labelId === labelId).list
//    labelList.headOption
//  }

  def insert(point: LabelPoint): DBIO[Int] = {
    (labelPoints returning labelPoints.map(_.labelPointId)) += point
  }
}
