package models.label

import java.net.{ConnectException, HttpURLConnection, SocketException, URL}
import java.sql.Timestamp
import java.util.UUID

import models.audit.{AuditTask, AuditTaskEnvironmentTable, AuditTaskTable}
import models.daos.slick.DBTableDefinitions.UserTable
import models.gsv.GSVDataTable
import models.mission.{Mission, MissionTable, MissionTypeTable}
import models.region.RegionTable
import models.user.{RoleTable, UserRoleTable}
import models.utils.MyPostgresDriver.simple._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.collection.mutable.ListBuffer
import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

case class Label(labelId: Int,
                 auditTaskId: Int,
                 missionId: Int,
                 gsvPanoramaId: String,
                 labelTypeId: Int,
                 photographerHeading: Float,
                 photographerPitch: Float,
                 panoramaLat: Float,
                 panoramaLng: Float,
                 deleted: Boolean,
                 temporaryLabelId: Option[Int],
                 timeCreated: Option[Timestamp],
                 turorial: Boolean,
                 streetEdgeId: Int)

case class LabelLocation(labelId: Int,
                         auditTaskId: Int,
                         gsvPanoramaId: String,
                         labelType: String,
                         lat: Float,
                         lng: Float)

case class LabelLocationWithSeverity(labelId: Int,
                                     auditTaskId: Int,
                                     gsvPanoramaId: String,
                                     labelType: String,
                                     severity: Option[Int],
                                     lat: Float,
                                     lng: Float)


case class LabelValidationLocation(labelId: Int, labelType: String, gsvPanoramaId: String,
                                   heading: Float, pitch: Float, zoom: Float, canvasX: Int,
                                   canvasY: Int, canvasWidth: Int, canvasHeight: Int)

/**
 *
 */
