package models.label

import java.net.{ConnectException, HttpURLConnection, SocketException, URL}
import java.sql.Timestamp
import java.util.UUID

import com.vividsolutions.jts.geom.LineString
import models.audit.{AuditTask, AuditTaskEnvironmentTable, AuditTaskInteraction, AuditTaskTable}
import models.daos.slick.DBTableDefinitions.UserTable
import models.gsv.GSVDataTable
import models.label.LabelValidationTable._
import models.mission.{Mission, MissionTable}
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
                 turorial: Boolean)

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
                                     severity: Int,
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

  def * = (labelId, auditTaskId, missionId, gsvPanoramaId, labelTypeId, photographerHeading, photographerPitch,
    panoramaLat, panoramaLng, deleted, temporaryLabelId, timeCreated, tutorial) <> ((Label.apply _).tupled, Label.unapply)

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

  case class LabelValidationMetadata(labelId: Int, labelType: String, gsvPanoramaId: String,
                                     heading: Float, pitch: Float, zoom: Int, canvasX: Int,
                                     canvasY: Int, canvasWidth: Int, canvasHeight: Int)

  implicit val labelLocationConverter = GetResult[LabelLocation](r =>
    LabelLocation(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat))

  implicit val labelSeverityConverter = GetResult[LabelLocationWithSeverity](r =>
    LabelLocationWithSeverity(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextInt, r.nextFloat, r.nextFloat))

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
    * @param labelType          Type of label.
    * @param missionLabelCount  Number of labels in a mission
    * @return   True if we have enough labels, false otherwise.
    */
  def hasSufficientLabels(userId: UUID, labelTypeId: Int, missionLabelCount: Int): Boolean = db.withSession { implicit session =>
    val labelCount: Int = getAvailableValidationLabels(userId, labelTypeId, None)
    labelCount >= missionLabelCount
  }

  /**
    * Returns how many labels this user can validate for a given label type. Users are not allowed
    * to validate labels that they have already validated or labels that they have placed.
    * @param userId       User ID.
    * @param labelTypeId  Type of label.
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
    * Retrieves a random label that has an existing GSVPanorama.
    * Will keep querying for a random label until a suitable label has been found.
    * @param labelTypeId  Label that is retrieved from the database
    * @return LabelValidationMetadata of this label.
    */
  def retrieveSingleRandomLabelFromLabelTypeForValidation(userId: UUID, labelTypeId: Int, labelIdList: Option[ListBuffer[Int]]) : LabelValidationMetadata = db.withSession { implicit session =>
    var exists: Boolean = false
    var labelToValidate: List[(Int, String, String, Float, Float, Int, Int, Int, Int, Int)] = null
    var selectedLabels: ListBuffer[Int] = labelIdList.getOrElse(new ListBuffer[Int]())

    // TODO: add code that also checks that we havne't already chosen this label
    val userIdString = userId.toString
    val availableLabelCount: Int = getAvailableValidationLabels(userId, labelTypeId, labelIdList)
    while (!exists) {
      val r = new scala.util.Random
      val labelOffset = r.nextInt(availableLabelCount - selectedLabels.length)

      val labelsValidatedByUser = labelValidations.filter(_.userId === userIdString).map(_.labelId).list
      var validationLabels = for {
        _lb <- labels if _lb.labelTypeId === labelTypeId && _lb.deleted === false && _lb.tutorial === false
        _lt <- labelTypes if _lt.labelTypeId === _lb.labelTypeId
        _lp <- labelPoints if _lb.labelId === _lp.labelId
        _gd <- gsvData if _gd.gsvPanoramaId === _lb.gsvPanoramaId && _gd.expired === false
        _ms <- missions if _ms.missionId === _lb.missionId && _ms.userId =!= userIdString
      } yield (_lb.labelId, _lt.labelType, _lb.gsvPanoramaId, _lp.heading, _lp.pitch, _lp.zoom,
        _lp.canvasX, _lp.canvasY, _lp.canvasWidth, _lp.canvasHeight)

      validationLabels = validationLabels.filterNot(_._1 inSet labelsValidatedByUser)
      validationLabels = validationLabels.filterNot(_._1 inSet selectedLabels)

      val singleLabel = validationLabels.drop(labelOffset).take(1).list

      // Uses panorama ID to check if this panorama exists
      exists = panoExists(singleLabel(0)._3)

      if (exists) {
        labelToValidate = singleLabel
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.getMillis)
        GSVDataTable.markLastViewedForPanorama(singleLabel(0)._3, timestamp)
        selectedLabels += singleLabel(0)._1
      } else {
        GSVDataTable.markExpired(singleLabel(0)._3, true)
      }
    }
    labelToValidate.map(label => LabelValidationMetadata.tupled(label)).head
  }

  /**
    * Retrieves a list of labels to be validated
    * @param count        Length of list
    * @param labelTypeId  Label Type of each label in the list
    * @return             Seq[LabelValidationMetadata]
    */
  def retrieveLabelListForValidation(userId: UUID, count: Int, labelType: Int) : Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    var labelList = new ListBuffer[LabelValidationMetadata]()
    var labelIdList = new ListBuffer[Int]()
    for (a <- 1 to count) {
      labelList += retrieveSingleRandomLabelFromLabelTypeForValidation(userId, labelType, Some(labelIdList))
    }
    val labelSeq: Seq[LabelValidationMetadata] = labelList
    labelSeq
  }

  /**
    * Retrieve a list of labels for validation with a random label id
    * @param count  Number of labels in the list
    * @return       Seq[LabelValidationMetadata]
    */
  def retrieveRandomLabelListForValidation(userId: UUID, count: Int) : Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    // We are currently assigning label types to missions randomly.
    val labelTypeId: Int = retrieveRandomValidationLabelTypeId()
    val labelSeq: Seq[LabelValidationMetadata] = retrieveLabelListForValidation(userId, count, labelTypeId)
    labelSeq
  }

  /**
    * Retrieves a random validation label type id (1, 2, 3, 4, 7)
    * @return Integer corresponding to the label type id
    */
  def retrieveRandomValidationLabelTypeId(): Int = db.withSession { implicit session =>
    val labelTypeId: Int = labelTypeIdList(scala.util.Random.nextInt(labelTypeIdList.size))
    labelTypeId
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
    * @param userId Label id
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
    * Returns a count of the number of labels placed on each day since the tool was launched (11/17/2015).
    *
    * @return
    */
  def selectLabelCountsPerDay: List[LabelCountPerDay] = db.withSession { implicit session =>
    val selectLabelCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date::date, COUNT(label_id)
        |FROM
        |(
        |    SELECT current_date - (n || ' day')::INTERVAL AS calendar_date
        |    FROM generate_series(0, current_date - '11/17/2015') n
        |) AS calendar
        |LEFT JOIN sidewalk.audit_task ON audit_task.task_start::date = calendar_date::date
        |LEFT JOIN sidewalk.label ON label.audit_task_id = audit_task.audit_task_id
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
    audits.groupBy(l => (l._1, l._2)).map{ case ((uId, role), group) => (uId, role, group.length) }.list
  }
}
