package models.label

import java.net.{ConnectException, HttpURLConnection, SocketException, URL}
import java.sql.Timestamp
import java.util.UUID
import models.audit.{AuditTask, AuditTaskTable}
import models.daos.slick.DBTableDefinitions.UserTable
import models.gsv.GSVDataTable
import models.mission.{Mission, MissionTable, MissionTypeTable}
import models.region.RegionTable
import models.user.{RoleTable, UserRoleTable, UserStatTable}
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Play
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
                 tutorial: Boolean,
                 streetEdgeId: Int,
                 agreeCount: Int,
                 disagreeCount: Int,
                 notsureCount: Int,
                 correct: Option[Boolean])

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
                                     lat: Float,
                                     lng: Float,
                                     expired: Boolean,
                                     severity: Option[Int])

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
  def agreeCount = column[Int]("agree_count", O.NotNull)
  def disagreeCount = column[Int]("disagree_count", O.NotNull)
  def notsureCount = column[Int]("notsure_count", O.NotNull)
  def correct = column[Option[Boolean]]("correct", O.Nullable)

  def * = (labelId, auditTaskId, missionId, gsvPanoramaId, labelTypeId, photographerHeading, photographerPitch,
    panoramaLat, panoramaLng, deleted, temporaryLabelId, timeCreated, tutorial, streetEdgeId, agreeCount, disagreeCount,
    notsureCount, correct) <> ((Label.apply _).tupled, Label.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("label_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("label_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("label_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)
}

/**
 * Data access object for the label table.
 */
object LabelTable {
  import MyPostgresDriver.plainImplicits._

  val db = play.api.db.slick.DB
  val labels = TableQuery[LabelTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val gsvData = TableQuery[GSVDataTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val labelTags = TableQuery[LabelTagTable]
  val tagTable = TableQuery[TagTable]
  val labelPoints = TableQuery[LabelPointTable]
  val labelValidations = TableQuery[LabelValidationTable]
  val missions = TableQuery[MissionTable]
  val regions = TableQuery[RegionTable]
  val severities = TableQuery[LabelSeverityTable]
  val users = TableQuery[UserTable]
  val userRoles = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]
  val descriptions = TableQuery[LabelDescriptionTable]
  val temporariness = TableQuery[LabelTemporarinessTable]

  val labelsWithoutDeleted = labels.filter(_.deleted === false)
  val neighborhoods = regions.filter(_.deleted === false)

  // Grab city id of database and the associated tutorial street id for the city
  val cityStr: String = Play.configuration.getString("city-id").get
  val tutorialStreetId: Int = Play.configuration.getInt("city-params.tutorial-street-edge-id." + cityStr).get

  // Filters out the labels placed during onboarding (aka panoramas that are used during onboarding
  // Onboarding labels have to be filtered out before a user's labeling frequency is computed
  val labelsWithoutDeletedOrOnboarding = labelsWithoutDeleted.filter(_.tutorial === false)

  case class LabelCountPerDay(date: String, count: Int)

  case class LabelMetadata(labelId: Int, gsvPanoramaId: String, tutorial: Boolean, imageDate: String, heading: Float,
                           pitch: Float, zoom: Int, canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
                           auditTaskId: Int,
                           userId: String, username: String,
                           timestamp: Option[java.sql.Timestamp],
                           labelTypeKey:String, labelTypeValue: String, severity: Option[Int],
                           temporary: Boolean, description: Option[String], tags: List[String])

  case class LabelMetadataWithValidation(labelId: Int, gsvPanoramaId: String, tutorial: Boolean, imageDate: String,
                                         heading: Float, pitch: Float, zoom: Int, canvasXY: (Int, Int),
                                         canvasWidth: Int, canvasHeight: Int, auditTaskId: Int, userId: String,
                                         username: String, timestamp: Option[java.sql.Timestamp], labelTypeKey: String,
                                         labelTypeValue: String, severity: Option[Int], temporary: Boolean,
                                         description: Option[String], userValidation: Option[Int],
                                         validations: Map[String, Int], tags: List[String])

  // NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
  case class LabelValidationMetadata(labelId: Int, labelType: String, gsvPanoramaId: String, imageDate: String,
                                     timestamp: Option[java.sql.Timestamp], heading: Float, pitch: Float, zoom: Int,
                                     canvasX: Int, canvasY: Int, canvasWidth: Int, canvasHeight: Int,
                                     severity: Option[Int], temporary: Boolean, description: Option[String],
                                     userValidation: Option[Int], tags: List[String])

  case class LabelValidationMetadataWithoutTags(labelId: Int, labelType: String, gsvPanoramaId: String,
                                                imageDate: String, timestamp: Option[java.sql.Timestamp],
                                                heading: Float, pitch: Float, zoom: Int, canvasX: Int, canvasY: Int,
                                                canvasWidth: Int, canvasHeight: Int, severity: Option[Int],
                                                temporary: Boolean, description: Option[String],
                                                userValidation: Option[Int]);

  case class LabelCVMetadata(gsvPanoramaId: String, svImageX: Int, svImageY: Int,
                             labelTypeId: Int, photographerHeading: Float, heading: Float,
                             userRole: String, username: String, missionType: String, labelId: Int)

  case class MiniMapResumeMetadata(labelId: Int, labelType: String, lat: Option[Float], lng: Option[Float])

  implicit val labelMetadataConverter = GetResult[LabelMetadata](r =>
    LabelMetadata(
      r.nextInt, r.nextString, r.nextBoolean, r.nextString, r.nextFloat, r.nextFloat, r.nextInt, r.nextInt, r.nextInt,
      r.nextInt, r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextTimestampOption, r.nextString, r.nextString,
      r.nextIntOption, r.nextBoolean, r.nextStringOption,
      r.nextStringOption.map(tags => tags.split(",").toList).getOrElse(List())
    )
  )

  implicit val labelMetadataWithValidationConverter = GetResult[LabelMetadataWithValidation](r =>
    LabelMetadataWithValidation(
      r.nextInt, r.nextString, r.nextBoolean, r.nextString, r.nextFloat, r.nextFloat, r.nextInt, (r.nextInt, r.nextInt),
      r.nextInt, r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextTimestampOption, r.nextString, r.nextString,
      r.nextIntOption, r.nextBoolean, r.nextStringOption, r.nextIntOption,
      r.nextString.split(',').map(x => x.split(':')).map { y => (y(0), y(1).toInt) }.toMap,
      r.nextStringOption.map(tags => tags.split(",").toList).getOrElse(List())
    )
  )

  implicit val labelValidationMetadataWithoutTagsConverter = GetResult[LabelValidationMetadataWithoutTags](r =>
    LabelValidationMetadataWithoutTags(
      r.nextInt, r.nextString, r.nextString, r.nextString, r.nextTimestampOption, r.nextFloat, r.nextFloat, r.nextInt,
      r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextIntOption, r.nextBoolean, r.nextStringOption, r.nextIntOption
    )
  )

  implicit val labelValidationMetadataConverter = GetResult[LabelValidationMetadata](r =>
    LabelValidationMetadata(
      r.nextInt, r.nextString, r.nextString, r.nextString, r.nextTimestampOption, r.nextFloat, r.nextFloat, r.nextInt,
      r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextIntOption, r.nextBoolean, r.nextStringOption,
      r.nextIntOption, r.nextStringOption.map(tags => tags.split(",").toList).getOrElse(List())
    )
  )

  implicit val labelLocationConverter = GetResult[LabelLocation](r =>
    LabelLocation(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat))

  implicit val MiniMapResumeMetadataConverter = GetResult[MiniMapResumeMetadata](r =>
    MiniMapResumeMetadata(r.nextInt, r.nextString, r.nextFloatOption, r.nextFloatOption))

  implicit val labelSeverityConverter = GetResult[LabelLocationWithSeverity](r =>
    LabelLocationWithSeverity(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat, r.nextBoolean, r.nextIntOption))

  // Valid label type ids -- excludes Other and Occlusion labels
  val labelTypeIdList: List[Int] = List(1, 2, 3, 4, 7)

  /**
    * Find all labels with given regionId and userId.
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
    */
  def find(tempLabelId: Int, auditTaskId: Int): Option[Int] = db.withSession { implicit session =>
    val labelIds = labels.filter(x => x.temporaryLabelId === tempLabelId && x.auditTaskId === auditTaskId).map {
      label => label.labelId
    }
    labelIds.firstOption
  }

  def countLabels: Int = db.withTransaction(implicit session =>
    labels.filter(_.deleted === false).length.run
  )

  def countLabels(labelTypeString: String): Int = db.withTransaction(implicit session =>
    labels.filter(_.deleted === false).filter(_.labelTypeId === LabelTypeTable.labelTypeToId(labelTypeString)).length.run
  )

  /*
  * Counts the number of labels added today.
  *
  * If the task goes over two days, then all labels for that audit task will be added for the task end date.
  */
  def countTodayLabels: Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      """SELECT COUNT(label.label_id)
        |FROM audit_task
        |INNER JOIN label ON label.audit_task_id = audit_task.audit_task_id
        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date
        |    AND label.deleted = false""".stripMargin
    )
    countQuery.first
  }

  /*
  * Counts the number of specific label types added today.
  *
  * If the task goes over two days, then all labels for that audit task will be added for the task end date.
  */
  def countTodayLabels(labelType: String): Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[Int](
      s"""SELECT COUNT(label.label_id)
         |FROM audit_task
         |INNER JOIN label ON label.audit_task_id = audit_task.audit_task_id
         |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date
         |    AND label.deleted = false
         |    AND label.label_type_id = (
         |        SELECT label_type_id
         |        FROM label_type as lt
         |        WHERE lt.label_type='$labelType'
         |    )""".stripMargin
    )
    countQuery.first
  }

  /*
  * Counts the number of labels added during the last week.
  */
  def countPastWeekLabels: Int = db.withTransaction { implicit session =>
    val countQuery = Q.queryNA[(Int)](
      """SELECT COUNT(label.label_id)
        |FROM audit_task
        |INNER JOIN label ON label.audit_task_id = audit_task.audit_task_id
        |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
        |    AND label.deleted = false""".stripMargin
    )
    countQuery.first
  }

  /*
  * Counts the number of specific label types added during the last week.
  */
  def countPastWeekLabels(labelType: String): Int = db.withTransaction { implicit session =>
    val countQuery = Q.queryNA[Int](
      s"""SELECT COUNT(label.label_id)
         |FROM audit_task
         |INNER JOIN label ON label.audit_task_id = audit_task.audit_task_id
         |WHERE (audit_task.task_end AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
         |    AND label.deleted = false
         |    AND label.label_type_id = (
         |        SELECT label_type_id
         |        FROM label_type as lt
         |        WHERE lt.label_type='$labelType'
         |    )""".stripMargin
    )
    countQuery.first
  }

  /**
    * Returns the number of labels submitted by the given user.
    *
    * @param userId User id
    * @return A number of labels submitted by the user
    */
  def countLabels(userId: UUID): Int = db.withSession { implicit session =>
    val tasks = auditTasks.filter(_.userId === userId.toString)
    val _labels = for {
      (_tasks, _labels) <- tasks.innerJoin(labelsWithoutDeletedOrOnboarding).on(_.auditTaskId === _.auditTaskId)
    } yield _labels
    _labels.length.run
  }

  def updateDeleted(labelId: Int, deleted: Boolean): Int = db.withTransaction { implicit session =>
    val labs = labels.filter(_.labelId === labelId).map(lab => lab.deleted)
    labs.update(deleted)
  }

  /**
   * Saves a new label in the table.
   */
  def save(label: Label): Int = db.withTransaction { implicit session =>
    val labelId: Int =
      (labels returning labels.map(_.labelId)) += label
    labelId
  }

  /**
    * Returns all labels with sufficient metadata to produce crops for computer vision tasks.
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

  def retrieveLabelMetadataWithValidation(takeN: Int, userId: String): List[LabelMetadataWithValidation] = db.withSession { implicit session =>
    val selectQuery = Q.queryNA[LabelMetadataWithValidation](
      s"""SELECT lb1.label_id,
        |       lb1.gsv_panorama_id,
        |       lb1.tutorial,
        |       gsv_data.image_date,
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
        |       lb_big.description,
        |       lb_big.validation_result,
        |       val.val_counts,
        |       lb_big.tag_list
        |FROM label AS lb1,
        |     gsv_data,
        |     audit_task AS at,
        |     sidewalk_user AS u,
        |     label_point AS lp,
        |     (
        |         SELECT lb.label_id,
        |                lb.gsv_panorama_id,
        |                lbt.label_type,
        |                lbt.description AS label_type_desc,
        |                sev.severity,
        |                COALESCE(lab_temp.temporary, 'FALSE') AS temp,
        |                lab_desc.description,
        |                user_validation.validation_result,
        |                the_tags.tag_list
        |         FROM label AS lb
        |         LEFT JOIN label_type as lbt ON lb.label_type_id = lbt.label_type_id
        |         LEFT JOIN label_severity as sev ON lb.label_id = sev.label_id
        |         LEFT JOIN label_description as lab_desc ON lb.label_id = lab_desc.label_id
        |         LEFT JOIN label_temporariness as lab_temp ON lb.label_id = lab_temp.label_id
        |         LEFT JOIN (
        |             SELECT label_id, validation_result
        |             FROM label_validation
        |             WHERE user_id = '$userId'
        |         ) AS user_validation
        |             ON lb.label_id = user_validation.label_id
        |         LEFT JOIN (
        |             SELECT label_id, array_to_string(array_agg(tag.tag), ',') AS tag_list
        |             FROM label_tag
        |             INNER JOIN tag ON label_tag.tag_id = tag.tag_id
        |             GROUP BY label_id
        |         ) AS the_tags
        |             ON lb.label_id = the_tags.label_id
        |     ) AS lb_big,
        |     (
        |         SELECT label_id,
        |                CONCAT('agree:', CAST(agree_count AS TEXT),
        |                       ',disagree:', CAST(disagree_count AS TEXT),
        |                       ',unclear:', CAST(notsure_count AS TEXT)) AS val_counts
        |         FROM label
        |         WHERE label.deleted = FALSE
        |     ) AS val
        |WHERE lb1.deleted = FALSE
        |    AND lb1.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    AND lb1.audit_task_id = at.audit_task_id
        |    AND lb1.label_id = lb_big.label_id
        |    AND at.user_id = u.user_id
        |    AND lb1.label_id = lp.label_id
        |    AND lb1.label_id = val.label_id
        |ORDER BY lb1.label_id DESC
        |LIMIT ${takeN * 3}""".stripMargin
    )
    selectQuery.list
  }

  def retrieveLabelMetadata(takeN: Int, userId: String): List[LabelMetadata] = db.withSession { implicit session =>
    val selectQuery = Q.query[(String, Int), LabelMetadata](
      """SELECT lb1.label_id,
        |       lb1.gsv_panorama_id,
        |       lb1.tutorial,
        |       gsv_data.image_date,
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
        |       lb_big.description,
        |       lb_big.tag_list
        |FROM label AS lb1,
        |     gsv_data,
        |     audit_task AS at,
        |     sidewalk_user AS u,
        |     label_point AS lp,
        |     (
        |         SELECT lb.label_id,
        |                lb.gsv_panorama_id,
        |                lbt.label_type,
        |                lbt.description AS label_type_desc,
        |                sev.severity,
        |                COALESCE(lab_temp.temporary, 'FALSE') AS temp,
        |                lab_desc.description,
        |                the_tags.tag_list
        |         FROM label AS lb
        |         LEFT JOIN label_type AS lbt ON lb.label_type_id = lbt.label_type_id
        |         LEFT JOIN label_severity AS sev ON lb.label_id = sev.label_id
        |         LEFT JOIN label_description AS lab_desc ON lb.label_id = lab_desc.label_id
        |         LEFT JOIN label_temporariness AS lab_temp ON lb.label_id = lab_temp.label_id
        |         LEFT JOIN (
        |             SELECT label_id, array_to_string(array_agg(tag.tag), ',') AS tag_list
        |             FROM label_tag
        |             INNER JOIN tag ON label_tag.tag_id = tag.tag_id
        |             GROUP BY label_id
        |         ) AS the_tags
        |             ON lb.label_id = the_tags.label_id
        |     ) AS lb_big
        |WHERE u.user_id = ?
        |    AND lb1.deleted = FALSE
        |    AND lb1.tutorial = FALSE
        |    AND lb1.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    AND lb1.audit_task_id = at.audit_task_id
        |    AND lb1.label_id = lb_big.label_id
        |    AND at.user_id = u.user_id
        |    AND lb1.label_id = lp.label_id
        |ORDER BY lb1.label_id DESC
        |LIMIT ?""".stripMargin
    )
    selectQuery((userId, takeN)).list
  }

  def retrieveSingleLabelMetadata(labelId: Int, userId: String): LabelMetadataWithValidation = db.withSession { implicit session =>
    val selectQuery = Q.queryNA[LabelMetadataWithValidation](
      s"""SELECT lb1.label_id,
        |       lb1.gsv_panorama_id,
        |       lb1.tutorial,
        |       gsv_data.image_date,
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
        |       lb_big.description,
        |       lb_big.validation_result,
        |       lb_val.val_counts,
        |       lb_big.tag_list
        |FROM label AS lb1,
        |     gsv_data,
        |     audit_task AS at,
        |     sidewalk_user AS u,
        |     label_point AS lp,
        |     (
        |         SELECT CONCAT('agree:', CAST(agree_count AS TEXT),
        |                       ',disagree:', CAST(disagree_count AS TEXT),
        |                       ',unclear:', CAST(notsure_count AS TEXT)) AS val_counts
        |         FROM label
        |         WHERE label_id = $labelId
        |     ) AS lb_val,
        |     (
        |         SELECT lb.label_id,
        |                lb.gsv_panorama_id,
        |                lbt.label_type,
        |                lbt.description AS label_type_desc,
        |                sev.severity,
        |                COALESCE(lab_temp.temporary, 'FALSE') AS temp,
        |                lab_desc.description,
        |                user_validation.validation_result,
        |                the_tags.tag_list
        |         FROM label AS lb
        |         LEFT JOIN label_type AS lbt ON lb.label_type_id = lbt.label_type_id
        |         LEFT JOIN label_severity AS sev ON lb.label_id = sev.label_id
        |         LEFT JOIN label_description AS lab_desc ON lb.label_id = lab_desc.label_id
        |         LEFT JOIN label_temporariness AS lab_temp ON lb.label_id = lab_temp.label_id
        |         LEFT JOIN (
        |             SELECT label_id, validation_result
        |             FROM label_validation
        |             WHERE user_id = '$userId'
        |                 AND label_id = $labelId
        |         ) AS user_validation
        |             ON lb.label_id = user_validation.label_id
        |         LEFT JOIN (
        |             SELECT label_id, array_to_string(array_agg(tag.tag), ',') AS tag_list
        |             FROM label_tag
        |             INNER JOIN tag ON label_tag.tag_id = tag.tag_id
        |             GROUP BY label_id
        |         ) AS the_tags
        |             ON lb.label_id = the_tags.label_id
        |     ) AS lb_big
        |WHERE lb1.label_id = $labelId
        |    AND lb1.audit_task_id = at.audit_task_id
        |    AND lb1.gsv_panorama_id = gsv_data.gsv_panorama_id
        |    AND lb1.label_id = lb_big.label_id
        |    AND at.user_id = u.user_id
        |    AND lb1.label_id = lp.label_id
        |ORDER BY lb1.label_id DESC""".stripMargin
    )
    selectQuery.first
  }

  /**
    * Returns how many labels this user has available to validate for each label type.
    *
    * @return List[(label_type_id, label_count)]
    */
  def getAvailableValidationLabelsByType(userId: UUID): List[(Int, Int)] = db.withSession { implicit session =>
    val userIdString: String = userId.toString
    val labelsValidatedByUser = labelValidations.filter(_.userId === userIdString)

    // Get labels the given user has not placed that have non-expired GSV imagery.
    val labelsToValidate =  for {
      _lb <- labels if _lb.deleted === false && _lb.tutorial === false
      _gd <- gsvData if _gd.gsvPanoramaId === _lb.gsvPanoramaId && _gd.expired === false
      _ms <- missions if _ms.missionId === _lb.missionId && _ms.userId =!= userIdString
      _a <- auditTasks if _lb.auditTaskId === _a.auditTaskId && _a.streetEdgeId =!= tutorialStreetId
      _us <- UserStatTable.userStats if _ms.userId === _us.userId
      if _us.highQuality
    } yield (_lb.labelId, _lb.labelTypeId)

    // Left join with the labels that the user has already validated, then filter those out.
    val filteredLabelsToValidate = for {
      (_lab, _val) <- labelsToValidate.leftJoin(labelsValidatedByUser).on(_._1 === _.labelId)
      if _val.labelId.?.isEmpty
    } yield _lab

    // Group by the label_type_id and count.
    filteredLabelsToValidate.groupBy(_._2).map{ case (labType, group) => (labType, group.length) }.list
  }

  /**
    * Retrieve n random labels that have existing GSVPanorama.
    *
    * Starts by querying for n * 5 labels, then checks GSV API to see if each gsv_panorama_id exists until we find n.
    *
    * @param userId         User ID for the current user.
    * @param n              Number of labels we need to query.
    * @param labelTypeId    Label Type ID of labels requested.
    * @param skippedLabelId Label ID of the label that was just skipped (if applicable).
    * @return               Seq[LabelValidationMetadata]
    */
  def retrieveLabelListForValidation(userId: UUID, n: Int, labelTypeId: Int, skippedLabelId: Option[Int]): Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    var selectedLabels: ListBuffer[LabelValidationMetadata] = new ListBuffer[LabelValidationMetadata]()
    var potentialLabels: List[LabelValidationMetadata] = List()
    val userIdStr = userId.toString

    while (selectedLabels.length < n) {
      val selectRandomLabelsQuery = Q.queryNA[LabelValidationMetadata] (
        s"""SELECT label.label_id, label_type.label_type, label.gsv_panorama_id, gsv_data.image_date,
          |        label.time_created, label_point.heading, label_point.pitch, label_point.zoom, label_point.canvas_x,
          |        label_point.canvas_y, label_point.canvas_width, label_point.canvas_height, label_severity.severity,
          |        label_temporariness.temporary, label_description.description, user_validation.validation_result,
          |        the_tags.tag_list
          |FROM label
          |INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
          |INNER JOIN label_point ON label.label_id = label_point.label_id
          |INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
          |INNER JOIN mission ON label.mission_id = mission.mission_id
          |INNER JOIN user_stat ON mission.user_id = user_stat.user_id
          |INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
          |LEFT JOIN label_severity ON label.label_id = label_severity.label_id
          |LEFT JOIN label_temporariness ON label.label_id = label_temporariness.label_id
          |LEFT JOIN label_description ON label.label_id = label_description.label_id
          |LEFT JOIN (
          |    -- This subquery counts how many of each users' labels have been validated. If it's less than 50, then we
          |    -- need more validations from them in order to infer worker quality, and they therefore get priority.
          |    SELECT mission.user_id,
          |           COUNT(CASE WHEN label.correct IS NOT NULL THEN 1 END) < 50 AS needs_validations
          |    FROM mission
          |    INNER JOIN label ON label.mission_id = mission.mission_id
          |    WHERE label.deleted = FALSE
          |        AND label.tutorial = FALSE
          |    GROUP BY mission.user_id
          |) needs_validations_query ON mission.user_id = needs_validations_query.user_id
          |LEFT JOIN (
          |    -- Puts set of tag_ids associated with the label in a comma-separated list in a string.
          |    SELECT label_id, array_to_string(array_agg(tag.tag), ',') AS tag_list
          |    FROM label_tag
          |    INNER JOIN tag ON label_tag.tag_id = tag.tag_id
          |    GROUP BY label_id
          |) the_tags ON label.label_id = the_tags.label_id
          |LEFT JOIN (
          |    -- Gets the validations from this user. Since we only want them to validate labels that
          |    -- they've never validated, when we left join, we should only get nulls from this query.
          |    SELECT label_id, validation_result
          |    FROM label_validation
          |    WHERE user_id = '$userIdStr'
          |) user_validation ON label.label_id = user_validation.label_id
          |WHERE label.label_type_id = $labelTypeId
          |    AND label.deleted = FALSE
          |    AND label.tutorial = FALSE
          |    AND label.street_edge_id <> $tutorialStreetId
          |    AND audit_task.street_edge_id <> $tutorialStreetId
          |    AND gsv_data.expired = FALSE
          |    AND mission.user_id <> '$userIdStr'
          |    AND user_stat.high_quality = TRUE
          |    AND label.label_id NOT IN (
          |        SELECT label_id
          |        FROM label_validation
          |        WHERE user_id = '$userIdStr'
          |    )
          |-- Prioritize labels that have been validated fewer times and from users who have had less than 50
          |-- validations of this label type, then randomize it.
          |ORDER BY label.agree_count + label.disagree_count + label.notsure_count, COALESCE(needs_validations, TRUE) DESC, RANDOM()
          |LIMIT ${n * 5}""".stripMargin
      )
      potentialLabels = selectRandomLabelsQuery.list

      // Remove label that was just skipped (if one was skipped).
      potentialLabels = potentialLabels.filter(_.labelId != skippedLabelId.getOrElse(-1))

      // Randomize those n * 5 high priority labels to prevent repeated and similar labels in a mission.
      // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1874
      // https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1823
      potentialLabels = scala.util.Random.shuffle(potentialLabels)

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

  /**
   * Retrieves n labels of specified type, severities, and tags.
   *
   * @param labelTypeId Label type specifying what type of labels to grab.
   * @param n Number of labels to grab.
   * @param loadedLabelIds Set of labelIds already grabbed as to not grab them again.
   * @param severity  Set of severities the labels grabbed can have.
   * @param tags Set of tags the labels grabbed can have.
   * @return Seq[LabelValidationMetadata]
   */
  def getLabelsOfTypeBySeverityAndTags(labelTypeId: Int, n: Int, loadedLabelIds: Set[Int], severity: Set[Int], tags: Set[String], userId: UUID): Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    // List to return.
    val selectedLabels: ListBuffer[LabelValidationMetadata] = new ListBuffer[LabelValidationMetadata]()

    // Init random function.
    val rand = SimpleFunction.nullary[Double]("random")

    // Get deprioritized labels.
    val deprioritized = deprioritizedLabels()

    // Grab labels and associated information if severity and tags satisfy query conditions.
    val _labelsUnfiltered = for {
      _lb <- labelsWithoutDeletedOrOnboarding if !(_lb.labelId inSet deprioritized)
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
      _labeltags <- labelTags if _lb.labelId === _labeltags.labelId
      _tags <- tagTable if _labeltags.tagId === _tags.tagId && ((_tags.tag inSet tags) || tags.isEmpty)
      _a <- auditTasks if _lb.auditTaskId === _a.auditTaskId && _a.streetEdgeId =!= tutorialStreetId
      _us <- UserStatTable.userStats if _a.userId === _us.userId
      if _lb.labelTypeId === labelTypeId && _lb.streetEdgeId =!= tutorialStreetId
      if _us.highQuality
    } yield (_lb, _lp, _lt.labelType)

    // Join with severity to add severity.
    val addSeverity = for {
      (l, s) <- _labelsUnfiltered.leftJoin(severities).on(_._1.labelId === _.labelId)
    } yield (l._1, l._2, l._3, s.severity.?)

    // Filter out labels with unwanted severities.
    val _labelsWithFilteredSeverity = addSeverity.filter(label => (label._4 inSet severity) || severity.isEmpty)

    // Could be optimized by grouping on less rows.
    val _labelsGrouped = _labelsWithFilteredSeverity.groupBy(x => x).map(_._1)

    // Filter out labels already grabbed before.
    val _labels = _labelsGrouped.filter(label => !(label._1.labelId inSet loadedLabelIds))

    // Join with temporariness to add temporariness attribute.
    val addTemporariness = for {
      (l, t) <- _labels.leftJoin(temporariness).on(_._1.labelId === _.labelId)
    } yield (l._1, l._2, l._3, l._4, t.temporary.?.getOrElse(false))

    // Join with gsvData to add gsv data.
    val addGSVData = for {
      (l, e) <- addTemporariness.leftJoin(gsvData).on(_._1.gsvPanoramaId === _.gsvPanoramaId)
    } yield (l._1, l._2, l._3, l._4, l._5, e.imageDate, e.expired)

    // Remove labels with expired panos.
    val removeExpiredPanos = addGSVData.filter(_._7 === false)

    // Join with descriptions to add descriptions.
    val addDescriptions = for {
      (l, d) <- removeExpiredPanos.leftJoin(descriptions).on(_._1.labelId === _.labelId)
    } yield (l._1.labelId, l._3, l._1.gsvPanoramaId, l._6, l._1.timeCreated, l._2.heading, l._2.pitch,
             l._2.zoom, l._2.canvasX, l._2.canvasY, l._2.canvasWidth, l._2.canvasHeight, l._4, l._5, d.description.?)

    // Join with the validations that the user has given.
    val userValidations = validationsFromUser(userId)
    val addValidations = for {
      (l, v) <- addDescriptions.leftJoin(userValidations).on(_._1 === _._1)
    } yield (l._1, l._2, l._3, l._4, l._5, l._6, l._7, l._8, l._9, l._10, l._11, l._12, l._13, l._14, l._15, v._2.?)

    // Randomize and convert to LabelValidationMetadataWithoutTags.
    val newRandomLabelsList = addValidations.sortBy(x => rand).list.map(LabelValidationMetadataWithoutTags.tupled)

    var potentialStartIdx: Int = 0

    // While the desired query size has not been met and there are still possibly valid labels to consider, traverse
    // through the list incrementally and see if a potentially valid label has pano data for viewability.
    while (selectedLabels.length < n && potentialStartIdx < newRandomLabelsList.size) {
      val labelsNeeded: Int = n - selectedLabels.length
      val newLabels: Seq[LabelValidationMetadata] =
        newRandomLabelsList.slice(potentialStartIdx, potentialStartIdx + labelsNeeded).par.flatMap { currLabel =>

          // If the pano exists, mark the last time we viewed it in the database, o/w mark as expired.
          if (panoExists(currLabel.gsvPanoramaId)) {
            val now = new DateTime(DateTimeZone.UTC)
            val timestamp: Timestamp = new Timestamp(now.getMillis)
            GSVDataTable.markLastViewedForPanorama(currLabel.gsvPanoramaId, timestamp)
            val tagsToCheck = getTagsFromLabelId(currLabel.labelId)
            if (tagsToCheck.exists(tags.contains(_)) || tags.isEmpty) {
              Some(labelAndTagsToLabelValidationMetadata(currLabel, tagsToCheck))
            } else {
              None
            }
          } else {
            GSVDataTable.markExpired(currLabel.gsvPanoramaId, expired = true)
            None
          }
        }.seq
      potentialStartIdx += labelsNeeded
      selectedLabels ++= newLabels
    }
    selectedLabels
  }

  /**
   * Retrieve n random labels of assorted types.
   *
   * @param n Number of labels to grab.
   * @param loadedLabelIds Label Ids of labels already grabbed.
   * @param severity Optional set of severities the labels grabbed can have.
   * @return Seq[LabelValidationMetadata]
   */
  def getAssortedLabels(n: Int, loadedLabelIds: Set[Int], userId: UUID, severity: Option[Set[Int]] = None): Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    // List to return.
    val selectedLabels: ListBuffer[LabelValidationMetadata] = new ListBuffer[LabelValidationMetadata]()

    // Init random function.
    val rand = SimpleFunction.nullary[Double]("random")

    // Get deprioritized labels.
    val deprioritized = deprioritizedLabels()

    // Grab labels and associated information if severity and tags satisfy query conditions.
    val _labelsUnfiltered = for {
      _lb <- labelsWithoutDeletedOrOnboarding if !(_lb.labelId inSet deprioritized)
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId && (_lt.labelTypeId inSet LabelTypeTable.primaryLabelTypeIds)
      _lp <- labelPoints if _lb.labelId === _lp.labelId
      _a <- auditTasks if _lb.auditTaskId === _a.auditTaskId && _a.streetEdgeId =!= tutorialStreetId
      _us <- UserStatTable.userStats if _a.userId === _us.userId
      if _lb.streetEdgeId =!= tutorialStreetId
      if _us.highQuality
    } yield (_lb, _lp, _lt.labelType)

    // Join with severity to add severity.
    val addSeverity = for {
      (l, s) <- _labelsUnfiltered.leftJoin(severities).on(_._1.labelId === _.labelId)
    } yield (l._1, l._2, l._3, s.severity.?)

    // If severities are specified, filter by whether a label has a valid severity.
    val _labelsUnfilteredWithSeverity = severity match {
      case Some(severity) => if (severity.nonEmpty) addSeverity.filter(_._4 inSet severity) else addSeverity
      case _ => addSeverity
    }

    // Filter out labels already grabbed before.
    val _labels = _labelsUnfilteredWithSeverity.filter(label => !(label._1.labelId inSet loadedLabelIds))

    // Join with temporariness to add temporariness attribute.
    val addTemporariness = for {
      (l, t) <- _labels.leftJoin(temporariness).on(_._1.labelId === _.labelId)
    } yield (l._1, l._2, l._3, l._4, t.temporary.?.getOrElse(false))

    // Join with gsvData to add gsv data.
    val addGSVData = for {
      (l, e) <- addTemporariness.leftJoin(gsvData).on(_._1.gsvPanoramaId === _.gsvPanoramaId)
    } yield (l._1, l._2, l._3, l._4, l._5, e.imageDate, e.expired)

    // Remove labels with expired panos.
    val removeExpiredPanos = addGSVData.filter(_._7 === false)

    // Join with descriptions to add descriptions.
    val addDescriptions = for {
      (l, d) <- removeExpiredPanos.leftJoin(descriptions).on(_._1.labelId === _.labelId)
    } yield (l._1.labelId, l._3, l._1.gsvPanoramaId, l._6, l._1.timeCreated, l._2.heading, l._2.pitch,
             l._2.zoom, l._2.canvasX, l._2.canvasY, l._2.canvasWidth, l._2.canvasHeight, l._4, l._5, d.description.?)

    // Join with the validations that the user has given.
    val userValidations = validationsFromUser(userId)
    val addValidations = for {
      (l, v) <- addDescriptions.leftJoin(userValidations).on(_._1 === _._1)
    } yield (l._1, l._2, l._3, l._4, l._5, l._6, l._7, l._8, l._9, l._10, l._11, l._12, l._13, l._14, l._15, v._2.?)

    // Randomize and convert to LabelValidationMetadataWithoutTags.
    val newRandomLabelsList = addValidations.sortBy(x => rand).list.map(LabelValidationMetadataWithoutTags.tupled)

    val labelTypesAsStrings = LabelTypeTable.primaryLabelTypes

    for (labelType <- labelTypesAsStrings) {
      val labelsFilteredByType = newRandomLabelsList.filter(label => label.labelType == labelType)
      val selectedLabelsOfType: ListBuffer[LabelValidationMetadata] = new ListBuffer[LabelValidationMetadata]()
      var potentialStartIdx: Int = 0

      while (selectedLabelsOfType.length < (n / labelTypesAsStrings.size) + 1 && potentialStartIdx < labelsFilteredByType.size) {
        val labelsNeeded: Int = (n / labelTypesAsStrings.size) + 1 - selectedLabelsOfType.length
        val newLabels: Seq[LabelValidationMetadata] =
          labelsFilteredByType.slice(potentialStartIdx, potentialStartIdx + labelsNeeded).par.flatMap { currLabel =>

            // If the pano exists, mark the last time we viewed it in the database, o/w mark as expired.
            if (panoExists(currLabel.gsvPanoramaId)) {
              val now = new DateTime(DateTimeZone.UTC)
              val timestamp: Timestamp = new Timestamp(now.getMillis)
              GSVDataTable.markLastViewedForPanorama(currLabel.gsvPanoramaId, timestamp)
              Some(labelAndTagsToLabelValidationMetadata(currLabel, getTagsFromLabelId(currLabel.labelId)))
            } else {
              GSVDataTable.markExpired(currLabel.gsvPanoramaId, expired = true)
              None
            }
          }.seq
        potentialStartIdx += labelsNeeded
        selectedLabelsOfType ++= newLabels
      }
      selectedLabels ++= selectedLabelsOfType
    }
    selectedLabels
  }

  /**
   * Retrieve n random labels of a specified type.
   *
   * @param labelTypeId Label Type ID of labels requested.
   * @param n Number of labels to grab.
   * @param loadedLabelIds Label Ids of labels already grabbed.
   * @return Seq[LabelValidationMetadata]
   */
  def getLabelsByType(labelTypeId: Int, n: Int, loadedLabelIds: Set[Int], userId: UUID): Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    // List to return.
    val selectedLabels: ListBuffer[LabelValidationMetadata] = new ListBuffer[LabelValidationMetadata]()

    // Init random function.
    val rand = SimpleFunction.nullary[Double]("random")

    // Get deprioritized labels.
    val deprioritized = deprioritizedLabels()

    // Grab labels and associated information if severity and tags satisfy query conditions.
    val _labelsUnfiltered = for {
      _lb <- labelsWithoutDeletedOrOnboarding if !(_lb.labelId inSet deprioritized)
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
      _a <- auditTasks if _lb.auditTaskId === _a.auditTaskId && _a.streetEdgeId =!= tutorialStreetId
      _us <- UserStatTable.userStats if _a.userId === _us.userId
      if _lb.labelTypeId === labelTypeId && _lb.streetEdgeId =!= tutorialStreetId
      if _us.highQuality
    } yield (_lb, _lp, _lt.labelType)

    // Filter out labels already grabbed before.
    val _labels = _labelsUnfiltered.filter(label => !(label._1.labelId inSet loadedLabelIds))

    // Join with severity to add severity.
    val addSeverity = for {
      (l, s) <- _labels.leftJoin(severities).on(_._1.labelId === _.labelId)
    } yield (l._1, l._2, l._3, s.severity.?)

    // Join with temporariness to add temporariness attribute.
    val addTemporariness = for {
      (l, t) <- addSeverity.leftJoin(temporariness).on(_._1.labelId === _.labelId)
    } yield (l._1, l._2, l._3, l._4, t.temporary.?.getOrElse(false))

    // Join with gsvData to add gsv data.
    val addGSVData = for {
      (l, e) <- addTemporariness.leftJoin(gsvData).on(_._1.gsvPanoramaId === _.gsvPanoramaId)
    } yield (l._1, l._2, l._3, l._4, l._5, e.imageDate, e.expired)

    // Remove labels with expired panos.
    val removeExpiredPanos = addGSVData.filter(_._7 === false)

     // Join with descriptions to add descriptions.
    val addDescriptions = for {
      (l, d) <- removeExpiredPanos.leftJoin(descriptions).on(_._1.labelId === _.labelId)
    } yield (l._1.labelId, l._3, l._1.gsvPanoramaId, l._6, l._1.timeCreated, l._2.heading, l._2.pitch,
             l._2.zoom, l._2.canvasX, l._2.canvasY, l._2.canvasWidth, l._2.canvasHeight, l._4, l._5, d.description.?)

    // Join with the validations that the user has given.
    val userValidations = validationsFromUser(userId)
    val addValidations = for {
      (l, v) <- addDescriptions.leftJoin(userValidations).on(_._1 === _._1)
    } yield (l._1, l._2, l._3, l._4, l._5, l._6, l._7, l._8, l._9, l._10, l._11, l._12, l._13, l._14, l._15, v._2.?)

    // Randomize and convert to LabelValidationMetadataWithoutTags.
    val newRandomLabelsList = addValidations.sortBy(x => rand).list.map(LabelValidationMetadataWithoutTags.tupled)

    var potentialStartIdx: Int = 0

    // While the desired query size has not been met and there are still possibly valid labels to consider, traverse
    // through the list incrementally and see if a potentially valid label has pano data for viewability.
    while (selectedLabels.length < n && potentialStartIdx < newRandomLabelsList.size) {
      val labelsNeeded: Int = n - selectedLabels.length
      val newLabels: Seq[LabelValidationMetadata] =
        newRandomLabelsList.slice(potentialStartIdx, potentialStartIdx + labelsNeeded).par.flatMap { currLabel =>

          // If the pano exists, mark the last time we viewed it in the database, o/w mark as expired.
          if (panoExists(currLabel.gsvPanoramaId)) {
            val now = new DateTime(DateTimeZone.UTC)
            val timestamp: Timestamp = new Timestamp(now.getMillis)
            GSVDataTable.markLastViewedForPanorama(currLabel.gsvPanoramaId, timestamp)
            Some(labelAndTagsToLabelValidationMetadata(currLabel, getTagsFromLabelId(currLabel.labelId)))
          } else {
            GSVDataTable.markExpired(currLabel.gsvPanoramaId, expired = true)
            None
          }
        }.seq

      potentialStartIdx += labelsNeeded
      selectedLabels ++= newLabels
    }
    selectedLabels
  }

  /**
   * A query to get all validations by the given user.
   *
   * @param userId
   * @return A query with the integer columns label_id and validation_result
   */
  def validationsFromUser(userId: UUID): Query[(Column[Int], Column[Int]), (Int, Int), Seq] = {
    labelValidations.filter(_.userId === userId.toString).map(v => (v.labelId, v.validationResult))
  }

  /**
    * Returns a LabelValidationMetadata object that has the label properties as well as the tags.
    *
    * @param label label from query
    * @param tags list of tags as strings
    * @return LabelValidationMetadata object
    */
  def labelAndTagsToLabelValidationMetadata(label: LabelValidationMetadataWithoutTags, tags: List[String]): LabelValidationMetadata = {
      LabelValidationMetadata(
        label.labelId, label.labelType, label.gsvPanoramaId, label.imageDate, label.timestamp, label.heading,
        label.pitch, label.zoom, label.canvasX, label.canvasY, label.canvasWidth, label.canvasHeight, label.severity,
        label.temporary, label.description, label.userValidation, tags
      )
  }

  /**
    * Retrieves a list of possible label types that the user can validate.
    *
    * We do this by getting the number of labels available to validate for each label type. We then filter out label
    * types with less than 10 labels to validate (the size of a validation mission), and we filter for labels in our
    * labelTypeIdList (the main label types that we ask users to validate).
    *
    * @param userId               User ID of the current user.
    * @param count                Number of labels for this mission.
    * @param currentLabelTypeId   Label ID of the current mission
    */
  def retrievePossibleLabelTypeIds(userId: UUID, count: Int, currentLabelTypeId: Option[Int]): List[Int] = {
    getAvailableValidationLabelsByType(userId).filter(_._2 > count * 2).map(_._1).filter(labelTypeIdList.contains(_))
  }

    /**
    * Checks if the panorama associated with a label exists by pinging Google Maps.
    *
    * @param gsvPanoId  Panorama ID
    * @return           True if the panorama exists, false otherwise
    */
  def panoExists(gsvPanoId: String): Boolean = {
    try {
      val now = new DateTime(DateTimeZone.UTC)
      val urlString : String = "http://maps.google.com/cbk?output=tile&panoid=" + gsvPanoId + "&zoom=1&x=0&y=0&date=" + now.getMillis
      val panoURL : URL = new java.net.URL(urlString)
      val connection : HttpURLConnection = panoURL.openConnection.asInstanceOf[HttpURLConnection]
      connection.setConnectTimeout(5000)
      connection.setReadTimeout(5000)
      connection.setRequestMethod("GET")
      val responseCode: Int = connection.getResponseCode

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
      "image_date" -> labelMetadata.imageDate,
      "label_timestamp" -> labelMetadata.timestamp,
      "heading" -> labelMetadata.heading,
      "pitch" -> labelMetadata.pitch,
      "zoom" -> labelMetadata.zoom,
      "canvas_x" -> labelMetadata.canvasX,
      "canvas_y" -> labelMetadata.canvasY,
      "canvas_width" -> labelMetadata.canvasWidth,
      "canvas_height" -> labelMetadata.canvasHeight,
      "severity" -> labelMetadata.severity,
      "temporary" -> labelMetadata.temporary,
      "description" -> labelMetadata.description,
      "user_validation" -> labelMetadata.userValidation.map(LabelValidationTable.validationOptions.get),
      "tags" -> labelMetadata.tags
    )
  }

  def labelMetadataWithValidationToJsonAdmin(labelMetadata: LabelMetadataWithValidation): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "tutorial" -> labelMetadata.tutorial,
      "image_date" -> labelMetadata.imageDate,
      "heading" -> labelMetadata.heading,
      "pitch" -> labelMetadata.pitch,
      "zoom" -> labelMetadata.zoom,
      "canvas_x" -> labelMetadata.canvasXY._1,
      "canvas_y" -> labelMetadata.canvasXY._2,
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
      "user_validation" -> labelMetadata.userValidation.map(LabelValidationTable.validationOptions.get),
      "num_agree" -> labelMetadata.validations("agree"),
      "num_disagree" -> labelMetadata.validations("disagree"),
      "num_unsure" -> labelMetadata.validations("unclear"),
      "tags" -> labelMetadata.tags
    )
  }
  // Has the label metadata excluding username, user_id, and audit_task_id.
  def labelMetadataWithValidationToJson(labelMetadata: LabelMetadataWithValidation): JsObject = {
    Json.obj(
      "label_id" -> labelMetadata.labelId,
      "gsv_panorama_id" -> labelMetadata.gsvPanoramaId,
      "tutorial" -> labelMetadata.tutorial,
      "image_date" -> labelMetadata.imageDate,
      "heading" -> labelMetadata.heading,
      "pitch" -> labelMetadata.pitch,
      "zoom" -> labelMetadata.zoom,
      "canvas_x" -> labelMetadata.canvasXY._1,
      "canvas_y" -> labelMetadata.canvasXY._2,
      "canvas_width" -> labelMetadata.canvasWidth,
      "canvas_height" -> labelMetadata.canvasHeight,
      "timestamp" -> labelMetadata.timestamp,
      "label_type_key" -> labelMetadata.labelTypeKey,
      "label_type_value" -> labelMetadata.labelTypeValue,
      "severity" -> labelMetadata.severity,
      "temporary" -> labelMetadata.temporary,
      "description" -> labelMetadata.description,
      "user_validation" -> labelMetadata.userValidation.map(LabelValidationTable.validationOptions.get),
      "num_agree" -> labelMetadata.validations("agree"),
      "num_disagree" -> labelMetadata.validations("disagree"),
      "num_unsure" -> labelMetadata.validations("unclear"),
      "tags" -> labelMetadata.tags
    )
  }

  /**
    * This method returns a list of strings with all the tags associated with a label
    *
    * @return A list of strings with all the tags associated with a label.
    */
  def getTagsFromLabelId(labelId: Int): List[String] = db.withSession { implicit session =>
      val getTagsQuery = Q.query[Int, (String)](
        """SELECT tag
          |FROM tag
          |WHERE tag.tag_id IN
          |(
          |    SELECT tag_id
          |    FROM label_tag
          |    WHERE label_tag.label_id = ?
          |)""".stripMargin
      )
      getTagsQuery(labelId).list
  }

  /*
   * Retrieve label metadata for a labelId.
   */
  def getLabelMetadata(labelId: Int, userId: String): LabelMetadataWithValidation = db.withSession { implicit session =>
    retrieveSingleLabelMetadata(labelId, userId)
  }

  /*
   * Retrieves label and its metadata.
   */
  def getRecentLabelMetadataWithValidations(n: Int, userId: String): List[LabelMetadataWithValidation] = db.withSession { implicit session =>
    retrieveLabelMetadataWithValidation(n, userId)
  }

  /*
   * Retrieves label by user and its metadata.
   */
  def getRecentLabelMetadata(n: Int, userId: String): List[LabelMetadata] = db.withSession { implicit session =>
    retrieveLabelMetadata(n, userId)
  }

  /**
    * Returns all the submitted labels.
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
    * Returns all the submitted labels with their severities included.
    */
  def selectLocationsAndSeveritiesOfLabels: List[LabelLocationWithSeverity] = db.withSession { implicit session =>
    val _labels = for {
      _l <- labelsWithoutDeleted
      _lType <- labelTypes if _l.labelTypeId === _lType.labelTypeId
      _lPoint <- labelPoints if _l.labelId === _lPoint.labelId
      _gsv <- gsvData if _l.gsvPanoramaId === _gsv.gsvPanoramaId
      if _lPoint.lat.isDefined && _lPoint.lng.isDefined // Make sure they are NOT NULL so we can safely use .get later.
    } yield (_l.labelId, _l.auditTaskId, _l.gsvPanoramaId, _lType.labelType, _lPoint.lat, _lPoint.lng, _gsv.expired)

    val _labelsWithSeverity = for {
      (l, s) <- _labels.leftJoin(severities).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, l._5.get, l._6.get, l._7, s.severity.?)

    _labelsWithSeverity.list.map(LabelLocationWithSeverity.tupled)
  }

  /**
    * Retrieve Label Locations within a given bounding box.
    */
  def selectLocationsOfLabelsIn(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double): List[LabelLocation] = db.withSession { implicit session =>
    val selectLabelLocationQuery = Q.query[(Double, Double, Double, Double), LabelLocation](
      """SELECT label.label_id,
        |       label.audit_task_id,
        |       label.gsv_panorama_id,
        |       label_type.label_type,
        |       label_point.lat,
        |       label_point.lng
        |FROM label
        |INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
        |INNER JOIN label_point ON label.label_id = label_point.label_id
        |WHERE label.deleted = false
        |    AND label_point.lat IS NOT NULL
        |    AND ST_Intersects(label_point.geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))""".stripMargin
    )
    selectLabelLocationQuery((minLng, minLat, maxLng, maxLat)).list
  }

  /**
   * Returns a list of labels submitted by the given user.
   */
  def getLabelLocations(userId: UUID): List[LabelLocation] = db.withSession { implicit session =>
    val _labels = for {
      ((_auditTasks, _labels), _labelTypes) <- auditTasks leftJoin labelsWithoutDeletedOrOnboarding on(_.auditTaskId === _.auditTaskId) leftJoin labelTypes on (_._2.labelTypeId === _.labelTypeId)
      if _auditTasks.userId === userId.toString
    } yield (_labels.labelId, _labels.auditTaskId, _labels.gsvPanoramaId, _labelTypes.labelType, _labels.panoramaLat, _labels.panoramaLng)

    val _points = for {
      (l, p) <- _labels.innerJoin(labelPoints).on(_._1 === _.labelId)
    } yield (l._1, l._2, l._3, l._4, p.lat.getOrElse(0.toFloat), p.lng.getOrElse(0.toFloat))

    val labelLocationList: List[LabelLocation] = _points.list.map(label => LabelLocation(label._1, label._2, label._3, label._4, label._5, label._6))
    labelLocationList
  }

  def getLabelLocations(userId: UUID, regionId: Int): List[LabelLocation] = db.withSession { implicit session =>
    val selectQuery = Q.query[(String, Int), LabelLocation](
      """SELECT label.label_id,
        |       label.audit_task_id,
        |       label.gsv_panorama_id,
        |       label_type.label_type,
        |       label_point.lat,
        |       label_point.lng,
        |       region.region_id
        |FROM label
        |INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
        |INNER JOIN label_point ON label.label_id = label_point.label_id
        |INNER JOIN audit_task ON audit_task.audit_task_id = label.audit_task_id
        |INNER JOIN region ON ST_Intersects(region.geom, label_point.geom)
        |WHERE label.deleted = FALSE
        |    AND label_point.lat IS NOT NULL
        |    AND region.deleted = FALSE
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
    * Select street_edge_id of street closest to lat/lng position.
    *
    * @return street_edge_id
    */
  def getStreetEdgeIdClosestToLatLng(lat: Float, lng: Float): Option[Int] = db.withSession { implicit session =>
    val selectStreetEdgeIdQuery = Q.query[(Float, Float), Int](
      """SELECT s.street_edge_id FROM street_edge AS s
         |    ORDER BY ST_Distance(s.geom, ST_SetSRID(ST_MakePoint(?, ?), 4326)) ASC
         |LIMIT 1""".stripMargin
    )
    //NOTE: these parameters are being passed in correctly. ST_MakePoint accepts lng first, then lat.
    selectStreetEdgeIdQuery((lng, lat)).firstOption
  }

  /**
    * Gets the labels placed in the most recent mission.
    */
  def getLabelsFromCurrentAuditMission(regionId: Int, userId: UUID): List[Label] = db.withSession { implicit session =>
    val recentMissionId: Option[Int] = MissionTable.missions
        .filter(m => m.userId === userId.toString && m.regionId === regionId)
        .sortBy(_.missionStart.desc)
        .map(_.missionId).firstOption

    recentMissionId match {
      case Some(missionId) => labelsWithoutDeleted.filter(_.missionId === missionId).list
      case None => List()
    }
  }

  /**
    * Get next temp label id to be used. That would be the max used + 1, or just 1 if no labels in this task.
    */
  def nextTempLabelId(auditTaskId: Option[Int]): Int = db.withSession { implicit session =>
    labels.filter(_.auditTaskId === auditTaskId).map(_.temporaryLabelId).max.run.map(x => x + 1).getOrElse(1)
  }

  def deprioritizedLabels(): Set[Int] = db.withSession { implicit session =>
    // Get set of deprioritized labels (to not show) by filtering out those that have been validated as "disagree" 3 or
    // more times and have twice as many disagrees as agrees.
    Q.queryNA[(Int)](
      """SELECT label.label_id
        |FROM label
        |INNER JOIN label_validation ON label.label_id = label_validation.label_id
        |GROUP BY label.label_id
        |HAVING COUNT(CASE WHEN validation_result = 2 THEN 1 END) > 2 
        |   AND COUNT(CASE WHEN validation_result = 2 THEN 1 END) >= (2 * COUNT(CASE WHEN validation_result = 1 THEN 1 END))""".stripMargin
    ).list.toSet
  }
}