class LabelTable(tag: slick.lifted.Tag) extends Table[Label](tag, Some("sidewalk"), "label") {
  def labelId = column[Int]("label_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.NotNull)
  def labelTypeId = column[Int]("label_type_id", O.NotNull)
  def photographerHeading = column[Float]("photographer_heading", O.NotNull)
  def photographerPitch = column[Float]("photographer_pitch", O.NotNull)
  def panoramaLat = column[Float]("panorama_lat", O.NotNull)
  def panoramaLng = column[Float]("panorama_lng", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)
  def temporaryLabelId = column[Option[Int]]("temporary_label_id", O.Nullable)
  def timeCreated = column[Option[Timestamp]]("time_created", O.Nullable)
  def tutorial = column[Boolean]("tutorial", O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)

  def * = (labelId, auditTaskId, missionId, gsvPanoramaId, labelTypeId, photographerHeading, photographerPitch,
    panoramaLat, panoramaLng, deleted, temporaryLabelId, timeCreated, tutorial, streetEdgeId) <> ((Label.apply _).tupled, Label.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("label_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("label_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)

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
  val gsvData = TableQuery[GSVDataTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val labelPoints = TableQuery[LabelPointTable]
  val labelValidations = TableQuery[LabelValidationTable]
  val missions = TableQuery[MissionTable]
  val regions = TableQuery[RegionTable]
  val severities = TableQuery[LabelSeverityTable]
  val users = TableQuery[UserTable]
  val userRoles = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]

  val labelsWithoutDeleted = labels.filter(_.deleted === false)
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)

  // Filters out the labels placed during onboarding (aka panoramas that are used during onboarding
  // Onboarding labels have to be filtered out before a user's labeling frequency is computed
  val labelsWithoutDeletedOrOnboarding = labelsWithoutDeleted.filter(_.tutorial === false)

  case class LabelCountPerDay(date: String, count: Int)

  case class LabelMetadata(labelId: Int, gsvPanoramaId: String, tutorial: Boolean, heading: Float, pitch: Float,
                           zoom: Int, canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
                           auditTaskId: Int,
                           userId: String, username: String,
                           timestamp: Option[java.sql.Timestamp],
                           labelTypeKey:String, labelTypeValue: String, severity: Option[Int],
                           temporary: Boolean, description: Option[String], tags: List[String])

  // NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
  case class LabelValidationMetadata(labelId: Int, labelType: String, gsvPanoramaId: String,
                                     heading: Float, pitch: Float, zoom: Int, canvasX: Int,
                                     canvasY: Int, canvasWidth: Int, canvasHeight: Int)

  case class LabelCVMetadata(gsvPanoramaId: String, svImageX: Int, svImageY: Int,
                             labelTypeId: Int, photographerHeading: Float, heading: Float,
                             userRole: String, username: String, missionType: String, labelId: Int)

  case class MiniMapResumeMetadata(labelId: Int, labelType: String, lat: Option[Float], lng: Option[Float])

  implicit val labelLocationConverter = GetResult[LabelLocation](r =>
    LabelLocation(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat))

  implicit val labelValidationMetadataConverter = GetResult[LabelValidationMetadata](r =>
    LabelValidationMetadata(r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt))

  implicit val MiniMapResumeMetadataConverter = GetResult[MiniMapResumeMetadata](r =>
    MiniMapResumeMetadata(r.nextInt, r.nextString, r.nextFloatOption, r.nextFloatOption))

  implicit val labelSeverityConverter = GetResult[LabelLocationWithSeverity](r =>
    LabelLocationWithSeverity(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextIntOption, r.nextFloat, r.nextFloat))

  // Valid label type ids -- excludes Other and Occlusion labels
  val labelTypeIdList: List[Int] = List(1, 2, 3, 4, 7)

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
    * Find all labels with given regionId and userId
    * @param labelId
    * @return
    */
  def resumeMiniMap(regionId: Int, userId: UUID): List[MiniMapResumeMetadata] = db.withSession { implicit session =>
    val labelsWithCVMetadata = for {
      _m <- missions if _m.userId === userId.toString && _m.regionId === regionId
      _lb <- labels if _lb.missionId === _m.missionId
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- LabelPointTable.labelPoints if _lb.labelId === _lp.labelId

    } yield (_lb.labelId, _lt.labelType, _lp.lat, _lp.lng)
    labelsWithCVMetadata.list.map(label => MiniMapResumeMetadata.tupled(label))
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
    labels.filter(_.deleted === false).length.run
  )

  def countLabelsBasedOnType(labelTypeString: String): Int = db.withTransaction(implicit session =>
    labels.filter(_.deleted === false).filter(_.labelTypeId === LabelTypeTable.labelTypeToId(labelTypeString)).length.run
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
        |FROM sidewalk.audit_task
        |INNER JOIN sidewalk.label ON label.audit_task_id = audit_task.audit_task_id
        |WHERE audit_task.task_end::date = now()::date
        |    AND label.deleted = false""".stripMargin
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
        |FROM sidewalk.audit_task
        |INNER JOIN sidewalk.label ON label.audit_task_id = audit_task.audit_task_id
        |WHERE audit_task.task_end::date = now()::date - interval '1' day
        |    AND label.deleted = false""".stripMargin
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
    _labels.length.run
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

  /**
    * Returns all labels with sufficient metadata to produce crops for computer vision tasks.
    * @return
    */
  def retrieveCVMetadata: List[LabelCVMetadata] = db.withSession { implicit session =>
    val labelsWithCVMetadata = for {
      _labels <- labels
      _labelPoint <- LabelPointTable.labelPoints if _labels.labelId === _labelPoint.labelId
      _mission <- MissionTable.missions if _labels.missionId === _mission.missionId
      _missionType <- MissionTypeTable.missionTypes if _mission.missionTypeId === _missionType.missionTypeId
      _roleid <- UserRoleTable.userRoles if _mission.userId === _roleid.userId
      _rolename <- RoleTable.roles if _roleid.roleId === _rolename.roleId
      _user <- UserTable.users if _mission.userId === _user.userId

    } yield (_labels.gsvPanoramaId,
      _labelPoint.svImageX,
      _labelPoint.svImageY,
      _labels.labelTypeId,
      _labels.photographerHeading,
      _labelPoint.heading,
      _rolename.role,
      _user.username,
      _missionType.missionType,
      _labels.labelId
    )
    labelsWithCVMetadata.list.map(label => LabelCVMetadata.tupled(label))
  }

  // TODO translate the following three queries to Slick
  def retrieveLabelMetadata(takeN: Int): List[LabelMetadata] = db.withSession { implicit session =>
    val selectQuery = Q.query[Int, (Int, String, Boolean, Float, Float, Int, Int, Int, Int, Int,
      Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean,
      Option[String])](
      """SELECT lb1.label_id,
        |       lb1.gsv_panorama_id,
        |       lb1.tutorial,
        |       lp.heading,
        |       lp.pitch,
        |       lp.zoom,
        |       lp.canvas_x,
        |       lp.canvas_y,
        |       lp.canvas_width,
        |       lp.canvas_height,
        |       lb1.audit_task_id,
        |       u.user_id,
        |       u.username,
        |       lb1.time_created,
        |       lb_big.label_type,
        |       lb_big.label_type_desc,
        |       lb_big.severity,
        |       lb_big.temp,
        |       lb_big.description
        |FROM sidewalk.label AS lb1,
        |     sidewalk.audit_task AS at,
        |     sidewalk_user AS u,
        |     sidewalk.label_point AS lp,
        |			(
        |         SELECT lb.label_id,
        |                lb.gsv_panorama_id,
        |                lbt.label_type,
        |                lbt.description AS label_type_desc,
        |                sev.severity,
        |                COALESCE(lab_temp.temporary, 'FALSE') AS temp,
        |                lab_desc.description
        |					FROM label AS lb
        |				  LEFT JOIN sidewalk.label_type as lbt ON lb.label_type_id = lbt.label_type_id
        |  				LEFT JOIN sidewalk.label_severity as sev ON lb.label_id = sev.label_id
        |				  LEFT JOIN sidewalk.label_description as lab_desc ON lb.label_id = lab_desc.label_id
        |				  LEFT JOIN sidewalk.label_temporariness as lab_temp ON lb.label_id = lab_temp.label_id
        |		  ) AS lb_big
        |WHERE lb1.deleted = FALSE
        |    AND lb1.audit_task_id = at.audit_task_id
        |    AND lb1.label_id = lb_big.label_id
        |    AND at.user_id = u.user_id
        |    AND lb1.label_id = lp.label_id
        |ORDER BY lb1.label_id DESC
        |LIMIT ?""".stripMargin
    )
    selectQuery(takeN).list.map(label => labelAndTagsToLabelMetadata(label, getTagsFromLabelId(label._1)))
  }

  def retrieveLabelMetadata(takeN: Int, userId: String): List[LabelMetadata] = db.withSession { implicit session =>
    val selectQuery = Q.query[(String, Int),(Int, String, Boolean, Float, Float, Int, Int, Int, Int, Int,
      Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean,
      Option[String])](
      """SELECT lb1.label_id,
        |       lb1.gsv_panorama_id,
        |       lb1.tutorial,
        |       lp.heading,
        |       lp.pitch,
        |       lp.zoom,
        |       lp.canvas_x,
        |       lp.canvas_y,
        |       lp.canvas_width,
        |       lp.canvas_height,
        |       lb1.audit_task_id,
        |       u.user_id,
        |       u.username,
        |       lb1.time_created,
        |       lb_big.label_type,
        |       lb_big.label_type_desc,
        |       lb_big.severity,
        |       lb_big.temp,
        |       lb_big.description
        |FROM sidewalk.label AS lb1,
        |     sidewalk.audit_task AS at,
        |     sidewalk_user AS u,
        |     sidewalk.label_point AS lp,
        |			(
        |         SELECT lb.label_id,
        |                lb.gsv_panorama_id,
        |                lbt.label_type,
        |                lbt.description AS label_type_desc,
        |                sev.severity,
        |                COALESCE(lab_temp.temporary, 'FALSE') AS temp,
        |                lab_desc.description
        |					FROM label AS lb
        |		  		LEFT JOIN sidewalk.label_type AS lbt ON lb.label_type_id = lbt.label_type_id
        |			  	LEFT JOIN sidewalk.label_severity AS sev ON lb.label_id = sev.label_id
        |			  	LEFT JOIN sidewalk.label_description AS lab_desc ON lb.label_id = lab_desc.label_id
        |				  LEFT JOIN sidewalk.label_temporariness AS lab_temp ON lb.label_id = lab_temp.label_id
        |			) AS lb_big
        |WHERE u.user_id = ?
        |      AND lb1.deleted = FALSE
        |      AND lb1.audit_task_id = at.audit_task_id
        |      AND lb1.label_id = lb_big.label_id
        |      AND at.user_id = u.user_id
        |      AND lb1.label_id = lp.label_id
        |ORDER BY lb1.label_id DESC
        |LIMIT ?""".stripMargin
    )
    selectQuery((userId, takeN)).list.map(label => labelAndTagsToLabelMetadata(label, getTagsFromLabelId(label._1)))
  }

  def retrieveSingleLabelMetadata(labelId: Int): LabelMetadata = db.withSession { implicit session =>
    val selectQuery = Q.query[Int,(Int, String, Boolean, Float, Float, Int, Int, Int, Int, Int,
      Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean,
      Option[String])](
      """SELECT lb1.label_id,
        |       lb1.gsv_panorama_id,
        |       lb1.tutorial,
        |       lp.heading,
        |       lp.pitch,
        |       lp.zoom,
        |       lp.canvas_x,
        |       lp.canvas_y,
        |       lp.canvas_width,
        |       lp.canvas_height,
        |       lb1.audit_task_id,
        |       u.user_id,
        |       u.username,
        |       lb1.time_created,
        |       lb_big.label_type,
        |       lb_big.label_type_desc,
        |       lb_big.severity,
        |       lb_big.temp,
        |       lb_big.description
        |FROM sidewalk.label AS lb1,
        |     sidewalk.audit_task AS at,
        |     sidewalk_user AS u,
        |     sidewalk.label_point AS lp,
        |		  (
        |         SELECT lb.label_id,
        |                lb.gsv_panorama_id,
        |                lbt.label_type,
        |                lbt.description AS label_type_desc,
        |                sev.severity,
        |                COALESCE(lab_temp.temporary, 'FALSE') AS temp,
        |                lab_desc.description
        |					FROM label AS lb
        |		  		LEFT JOIN sidewalk.label_type AS lbt ON lb.label_type_id = lbt.label_type_id
        |		  		LEFT JOIN sidewalk.label_severity AS sev ON lb.label_id = sev.label_id
        |				  LEFT JOIN sidewalk.label_description AS lab_desc ON lb.label_id = lab_desc.label_id
        |				  LEFT JOIN sidewalk.label_temporariness AS lab_temp ON lb.label_id = lab_temp.label_id
        |			) AS lb_big
        |WHERE lb1.label_id = ?
        |      AND lb1.audit_task_id = at.audit_task_id
        |      AND lb1.label_id = lb_big.label_id
        |      AND at.user_id = u.user_id
        |      AND lb1.label_id = lp.label_id
        |ORDER BY lb1.label_id DESC""".stripMargin
    )
    selectQuery(labelId).list.map(label => labelAndTagsToLabelMetadata(label, getTagsFromLabelId(label._1))).head
  }

  /**
    * Retrieves a label with a given labelID for validation.
    * @param labelId  Label ID for label to retrieve.
    * @return         LabelValidationMetadata object.
    */
  def retrieveSingleLabelForValidation(labelId: Int): LabelValidationMetadata = db.withSession { implicit session =>
    val validationLabels = for {
      _lb <- labels if _lb.labelId === labelId
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
    } yield (_lb.labelId, _lt.labelType, _lb.gsvPanoramaId, _lp.heading, _lp.pitch, _lp.zoom,
      _lp.canvasX, _lp.canvasY, _lp.canvasWidth, _lp.canvasHeight)
    validationLabels.list.map(label => LabelValidationMetadata.tupled(label)).head
  }

  /**
    * Returns whether we have enough labels for this user to validate.
    * @param userId             User ID.
    * @param labelTypeId        Label Type ID of labels requested.
    * @param labelsRequired     Number of labels we need to query.
    * @return   True if we have enough labels, false otherwise.
    */
  def hasSufficientLabels(userId: UUID, labelTypeId: Int, labelsRequired: Int): Boolean = db.withSession { implicit session =>
    val labelCount: Int = getAvailableValidationLabels(userId, labelTypeId, None)
    labelCount >= labelsRequired
  }

  /**
    * Returns how many labels this user can validate for a given label type. Users are not allowed
    * to validate labels that they have already validated or labels that they have placed.
    * @param userId       User ID.
    * @param labelTypeId  Type of label.
    * @param labelIdList  List of labels to exclude (i.e., labels that have already been selected)
    * @return             Number of labels that the user can validate.
    */
  def getAvailableValidationLabels(userId: UUID, labelTypeId: Int, labelIdList: Option[ListBuffer[Int]]): Int = db.withSession { implicit session =>
    val userIdString: String = userId.toString
    val existingLabels: ListBuffer[Int] = labelIdList.getOrElse(new ListBuffer[Int])
    val labelsValidatedByUser = labelValidations.filter(_.userId === userIdString).map(_.labelId).list

    val validationLabels =  for {
      _lb <- labels if _lb.labelTypeId === labelTypeId && _lb.deleted === false && _lb.tutorial === false
      _lt <- labelTypes if _lt.labelTypeId === _lb.labelTypeId
      _gd <- gsvData if _gd.gsvPanoramaId === _lb.gsvPanoramaId && _gd.expired === false
      _ms <- missions if _ms.missionId === _lb.missionId && _ms.userId =!= userIdString
    } yield (_lb.labelId)

    val filterUserLabels = validationLabels.filterNot(_ inSet labelsValidatedByUser)
    filterUserLabels.list.length
  }

  /**
    * Retrieve n random labels that have existing GSVPanorama.
    *
    * Starts by querying for n * 5 labels, then checks GSV API to see if each gsv_panorama_id exists until we find n.
    *
    * @param userId       User ID for the current user.
    * @param n            Number of labels we need to query.
    * @param labelTypeId  Label Type ID of labels requested.
    * @return             Seq[LabelValidationMetadata]
    */
  def retrieveLabelListForValidation(userId: UUID, n: Int, labelTypeId: Int) : Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    var selectedLabels: ListBuffer[LabelValidationMetadata] = new ListBuffer[LabelValidationMetadata]()
    var potentialLabels: List[LabelValidationMetadata] = List()
    val userIdStr = userId.toString

    while (selectedLabels.length < n) {
      val selectRandomLabelsQuery = Q.query[(String, Int, Int, String, String, Int), LabelValidationMetadata](
        """SELECT label.label_id, label_type.label_type, label.gsv_panorama_id, label_point.heading, label_point.pitch,
          |       label_point.zoom, label_point.canvas_x, label_point.canvas_y,
          |       label_point.canvas_width, label_point.canvas_height
          |FROM label
          |INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
          |INNER JOIN label_point ON label.label_id = label_point.label_id
          |INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
          |INNER JOIN mission ON label.mission_id = mission.mission_id
          |INNER JOIN (
          |    -- This subquery gets the number of times each label has been validated.
          |    SELECT label.label_id, COUNT(label_validation_id) AS validation_count
          |    FROM label
          |    LEFT JOIN label_validation ON label.label_id = label_validation.label_id
          |    WHERE label.deleted = FALSE
          |        AND (label_validation.user_id <> ? OR label_validation.user_id IS NULL)
          |    GROUP BY label.label_id
          |) counts
          |    ON label.label_id = counts.label_id
          |LEFT JOIN (
          |    -- This subquery counts how many of each users' labels have been validated for the given label type. If
          |    -- it is less than 10, then we need more validations from them in order to use them for inferring worker
          |    -- quality, and they therefore get priority.
          |    SELECT mission.user_id, COUNT(DISTINCT(label.label_id)) < 10 AS needs_validations
          |    FROM mission
          |    INNER JOIN label ON label.mission_id = mission.mission_id
          |    INNER JOIN label_validation ON label.label_id = label_validation.label_id
          |    WHERE mission.mission_type_id = 2
          |        AND label.deleted = FALSE
          |        AND label.label_type_id = ?
          |    GROUP BY mission.user_id
          |) needs_validations_query
          |    ON mission.user_id = needs_validations_query.user_id
          |WHERE label.label_type_id = ?
          |    AND label.deleted = FALSE
          |    AND label.tutorial = FALSE
          |    AND gsv_data.expired = FALSE
          |    AND mission.user_id <> ?
          |    AND label.label_id NOT IN (
          |        SELECT label_id
          |        FROM label_validation
          |        WHERE user_id = ?
          |    )
          |-- Prioritize labels that have been validated fewer times and from users who have had less than 10
          |-- validations of this label type, then randomize it.
          |ORDER BY counts.validation_count, COALESCE(needs_validations, TRUE) DESC, RANDOM()
          |LIMIT ?""".stripMargin
      )
      potentialLabels = selectRandomLabelsQuery((userIdStr, labelTypeId, labelTypeId, userIdStr, userIdStr, n * 5)).list
      var potentialStartIdx: Int = 0

      // Start looking through our n * 5 labels until we find n with valid pano id or we've gone through our n * 5 and
      // need to query for some more (which we don't expect to happen in a typical use case).
      while (selectedLabels.length < n && potentialStartIdx < potentialLabels.length) {

        val labelsNeeded: Int = n - selectedLabels.length
        val newLabels: Seq[LabelValidationMetadata] =
          potentialLabels.slice(potentialStartIdx, potentialStartIdx + labelsNeeded).par.flatMap { currLabel =>

            // If the pano exists, mark the last time we viewed it in the database, o/w mark as expired.
            if (panoExists(currLabel.gsvPanoramaId)) {
              val now = new DateTime(DateTimeZone.UTC)
              val timestamp: Timestamp = new Timestamp(now.getMillis)
              GSVDataTable.markLastViewedForPanorama(currLabel.gsvPanoramaId, timestamp)
              Some(currLabel)
            } else {
              GSVDataTable.markExpired(currLabel.gsvPanoramaId, expired = true)
              None
            }
          }.seq

        potentialStartIdx += labelsNeeded
        selectedLabels ++= newLabels
      }
    }
    selectedLabels
  }

  /**.
    * Retrieve a list of labels for validation with a random label id
    * @param userId User ID of the current user.
    * @param count  Number of labels in the list.
    * @return       Seq[LabelValidationMetadata]
    */
  def retrieveRandomLabelListForValidation(userId: UUID, count: Int) : Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    // We are currently assigning label types to missions randomly.
    val labelTypeId: Int = retrieveRandomValidationLabelTypeId()
    retrieveLabelListForValidation(userId, count, labelTypeId)
  }

