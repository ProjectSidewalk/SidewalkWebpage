package models.gt

/**
  * Created by hmaddali on 7/26/17.
  */
import models.route.{Route, RouteTable}
import models.label.{LabelTypeTable, LabelType}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class GTLabel(gtLabelId: Int, routeId: Int, gsvPanoramaId: String, labelTypeId: Int, svImageX: Int, svImageY: Int,
                   canvasX: Int, canvasY: Int, heading: Float, pitch: Float, zoom: Int, canvasHeight: Int,
                   canvasWidth: Int, alphaX: Float, alphaY: Float, lat: Option[Float], lng: Option[Float],
                   description: String,
                   severity: Int,
                   temporaryProblem: Boolean)
/**
  *
  */
class GTLabelTable(tag: Tag) extends Table[GTLabel](tag, Some("sidewalk"), "gt_label") {
  def gtLabelId = column[Int]("gt_label_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def routeId = column[Int]("route_id", O.NotNull)
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.NotNull)
  def labelTypeId = column[Int]("label_type_id", O.NotNull)
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
  def description = column[String]("description", O.NotNull)
  def severity = column[Int]("severity", O.NotNull)
  def temporaryProblem = column[Boolean]("temporary_problem", O.NotNull)



  def * = (gtLabelId, routeId, gsvPanoramaId, labelTypeId, svImageX, svImageY,
           canvasX, canvasY, heading, pitch, zoom, canvasHeight, canvasWidth, alphaX, alphaY,
           lat, lng, description, severity, temporaryProblem)  <>  ((GTLabel.apply _).tupled, GTLabel.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("gt_label_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("gt_label_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)

}

/**
  * Data access object for the GTLabel table
  */
object GTLabelTable{
  val db = play.api.db.slick.DB
  val gtLabels = TableQuery[GTLabelTable]

  def getGTLabel(gtLabelId: Int): Option[GTLabel] = db.withSession { implicit session =>
    val gtLabel = gtLabels.filter(_.gtLabelId === gtLabelId).list
    gtLabel.headOption
  }

  def all: List[GTLabel] = db.withSession { implicit session =>
    gtLabels.list
  }

  def selectExistingLabels: List[GTLabel] = db.withSession { implicit session =>
    (for {
      (_labs, _existingLabs) <- gtLabels.innerJoin(GTExistingLabelTable.gtExistingLabels).on(_.gtLabelId === _.gtLabelId)
    } yield _labs).list
  }

  /** Returns set of labels that  */
  def selectAddedLabels: List[GTLabel] = db.withSession { implicit session =>
    (for {
      (_labs, _existingLabs) <- gtLabels.leftJoin(GTExistingLabelTable.gtExistingLabels).on(_.gtLabelId === _.gtLabelId)
      // includes only rows without an entry in the gt_existing_label table
      // http://slick.lightbend.com/doc/2.1.0/upgrade.html#isnull-and-isnotnull
      if _existingLabs.gtExistingLabelId.?.isEmpty
    } yield _labs).list
  }

  def save(gtLabel: GTLabel): Int = db.withTransaction { implicit session =>
    val gtId: Int =
      (gtLabels returning gtLabels.map(_.gtLabelId)) += gtLabel
    gtId
  }

}