package models.label

import java.sql.Timestamp
import java.util.UUID

import com.vividsolutions.jts.geom.LineString
import models.audit.{AuditTask, AuditTaskEnvironmentTable, AuditTaskInteraction, AuditTaskTable}
import models.region.RegionTable
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

case class Label(labelId: Int,
                 auditTaskId: Int,
                 gsvPanoramaId: String,
                 labelTypeId: Int,
                 photographerHeading: Float,
                 photographerPitch: Float,
                 panoramaLat: Float,
                 panoramaLng: Float,
                 deleted: Boolean,
                 temporaryLabelId: Option[Int],
                 timeCreated: Option[Timestamp])

case class LabelLocation(labelId: Int,
                         auditTaskId: Int,
                         gsvPanoramaId: String,
                         labelType: String,
                         lat: Float,
                         lng: Float
                         )

case class LabelLocationWithSeverity(labelId: Int,
                                     auditTaskId: Int,
                                     gsvPanoramaId: String,
                                     labelType: String,
                                     severity: Int,
                                     lat: Float,
                                     lng: Float
                                    )

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
  def timeCreated = column[Option[Timestamp]]("time_created", O.Nullable)

  def * = (labelId, auditTaskId, gsvPanoramaId, labelTypeId, photographerHeading, photographerPitch,
    panoramaLat, panoramaLng, deleted, temporaryLabelId, timeCreated) <> ((Label.apply _).tupled, Label.unapply)

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
  val completedAudits = auditTasks.filter(_.completed === true)
  val auditTaskEnvironments = TableQuery[AuditTaskEnvironmentTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val labelPoints = TableQuery[LabelPointTable]
  val regions = TableQuery[RegionTable]
  val severities = TableQuery[ProblemSeverityTable]

  val labelsWithoutDeleted = labels.filter(_.deleted === false)
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)


  val anonId = "97760883-8ef0-4309-9a5e-0c086ef27573"
  val anonUsersAudits = for {
    (_ate, _at) <- auditTaskEnvironments.innerJoin(completedAudits).on(_.auditTaskId === _.auditTaskId)
    if _at.userId === anonId
  } yield (_ate.ipAddress, _ate.auditTaskId, _at.taskStart, _at.taskEnd)

  val anonIps = anonUsersAudits.groupBy(_._1).map{case(ip,group)=>ip}


  case class LabelCountPerDay(date: String, count: Int)

  case class LabelMetadata(labelId: Int, gsvPanoramaId: String, heading: Float, pitch: Float, zoom: Int,
                           canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
                           auditTaskId: Int,
                           userId: String, username: String,
                           timestamp: Option[java.sql.Timestamp],
                           labelTypeKey:String, labelTypeValue: String, severity: Option[Int],
                           temporary: Boolean, description: Option[String],
                           panoLat: Float, panoLng: Float, lat: Float, lng: Float)

  implicit val labelLocationConverter = GetResult[LabelLocation](r =>
    LabelLocation(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat))

  implicit val labelSeverityConverter = GetResult[LabelLocationWithSeverity](r =>
    LabelLocationWithSeverity(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextInt, r.nextFloat, r.nextFloat))

  /**
    * Find a label
    *
    * @param labelId
    * @return
    */
  def find(labelId: Int): Option[Label] = db.withSession { implicit session =>
    val labelList = labels.filter(_.labelId === labelId).list
    labelList.headOption
  }

  /**
    * Find a label based on temp_label_id and audit_task_id.
    *
    * @param tempLabelId
    * @param auditTaskId
    * @return
    */
  def find(tempLabelId: Int, auditTaskId: Int): Option[Int] = db.withSession { implicit session =>
    val labelIds = labels.filter(x => x.temporaryLabelId === tempLabelId && x.auditTaskId === auditTaskId).map{
      label => label.labelId
    }
    labelIds.list.headOption
  }

  def countLabels: Int = db.withTransaction(implicit session =>
    labels.filter(_.deleted === false).list.size
  )

  def countLabelsBasedOnType(labelTypeString: String): Int = db.withTransaction(implicit session =>
    labels.filter(_.deleted === false).filter(_.labelTypeId === LabelTypeTable.labelTypeToId(labelTypeString)).list.size
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
  * Counts the number of specific label types added today.
  * If the task goes over two days, then all labels for that audit task
  * will be added for the task end date
  * Date: Aug 28, 2016
  */
  def countTodayLabelsBasedOnType(labelType: String): Int = db.withSession { implicit session =>

    val countQuery = s"""SELECT label.label_id
                         |  FROM sidewalk.audit_task
                         |INNER JOIN sidewalk.label
                         |  ON label.audit_task_id = audit_task.audit_task_id
                         |WHERE audit_task.task_end::date = now()::date
                         |  AND label.deleted = false AND label.label_type_id = (SELECT label_type_id
                         |														FROM sidewalk.label_type as lt
                         |														WHERE lt.label_type='$labelType')""".stripMargin
    val countQueryResult = Q.queryNA[(Int)](countQuery)

    countQueryResult.list.size
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

  /*
  * Counts the number of specific label types added yesterday
  * Date: Aug 28, 2016
  */
  def countYesterdayLabelsBasedOnType(labelType: String): Int = db.withTransaction { implicit session =>
    val countQuery = s"""SELECT label.label_id
                         |  FROM sidewalk.audit_task
                         |INNER JOIN sidewalk.label
                         |  ON label.audit_task_id = audit_task.audit_task_id
                         |WHERE audit_task.task_end::date = now()::date - interval '1' day
                         |  AND label.deleted = false AND label.label_type_id = (SELECT label_type_id
                         |														FROM sidewalk.label_type as lt
                         |														WHERE lt.label_type='$labelType')""".stripMargin
    val countQueryResult = Q.queryNA[(Int)](countQuery)

    countQueryResult.list.size
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

  def updateDeleted(labelId: Int, deleted: Boolean) = db.withTransaction { implicit session =>
    val labs = labels.filter(_.labelId === labelId).map(lab => lab.deleted)
    labs.update(deleted)
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

  // TODO translate the following three queries to Slick
  def retrieveLabelMetadata(takeN: Int): List[LabelMetadata] = db.withSession { implicit session =>
    val selectQuery = Q.query[Int, (Int, String, Float, Float, Int, Int, Int, Int, Int,
      Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean,
      Option[String], Float, Float, Float, Float)](
      """SELECT lb1.label_id, lb1.gsv_panorama_id, lp.heading, lp.pitch, lp.zoom, lp.canvas_x, lp.canvas_y,
        |       lp.canvas_width, lp.canvas_height, lb1.audit_task_id, u.user_id, u.username, lb1.time_created,
        |       lb_big.label_type, lb_big.label_type_desc, lb_big.severity, lb_big.temp_problem, lb_big.description, lb1.panorama_lat, lb1.panorama_lng, lp.lat, lp.lng
        |	FROM sidewalk.label as lb1, sidewalk.audit_task as at,
        |       sidewalk.user as u, sidewalk.label_point as lp,
        |				(SELECT lb.label_id, lb.gsv_panorama_id, lbt.label_type, lbt.description as label_type_desc, sev.severity,
        |               COALESCE(prob_temp.temporary_problem,'FALSE') as temp_problem,
        |               prob_desc.description
        |					FROM label as lb
        |				LEFT JOIN sidewalk.label_type as lbt
        |					ON lb.label_type_id = lbt.label_type_id
        |				LEFT JOIN sidewalk.problem_severity as sev
        |					ON lb.label_id = sev.label_id
        |				LEFT JOIN sidewalk.problem_description as prob_desc
        |					ON lb.label_id = prob_desc.label_id
        |				LEFT JOIN sidewalk.problem_temporariness as prob_temp
        |					ON lb.label_id = prob_temp.label_id
        |				) AS lb_big
        |WHERE lb1.deleted = FALSE and lb1.audit_task_id = at.audit_task_id and
        |      lb1.label_id = lb_big.label_id and at.user_id = u.user_id and lb1.label_id = lp.label_id
        |	ORDER BY lb1.label_id DESC
        | LIMIT ?""".stripMargin
    )
    selectQuery(takeN).list.map(label => LabelMetadata.tupled(label))
  }

  def retrieveLabelMetadata(takeN: Int, userId: String): List[LabelMetadata] = db.withSession { implicit session =>
    val selectQuery = Q.query[(String, Int),(Int, String, Float, Float, Int, Int, Int, Int, Int,
      Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean,
      Option[String], Float, Float, Float, Float)](
      """SELECT lb1.label_id, lb1.gsv_panorama_id, lp.heading, lp.pitch, lp.zoom, lp.canvas_x, lp.canvas_y,
        |       lp.canvas_width, lp.canvas_height, lb1.audit_task_id, u.user_id, u.username, lb1.time_created,
        |       lb_big.label_type, lb_big.label_type_desc, lb_big.severity, lb_big.temp_problem, lb_big.description, lb1.panorama_lat, lb1.panorama_lng, lp.lat, lp.lng
        |	FROM sidewalk.label as lb1, sidewalk.audit_task as at,
        |       sidewalk.user as u, sidewalk.label_point as lp,
        |				(SELECT lb.label_id, lb.gsv_panorama_id, lbt.label_type, lbt.description as label_type_desc, sev.severity,
        |               COALESCE(prob_temp.temporary_problem,'FALSE') as temp_problem,
        |               prob_desc.description
        |					FROM label as lb
        |				LEFT JOIN sidewalk.label_type as lbt
        |					ON lb.label_type_id = lbt.label_type_id
        |				LEFT JOIN sidewalk.problem_severity as sev
        |					ON lb.label_id = sev.label_id
        |				LEFT JOIN sidewalk.problem_description as prob_desc
        |					ON lb.label_id = prob_desc.label_id
        |				LEFT JOIN sidewalk.problem_temporariness as prob_temp
        |					ON lb.label_id = prob_temp.label_id
        |				) AS lb_big
        |WHERE u.user_id = ? and
        |      lb1.deleted = FALSE and lb1.audit_task_id = at.audit_task_id and
        |      lb1.label_id = lb_big.label_id and at.user_id = u.user_id and lb1.label_id = lp.label_id
        |	ORDER BY lb1.label_id DESC
        | LIMIT ?""".stripMargin
    )
    selectQuery((userId, takeN)).list.map(label => LabelMetadata.tupled(label))
  }

  def retrieveSingleLabelMetadata(labelId: Int): LabelMetadata = db.withSession { implicit session =>
    val selectQuery = Q.query[Int,(Int, String, Float, Float, Int, Int, Int, Int, Int,
      Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean,
      Option[String], Float, Float, Float, Float)](
      """SELECT lb1.label_id, lb1.gsv_panorama_id, lp.heading, lp.pitch, lp.zoom, lp.canvas_x, lp.canvas_y,
        |       lp.canvas_width, lp.canvas_height, lb1.audit_task_id, u.user_id, u.username, lb1.time_created,
        |       lb_big.label_type, lb_big.label_type_desc, lb_big.severity, lb_big.temp_problem, lb_big.description, lb1.panorama_lat, lb1.panorama_lng, lp.lat, lp.lng
        |	FROM sidewalk.label as lb1, sidewalk.audit_task as at,
        |       sidewalk.user as u, sidewalk.label_point as lp,
        |				(SELECT lb.label_id, lb.gsv_panorama_id, lbt.label_type, lbt.description as label_type_desc, sev.severity,
        |               COALESCE(prob_temp.temporary_problem,'FALSE') as temp_problem,
        |               prob_desc.description
        |					FROM label as lb
        |				LEFT JOIN sidewalk.label_type as lbt
        |					ON lb.label_type_id = lbt.label_type_id
        |				LEFT JOIN sidewalk.problem_severity as sev
        |					ON lb.label_id = sev.label_id
        |				LEFT JOIN sidewalk.problem_description as prob_desc
        |					ON lb.label_id = prob_desc.label_id
        |				LEFT JOIN sidewalk.problem_temporariness as prob_temp
        |					ON lb.label_id = prob_temp.label_id
        |				) AS lb_big
        |WHERE lb1.label_id = ? and lb1.audit_task_id = at.audit_task_id and
        |      lb1.label_id = lb_big.label_id and at.user_id = u.user_id and lb1.label_id = lp.label_id
        |	ORDER BY lb1.label_id DESC""".stripMargin
    )
    selectQuery(labelId).list.map(label => LabelMetadata.tupled(label)).head
  }

//  case class LabelMetadata(labelId: Int, gsvPanoramaId: String, heading: Float, pitch: Float, zoom: Int,
//                           canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
//                           auditTaskId: Int,
//                           userId: String, username: String,
//                           timestamp: java.sql.Timestamp,
//                           labelTypeKey:String, labelTypeValue: String, severity: Option[Int],
//                           temporary: Boolean, description: Option[String], lat: Float, lng: Float, lat2: Float, lng2: Float)
  def labelMetadataToJson(labelMetadata: LabelMetadata): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "heading" -> labelMetadata.heading,
      "pitch" -> labelMetadata.pitch,
      "zoom" -> labelMetadata.zoom,
      "canvas_x" -> labelMetadata.canvasX,
      "canvas_y" -> labelMetadata.canvasY,
      "canvas_width" -> labelMetadata.canvasWidth,
      "canvas_height" -> labelMetadata.canvasHeight,
      "audit_task_id" -> labelMetadata.auditTaskId,
      "user_id" -> labelMetadata.userId,
      "username" -> labelMetadata.username,
      "timestamp" -> labelMetadata.timestamp,
      "label_type_key" -> labelMetadata.labelTypeKey,
      "label_type_value" -> labelMetadata.labelTypeValue,
      "severity" -> labelMetadata.severity,
      "temporary" -> labelMetadata.temporary,
      "description" -> labelMetadata.description,
      "panorama_lat" -> labelMetadata.panoLat,
      "panorama_lng" -> labelMetadata.panoLng,
      "label_lat" -> labelMetadata.lat,
      "label_lng" -> labelMetadata.lng
    )
  }

  /*
   * Retrieve label metadata for a labelId
   * @param labelId
   */
  def getLabelMetadata(labelId: Int): LabelMetadata= db.withSession { implicit session =>
    retrieveSingleLabelMetadata(labelId)
  }

  /**
    * Returns all the labels submitted by the given user
    * @param userId
    * @return
    */
  def selectLabelsByUserId(userId: UUID): List[Label] = db.withSession { implicit session =>
    val _labels = for {
      (_labels, _auditTasks) <- labelsWithoutDeleted.innerJoin(auditTasks).on(_.auditTaskId === _.auditTaskId)
      if _auditTasks.userId === userId.toString
    } yield _labels
    _labels.list
  }

  /**
    * Returns all the labels of the given user that are associated with the given interactions
    * @param userId
    * @param interactions
    * @return
    */
  def selectLabelsByInteractions(userId: UUID, interactions: List[AuditTaskInteraction]) = {
    val labels = selectLabelsByUserId(userId).filter(_.temporaryLabelId.isDefined)

    // Yield labels that share the same audit task id and temporary label id.
    val filteredLabels = for {
      l <- labels
      i <- interactions
      if l.auditTaskId == i.auditTaskId && l.temporaryLabelId == i.temporaryLabelId
    } yield l
    filteredLabels
  }

  /*
   * Retrieves label and its metadata
   * Date: Sep 1, 2016
   */
  def selectTopLabelsAndMetadata(n: Int): List[LabelMetadata] = db.withSession { implicit session =>
    retrieveLabelMetadata(n)
  }

  /*
   * Retrieves label by user and its metadata
   * Date: Sep 2, 2016
   */
  def selectTopLabelsAndMetadataByUser(n: Int, userId: UUID): List[LabelMetadata] = db.withSession { implicit session =>

    retrieveLabelMetadata(n, userId.toString)
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
    * This method returns all the submitted labels with their severities included.
    *
    * @return
    */
  def selectLocationsAndSeveritiesOfLabels: List[LabelLocationWithSeverity] = db.withSession { implicit session =>
    val _labels = for {
      (_labels, _labelTypes) <- labelsWithoutDeleted.innerJoin(labelTypes).on(_.labelTypeId === _.labelTypeId)
    } yield (_labels.labelId, _labels.auditTaskId, _labels.gsvPanoramaId, _labelTypes.labelType, _labels.panoramaLat, _labels.panoramaLng)

    val _slabels = for {
      (l, s) <- _labels.innerJoin(severities).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, s.severity)

    val _points = for {
      (l, p) <- _slabels.innerJoin(labelPoints).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, l._5, p.lat.getOrElse(0.toFloat), p.lng.getOrElse(0.toFloat))

    val labelLocationList: List[LabelLocationWithSeverity] = _points.list.map(label => LabelLocationWithSeverity(label._1, label._2, label._3, label._4, label._5, label._6, label._7))
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

  /**
    * Returns counts of labels by label type in the specified region
    *
    * @param regionId
    * @return
    */
  def selectNegativeLabelCountsByRegionId(regionId: Int) = db.withSession { implicit session =>
    val selectQuery = Q.query[(Int), (String, Int)](
      """SELECT labels.label_type, count(labels.label_type) FROM (
        |	SELECT label.label_id, label_type.label_type, label_point.lat, region.region_id
        |          FROM sidewalk.label
        |        INNER JOIN sidewalk.label_type
        |          ON label.label_type_id = label_type.label_type_id
        |        INNER JOIN sidewalk.label_point
        |          ON label.label_id = label_point.label_id
        |        INNER JOIN sidewalk.region
        |          ON ST_Intersects(region.geom, label_point.geom)
        |        WHERE label.deleted = FALSE
        |          AND label_point.lat IS NOT NULL
        |          AND region.deleted = FALSE
        |          AND region.region_type_id = 2
        |          AND label.label_type_id NOT IN (1,5,6)
        |          AND region_id = ?) AS labels
        |GROUP BY (labels.label_type)""".stripMargin
    )
    selectQuery(regionId).list
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

  /**
    * Returns a count of the number of labels placed on each day since the tool was launched (11/17/2015).
    *
    * @return
    */
  def selectLabelCountsPerDay: List[LabelCountPerDay] = db.withSession { implicit session =>
    val selectLabelCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date::date, COUNT(label_id) FROM (SELECT  current_date - (n || ' day')::INTERVAL AS calendar_date
        |FROM    generate_series(0, current_date - '11/17/2015') n) AS calendar
        |LEFT JOIN sidewalk.audit_task
        |ON audit_task.task_start::date = calendar_date::date
        |LEFT JOIN sidewalk.label
        |ON label.audit_task_id = audit_task.audit_task_id
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )
    selectLabelCountQuery.list.map(x => LabelCountPerDay.tupled(x))
  }


  /**
    * Select label counts per registered user
    */
  def getLabelCountsPerRegisteredUser: List[(String, Int)] = db.withSession { implicit session =>

    val regUserAudits = completedAudits.filterNot(_.userId === "97760883-8ef0-4309-9a5e-0c086ef27573")

    val _labels = for {
      (_tasks, _labels) <- regUserAudits.innerJoin(labelsWithoutDeleted).on(_.auditTaskId === _.auditTaskId)
    } yield _tasks.userId

    // counts the number of tasks for each user
    _labels.groupBy(l => l).map{ case (uid, group) => (uid, group.length)}.list
  }

  /**
    * Select label counts per anonymous user
    */
  def getLabelCountsPerAnonUser: List[(String, Int)] = db.withSession { implicit session =>

    // gets ip address and audit task id of all audits (possibly incomplete) done by anonymous users
    // TODO figure out how to select a distinct environment for each ip address, right now we get duplicates!!!
    val _anonAudits = for {
      (_environment, _task) <- auditTaskEnvironments.innerJoin(auditTasks).on(_.auditTaskId === _.auditTaskId)
      if _task.userId === anonId
    } yield (_environment.ipAddress, _environment.auditTaskId)

    val uniqueAudits = _anonAudits.groupBy(x => x).map(_._1)

    // join with label table, but only return ip address; we end up with an occurrence of an ip address for each label
    // that was placed from this ip address
    val _labels = for {
      (_tasks, _labels) <- uniqueAudits.innerJoin(labelsWithoutDeleted).on(_._2 === _.auditTaskId)
    } yield _tasks._1

    // now count the occurrences of each ip address, this gives you the label counts. Also right join on the list of
    // anonymous users, since anon users that didn't supply any labels at all would not have been in the list, and we
    // want to associate a 0 with their ip address.
    val labelCounts = _labels.groupBy(l => l).map{ case (uid, group) => (uid, group.length)}.rightJoin(anonIps).on(_._1 === _).map{
      case (cm, ai) => (ai, cm._2.?)
    }.list

    // right now the count is an option; replace the None with a 0 -- it was none b/c only users who had completed
    // missions ended up in the completedMissions query.
    labelCounts.map{pair => (pair._1.get, pair._2.getOrElse(0))}
  }
}