  /**
    * Retrieves a random validation label type id (1, 2, 3, 4, 7).
    * @return Integer corresponding to the label type id.
    */
  def retrieveRandomValidationLabelTypeId(): Int = db.withSession { implicit session =>
    val labelTypeId: Int = labelTypeIdList(scala.util.Random.nextInt(labelTypeIdList.size))
    labelTypeId
  }

  /**
    * Retrieves a list of possible label types that the user can validate. This is determined by how
    * many labels are in the database and how many labels the user has validated.
    * @param userId               User ID of the current user.
    * @param count                Number of labels for this mission.
    * @param currentLabelTypeId   Label ID of the current mission
    * @return
    */
  def retrievePossibleLabelTypeIds(userId: UUID, count: Int, currentLabelTypeId: Option[Int]): ListBuffer[Int] = {
    val inProgress: List[Int] = MissionTable.getInProgressValidationMissions(userId, currentLabelTypeId)
    var possibleLabelTypeIds = new ListBuffer[Int]
    for (labelTypeId <- labelTypeIdList) {
      if (hasSufficientLabels(userId, labelTypeId, count) || inProgress.contains(labelTypeId)) {
        possibleLabelTypeIds += labelTypeId
      }
    }
    possibleLabelTypeIds
  }

    /**
    * Checks if the panorama associated with a label eixsts by pinging Google Maps.
    * @param gsvPanoId  Panorama ID
    * @return           True if the panorama exists, false otherwise
    */
  def panoExists(gsvPanoId: String): Boolean = {
    try {
      val now = new DateTime(DateTimeZone.UTC)
      val urlString : String = "http://maps.google.com/cbk?output=tile&panoid=" + gsvPanoId + "&zoom=1&x=0&y=0&date=" + now.getMillis
      // println("URL: " + urlString)
      val panoURL : URL = new java.net.URL(urlString)
      val connection : HttpURLConnection = panoURL.openConnection.asInstanceOf[HttpURLConnection]
      connection.setConnectTimeout(5000)
      connection.setReadTimeout(5000)
      connection.setRequestMethod("GET")
      val responseCode: Int = connection.getResponseCode
      // println("Response Code: " + responseCode)

      // URL is only valid if the response code is between 200 and 399.
      200 <= responseCode && responseCode <= 399
    } catch {
      case e: ConnectException => false
      case e: SocketException => false
      case e: Exception => false
    }

  }

