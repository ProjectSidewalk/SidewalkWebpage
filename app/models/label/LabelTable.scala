package models.label

import java.util.UUID

import com.vividsolutions.jts.geom.LineString
import models.audit.{AuditTask, AuditTaskTable}
import models.region.RegionTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

case class Label(labelId: Int, auditTaskId: Int, gsvPanoramaId: String, labelTypeId: Int, photographerHeading: Float, photographerPitch: Float, panoramaLat: Float, panoramaLng: Float, deleted: Boolean, temporaryLabelId: Option[Int])
case class LabelLocation(labelId: Int, auditTaskId: Int, gsvPanoramaId: String, labelType: String, lat: Float, lng: Float)

/**
 *
 */
class LabelTable(tag: Tag) extends Table[Label](tag, Some("sidewalk"), "label") {
  def labelId = column[Int]("label_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.NotNull)
  def labelTypeId = column[Int]("label_type_id", O.NotNull)
  def photographerHeading = column[Float]("photographer_heading", O.NotNull)
  def photographerPitch = column[Float]("photographer_pitch", O.NotNull)
  def panoramaLat = column[Float]("panorama_lat", O.NotNull)
  def panoramaLng = column[Float]("panorama_lng", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)
  def temporaryLabelId = column[Option[Int]]("temporary_label_id", O.Nullable)

  def * = (labelId, auditTaskId, gsvPanoramaId, labelTypeId, photographerHeading, photographerPitch,
    panoramaLat, panoramaLng, deleted, temporaryLabelId) <> ((Label.apply _).tupled, Label.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("label_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("label_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)
}

/**
 * Data access object for the label table
 */
object LabelTable {
  val db = play.api.db.slick.DB
  val labels = TableQuery[LabelTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val labelPoints = TableQuery[LabelPointTable]
  val regions = TableQuery[RegionTable]

  val labelsWithoutDeleted = labels.filter(_.deleted === false)
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)


  case class LabelCountPerDay(date: String, count: Int)

  case class LabelMetadata(labelId: Int, auditTaskId: Int, userId: String, username: String,
                           timestamp: java.sql.Timestamp,
                           labelTypeDesc: String, severity: Option[Int], description: String)

  implicit val labelLocationConverter = GetResult[LabelLocation](r =>
    LabelLocation(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat)
  )

  def countLabels: Int = db.withTransaction(implicit session =>
    labels.filter(_.deleted === false).list.size
  )

  /*
  * Counts the number of labels added today.
  * If the task goes over two days, then all labels for that audit task
  * will be added for the task end date
  * Date: Aug 28, 2016
  */
  def countTodayLabels: Int = db.withSession { implicit session =>

    val countQuery = Q.queryNA[(Int)](
      """SELECT label.label_id
        |  FROM sidewalk.audit_task
        |INNER JOIN sidewalk.label
        |  ON label.audit_task_id = audit_task.audit_task_id
        |WHERE audit_task.task_end::date = now()::date
        |  AND label.deleted = false""".stripMargin
    )
    countQuery.list.size
  }

  /*
  * Counts the number of labels added yesterday
  * Date: Aug 28, 2016
  */
  def countYesterdayLabels: Int = db.withTransaction { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      """SELECT label.label_id
        |  FROM sidewalk.audit_task
        |INNER JOIN sidewalk.label
        |  ON label.audit_task_id = audit_task.audit_task_id
        |WHERE audit_task.task_end::date = now()::date - interval '1' day
        |  AND label.deleted = false""".stripMargin
    )

    countQuery.list.size
  }

  /**
    * This method returns the number of labels submitted by the given user
    *
    * @param userId User id
    * @return A number of labels submitted by the user
    */
  def countLabelsByUserId(userId: UUID): Int = db.withSession { implicit session =>
    val tasks = auditTasks.filter(_.userId === userId.toString)
    val _labels = for {
      (_tasks, _labels) <- tasks.innerJoin(labelsWithoutDeleted).on(_.auditTaskId === _.auditTaskId)
    } yield _labels
    _labels.list.size
  }

  /**
   * Saves a new label in the table
    *
    * @param label
   * @return
   */
  def save(label: Label): Int = db.withTransaction { implicit session =>
    val labelId: Int =
      (labels returning labels.map(_.labelId)) += label
    labelId
  }

  /*
   * Retrieves label and its metadata
   * Date: Sep 1, 2016
   */
  def selectTopLabelsAndMetadata(n: Int): List[LabelMetadata] = db.withSession { implicit session =>
    val selectQuery = Q.queryNA[(Int, Int, String, String, java.sql.Timestamp, String, Option[Int], String)](
      """SELECT lb1.label_id, lb1.audit_task_id, u.user_id, u.username, ati.timestamp,
        |       lb_big.label_type_desc, lb_big.severity, lb_big.description
        |	FROM sidewalk.label as lb1, sidewalk.audit_task as at, sidewalk.audit_task_interaction as ati,
        |       sidewalk.user as u,
        |				(SELECT lb.label_id, lbt.description as label_type_desc, sev.severity, prob_desc.description
        |					FROM label as lb
        |				LEFT JOIN sidewalk.label_type as lbt
        |					ON lb.label_type_id = lbt.label_type_id
        |				LEFT JOIN sidewalk.problem_severity as sev
        |					ON lb.label_id = sev.label_id
        |				LEFT JOIN sidewalk.problem_description as prob_desc
        |					ON lb.label_id = prob_desc.label_id
        |				) AS lb_big
        |WHERE lb1.audit_task_id = at.audit_task_id and (lb1.audit_task_id = ati.audit_task_id and
        |      lb1.temporary_label_id = ati.temporary_label_id) and lb1.label_id = lb_big.label_id and
        |      at.user_id = u.user_id
        |	ORDER BY ati.timestamp DESC""".stripMargin
    )
    selectQuery.list.map(label_i => LabelMetadata.tupled(label_i)).take(n)

  }

  /*
   * Retrieves label by user and its metadata
   * Date: Sep 2, 2016
   */
  def selectTopLabelsAndMetadataByUser(n: Int, userId: UUID): List[LabelMetadata] = db.withSession { implicit session =>
    val selectQuery = Q.queryNA[(Int, Int, String, String, java.sql.Timestamp, String, Option[Int], String)](
      """SELECT lb1.label_id, lb1.audit_task_id, u.user_id, u.username, ati.timestamp,
        |       lb_big.label_type_desc, lb_big.severity, lb_big.description
        |	FROM sidewalk.label as lb1, sidewalk.audit_task as at, sidewalk.audit_task_interaction as ati,
        |       sidewalk.user as u,
        |				(SELECT lb.label_id, lbt.description as label_type_desc, sev.severity, prob_desc.description
        |					FROM label as lb
        |				LEFT JOIN sidewalk.label_type as lbt
        |					ON lb.label_type_id = lbt.label_type_id
        |				LEFT JOIN sidewalk.problem_severity as sev
        |					ON lb.label_id = sev.label_id
        |				LEFT JOIN sidewalk.problem_description as prob_desc
        |					ON lb.label_id = prob_desc.label_id
        |				) AS lb_big
        |WHERE lb1.audit_task_id = at.audit_task_id and (lb1.audit_task_id = ati.audit_task_id and
        |      lb1.temporary_label_id = ati.temporary_label_id) and lb1.label_id = lb_big.label_id and
        |      at.user_id = u.user_id
        |	ORDER BY ati.timestamp DESC""".stripMargin
    )
    val userLabels = selectQuery.list.map(label_i => LabelMetadata.tupled(label_i))
    val records = userLabels.filter(_.userId == userId.toString).take(n)
    records

  }

  /**
    * This method returns all the submitted labels
    *
    * @return
    */
  def selectLocationsOfLabels: List[LabelLocation] = db.withSession { implicit session =>
    val _labels = for {
      (_labels, _labelTypes) <- labelsWithoutDeleted.innerJoin(labelTypes).on(_.labelTypeId === _.labelTypeId)
    } yield (_labels.labelId, _labels.auditTaskId, _labels.gsvPanoramaId, _labelTypes.labelType, _labels.panoramaLat, _labels.panoramaLng)

    val _points = for {
      (l, p) <- _labels.innerJoin(labelPoints).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, p.lat.getOrElse(0.toFloat), p.lng.getOrElse(0.toFloat))

    val labelLocationList: List[LabelLocation] = _points.list.map(label => LabelLocation(label._1, label._2, label._3, label._4, label._5, label._6))
    labelLocationList
  }

  /**
    * Retrieve Label Locations within a given bounding box
    *
    * @param minLat
    * @param minLng
    * @param maxLat
    * @param maxLng
    * @return
    */
  def selectLocationsOfLabelsIn(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[LabelLocation] = db.withSession { implicit session =>
    val selectLabelLocationQuery = Q.query[(Double, Double, Double, Double), LabelLocation](
      """SELECT label.label_id, label.audit_task_id, label.gsv_panorama_id, label_type.label_type, label_point.lat, label_point.lng
        |  FROM sidewalk.label
        |INNER JOIN sidewalk.label_type
        |  ON label.label_type_id = label_type.label_type_id
        |INNER JOIN sidewalk.label_point
        |  ON label.label_id = label_point.label_id
        |WHERE label.deleted = false
        |  AND label_point.lat IS NOT NULL
        |  AND ST_Intersects(label_point.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))""".stripMargin
    )
    selectLabelLocationQuery((minLng, minLat, maxLng, maxLat)).list
  }

  /**
   * This method returns a list of labels submitted by the given user.
    *
    * @param userId
   * @return
   */
  def selectLocationsOfLabelsByUserId(userId: UUID): List[LabelLocation] = db.withSession { implicit session =>
    val _labels = for {
      ((_auditTasks, _labels), _labelTypes) <- auditTasks leftJoin labelsWithoutDeleted on(_.auditTaskId === _.auditTaskId) leftJoin labelTypes on (_._2.labelTypeId === _.labelTypeId)
      if _auditTasks.userId === userId.toString
    } yield (_labels.labelId, _labels.auditTaskId, _labels.gsvPanoramaId, _labelTypes.labelType, _labels.panoramaLat, _labels.panoramaLng)

    val _points = for {
      (l, p) <- _labels.innerJoin(labelPoints).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, p.lat.getOrElse(0.toFloat), p.lng.getOrElse(0.toFloat))

    val labelLocationList: List[LabelLocation] = _points.list.map(label => LabelLocation(label._1, label._2, label._3, label._4, label._5, label._6))
    labelLocationList
  }

  def selectLocationsOfLabelsByUserIdAndRegionId(userId: UUID, regionId: Int) = db.withSession { implicit session =>
    val selectQuery = Q.query[(String, Int), LabelLocation](
      """SELECT label.label_id, label.audit_task_id, label.gsv_panorama_id, label_type.label_type, label_point.lat, label_point.lng, region.region_id
        |  FROM sidewalk.label
        |INNER JOIN sidewalk.label_type
        |  ON label.label_type_id = label_type.label_type_id
        |INNER JOIN sidewalk.label_point
        |  ON label.label_id = label_point.label_id
        |INNER JOIN sidewalk.audit_task
        |  ON audit_task.audit_task_id = label.audit_task_id
        |INNER JOIN sidewalk.region
        |  ON ST_Intersects(region.geom, label_point.geom)
        |WHERE label.deleted = FALSE
        |  AND label_point.lat IS NOT NULL
        |  AND region.deleted = FALSE
        |  AND region.region_type_id = 2
        |  AND audit_task.user_id = ?
        |  AND region_id = ?""".stripMargin
    )
    selectQuery((userId.toString, regionId)).list

//    val _labels = for {
//      ((_auditTasks, _labels), _labelTypes) <- auditTasks leftJoin labelsWithoutDeleted on(_.auditTaskId === _.auditTaskId) leftJoin labelTypes on (_._2.labelTypeId === _.labelTypeId)
//      if _auditTasks.userId === userId.toString
//    } yield (_labels.labelId, _labels.auditTaskId, _labels.gsvPanoramaId, _labelTypes.labelType, _labels.panoramaLat, _labels.panoramaLng)
//
//    val _points = for {
//      (l, p) <- _labels.innerJoin(labelPoints).on(_._1 === _.labelId)
//      if p.geom.isDefined
//    } yield (l._1, l._2, l._3, l._4, p.lat.getOrElse(0.toFloat), p.lng.getOrElse(0.toFloat), p.geom.get)
//
//    // Take the labels that are in the target region
//    val neighborhood = neighborhoods.filter(_.regionId === regionId)
//    val _pointsInRegion = for {
//      (p, n) <- _points.innerJoin(neighborhood).on((_p, _n) => _p._7.within(_n.geom))
//    } yield (p._1, p._2, p._3, p._4, p._5, p._6)
//
//    val labelLocationList: List[LabelLocation] = _pointsInRegion.list.map(label => LabelLocation(label._1, label._2, label._3, label._4, label._5, label._6))
//    labelLocationList
  }

  def selectLabelCountsPerDay: List[LabelCountPerDay] = db.withSession { implicit session =>
    val selectAuditCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date::date, COUNT(label_id) FROM (SELECT  current_date - (n || ' day')::INTERVAL AS calendar_date
        |FROM    generate_series(0, 30) n) AS calendar
        |LEFT JOIN sidewalk.audit_task
        |ON audit_task.task_start::date = calendar_date::date
        |LEFT JOIN sidewalk.label
        |ON label.audit_task_id = audit_task.audit_task_id
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )
    selectAuditCountQuery.list.map(x => LabelCountPerDay.tupled(x))
  }
}