  def validationLabelMetadataToJson(labelMetadata: LabelValidationMetadata): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "label_type" -> labelMetadata.labelType,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "heading" -> labelMetadata.heading,
      "pitch" -> labelMetadata.pitch,
      "zoom" -> labelMetadata.zoom,
      "canvas_x" -> labelMetadata.canvasX,
      "canvas_y" -> labelMetadata.canvasY,
      "canvas_width" -> labelMetadata.canvasWidth,
      "canvas_height" -> labelMetadata.canvasHeight
    )
  }

  /**
    * Returns a LabelMetadata object that has the label properties as well as the tags.
    *
    * @param label label from query
    * @param tags list of tags as strings
    * @return LabelMetadata object
    */
  def labelAndTagsToLabelMetadata(label: (Int, String, Boolean, Float, Float, Int, Int, Int, Int, Int, Int, String, String, Option[java.sql.Timestamp], String, String, Option[Int], Boolean, Option[String]), tags: List[String]): LabelMetadata = {
      LabelMetadata(label._1, label._2, label._3, label._4, label._5, label._6, label._7, label._8,
                    label._9,label._10,label._11,label._12,label._13,label._14,label._15,label._16,
                    label._17, label._18, label._19, tags)
  }

//  case class LabelMetadata(labelId: Int, gsvPanoramaId: String, tutorial: Boolean heading: Float, pitch: Float,
//                           zoom: Int, canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
//                           auditTaskId: Int,
//                           userId: String, username: String,
//                           timestamp: java.sql.Timestamp,
//                           labelTypeKey:String, labelTypeValue: String, severity: Option[Int],
//                           temporary: Boolean, description: Option[String])
  def labelMetadataToJson(labelMetadata: LabelMetadata): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "tutorial" -> labelMetadata.tutorial,
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
      "tags" -> labelMetadata.tags
    )
  }

  /**
    * This method returns a list of strings with all the tags associated with a label
    *
    * @param labelId Label id
    * @return A list of strings with all the tags asscociated with a label
    */
  def getTagsFromLabelId(labelId: Int): List[String] = db.withSession { implicit session =>
      val getTagsQuery = Q.query[Int, (String)](
        """SELECT tag
          |FROM sidewalk.tag
          |WHERE tag.tag_id IN
          |(
          |    SELECT tag_id
          |    FROM sidewalk.label_tag
          |    WHERE label_tag.label_id = ?
          |)""".stripMargin
      )
      getTagsQuery(labelId).list
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
      (l, s) <- _labels.leftJoin(severities).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, s.severity.?)

    val _points = for {
      (l, p) <- _slabels.leftJoin(labelPoints).on(_._1 === _.labelId)
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
      """SELECT label.label_id,
        |       label.audit_task_id,
        |       label.gsv_panorama_id,
        |       label_type.label_type,
        |       label_point.lat,
        |       label_point.lng
        |FROM sidewalk.label
        |INNER JOIN sidewalk.label_type ON label.label_type_id = label_type.label_type_id
        |INNER JOIN sidewalk.label_point ON label.label_id = label_point.label_id
        |WHERE label.deleted = false
        |    AND label_point.lat IS NOT NULL
        |    AND ST_Intersects(label_point.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))""".stripMargin
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
      """SELECT label.label_id,
        |       label.audit_task_id,
        |       label.gsv_panorama_id,
        |       label_type.label_type,
        |       label_point.lat,
        |       label_point.lng,
        |       region.region_id
        |FROM sidewalk.label
        |INNER JOIN sidewalk.label_type ON label.label_type_id = label_type.label_type_id
        |INNER JOIN sidewalk.label_point ON label.label_id = label_point.label_id
        |INNER JOIN sidewalk.audit_task ON audit_task.audit_task_id = label.audit_task_id
        |INNER JOIN sidewalk.region ON ST_Intersects(region.geom, label_point.geom)
        |WHERE label.deleted = FALSE
        |    AND label_point.lat IS NOT NULL
        |    AND region.deleted = FALSE
        |    AND region.region_type_id = 2
        |    AND audit_task.user_id = ?
        |    AND region_id = ?""".stripMargin
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
    * Returns a count of the number of labels placed on each day there were labels placed.
    *
    * @return
    */
  def selectLabelCountsPerDay: List[LabelCountPerDay] = db.withSession { implicit session =>
    val selectLabelCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date, COUNT(label_id)
        |FROM
        |(
        |    SELECT label_id, task_start::date AS calendar_date
        |    FROM audit_task
        |    INNER JOIN label ON audit_task.audit_task_id = label.audit_task_id
        |    WHERE deleted = FALSE
        |) AS calendar
        |GROUP BY calendar_date
        |ORDER BY calendar_date""".stripMargin
    )
    selectLabelCountQuery.list.map(x => LabelCountPerDay.tupled(x))
  }


  /**
    * Select label counts per user.
    *
    * @return list of tuples of (user_id, role, label_count)
    */
  def getLabelCountsPerUser: List[(String, String, Int)] = db.withSession { implicit session =>

    val audits = for {
      _user <- users if _user.username =!= "anonymous"
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      _audit <- auditTasks if _user.userId === _audit.userId
      _label <- labelsWithoutDeleted if _audit.auditTaskId === _label.auditTaskId
    } yield (_user.userId, _role.role, _label.labelId)

    // Counts the number of labels for each user by grouping by user_id and role.
    audits.groupBy(l => (l._1, l._2)).map { case ((uId, role), group) => (uId, role, group.length) }.list
  }


  /**
    * Select street_edge_id of street closest to lat/lng position
    *
    * @param lat
    * @param lng
    * @return street_edge_id
    */
  def getStreetEdgeIdClosestToLatLng(lat: Float, lng: Float): Option[Int] = db.withSession { implicit session =>
    val selectStreetEdgeIdQuery = Q.query[(Float, Float), Int](
      """SELECT s.street_edge_id FROM street_edge AS s
         |    ORDER BY ST_Distance(s.geom,ST_SetSRID(ST_MakePoint(?, ?),Find_SRID('sidewalk', 'street_edge', 'geom'))) ASC
         |LIMIT 1""".stripMargin
    )
    //NOTE: these parameters are being passed in correctly. ST_MakePoint accepts lng first, then lat.
    selectStreetEdgeIdQuery((lng, lat)).list.headOption
  }

  /**
    * Gets the labels placed in the most recent mission.
    *
    * @param regionId
    * @param userId
    * @return
    */
  def getLabelsFromCurrentAuditMission(regionId: Int, userId: UUID): List[Label] = db.withSession { implicit session =>
    val recentMissionId: Option[Int] = MissionTable.missions
        .filter(m => m.userId === userId.toString && m.regionId === regionId)
        .sortBy(_.missionStart.desc)
        .map(_.missionId).list.headOption

    recentMissionId match {
      case Some(missionId) => labelsWithoutDeleted.filter(_.missionId === missionId).list
      case None => List()
    }
  }

  /**
    * Get next temp label id to be used. That would be the max used + 1, or just 1 if no labels in this task.
    *
    * @param auditTaskId
    * @return
    */
  def nextTempLabelId(auditTaskId: Option[Int]): Int = db.withSession { implicit session =>
    labels.filter(_.auditTaskId === auditTaskId).map(_.temporaryLabelId).max.run.map(x => x + 1).getOrElse(1)
  }
}
