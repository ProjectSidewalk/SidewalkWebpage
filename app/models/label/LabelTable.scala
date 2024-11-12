package models.label

import controllers.{APIBBox, BatchableAPIType}
import controllers.helper.GoogleMapsHelper
import formats.json.APIFormats
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import java.sql.Timestamp
import java.util.UUID
import models.audit.{AuditTask, AuditTaskTable}
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.GSVDataTable
import models.mission.{Mission, MissionTable}
import models.region.RegionTable
import models.attribute.ConfigTable
import models.route.RouteStreetTable
import models.street.{StreetEdgeRegionTable, StreetEdgeTable}
import models.user.{RoleTable, UserRoleTable, UserStatTable, VersionTable}
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import models.utils.CommonUtils.ordered
import models.validation.ValidationTaskCommentTable
import play.api.Play
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson.LatLng
import java.io.InputStream
import java.time.Instant
import scala.collection.mutable.ListBuffer
import scala.slick.jdbc.{GetResult, StaticQuery => Q}
import scala.slick.lifted.ForeignKeyQuery

case class Label(labelId: Int, auditTaskId: Int, missionId: Int, userId: String, gsvPanoramaId: String,
                 labelTypeId: Int, deleted: Boolean, temporaryLabelId: Int, timeCreated: Timestamp, tutorial: Boolean,
                 streetEdgeId: Int, agreeCount: Int, disagreeCount: Int, unsureCount: Int, correct: Option[Boolean],
                 severity: Option[Int], temporary: Boolean, description: Option[String], tags: List[String])

case class LabelValidationInfo(agreeCount: Int, disagreeCount: Int, unsureCount: Int, correct: Option[Boolean])
case class POV(heading: Double, pitch: Double, zoom: Int)
case class Dimensions(width: Int, height: Int)
case class LocationXY(x: Int, y: Int)

case class LabelLocation(labelId: Int, auditTaskId: Int, gsvPanoramaId: String, labelType: String, lat: Float, lng: Float, correct: Option[Boolean], hasValidations: Boolean)

case class LabelLocationWithSeverity(labelId: Int, auditTaskId: Int, labelType: String, lat: Float, lng: Float,
                                     correct: Option[Boolean], hasValidations: Boolean, expired: Boolean,
                                     highQualityUser: Boolean, severity: Option[Int])

case class LabelSeverityStats(n: Int, nWithSeverity: Int, severityMean: Option[Float], severitySD: Option[Float])
case class LabelAccuracy(n: Int, nAgree: Int, nDisagree: Int, accuracy: Option[Float])
case class ProjectSidewalkStats(launchDate: String, avgTimestampLast100Labels: String, kmExplored: Float,
                                kmExploreNoOverlap: Float, nUsers: Int, nExplorers: Int, nValidators: Int,
                                nRegistered: Int, nAnon: Int, nTurker: Int, nResearcher: Int, nLabels: Int,
                                severityByLabelType: Map[String, LabelSeverityStats], nValidations: Int,
                                accuracyByLabelType: Map[String, LabelAccuracy])
case class LabelTypeValidationsLeft(labelTypeId: Int, validationsAvailable: Int, validationsNeeded: Int)

class LabelTable(tag: slick.lifted.Tag) extends Table[Label](tag, "label") {
  def labelId = column[Int]("label_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId = column[Int]("audit_task_id", O.NotNull)
  def missionId = column[Int]("mission_id", O.NotNull)
  def userId = column[String]("user_id", O.NotNull)
  def gsvPanoramaId = column[String]("gsv_panorama_id", O.NotNull)
  def labelTypeId = column[Int]("label_type_id", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)
  def temporaryLabelId = column[Int]("temporary_label_id", O.NotNull)
  def timeCreated = column[Timestamp]("time_created", O.NotNull)
  def tutorial = column[Boolean]("tutorial", O.NotNull)
  def streetEdgeId = column[Int]("street_edge_id", O.NotNull)
  def agreeCount = column[Int]("agree_count", O.NotNull)
  def disagreeCount = column[Int]("disagree_count", O.NotNull)
  def unsureCount = column[Int]("unsure_count", O.NotNull)
  def correct = column[Option[Boolean]]("correct", O.Nullable)
  def severity = column[Option[Int]]("severity", O.Nullable)
  def temporary = column[Boolean]("temporary", O.NotNull)
  def description = column[Option[String]]("description", O.Nullable)
  def tags = column[List[String]]("tags", O.NotNull, O.Default(List()))

  def * = (labelId, auditTaskId, missionId, userId, gsvPanoramaId, labelTypeId, deleted,
    temporaryLabelId, timeCreated, tutorial, streetEdgeId, agreeCount, disagreeCount, unsureCount, correct, severity,
    temporary, description, tags) <> ((Label.apply _).tupled, Label.unapply)

  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
    foreignKey("label_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTable])(_.auditTaskId)

  def mission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("label_mission_id_fkey", missionId, TableQuery[MissionTable])(_.missionId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("label_user_id_fkey", userId, TableQuery[UserTable])(_.userId)

  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
    foreignKey("label_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTable])(_.labelTypeId)
}

/**
 * Data access object for the label table.
 */
object LabelTable {
  import MyPostgresDriver.plainImplicits._

  val db = play.api.db.slick.DB
  val labelsUnfiltered = TableQuery[LabelTable]
  val auditTasks = TableQuery[AuditTaskTable]
  val gsvData = TableQuery[GSVDataTable]
  val labelTypes = TableQuery[LabelTypeTable]
  val tagTable = TableQuery[TagTable]
  val labelPoints = TableQuery[LabelPointTable]
  val labelValidations = TableQuery[LabelValidationTable]
  val missions = TableQuery[MissionTable]
  val streets = TableQuery[StreetEdgeTable]
  val regions = TableQuery[RegionTable]
  val users = TableQuery[UserTable]
  val userRoles = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]

  val neighborhoods = regions.filter(_.deleted === false)

  // Grab the tutorial street id for the city.
  val tutorialStreetId: Int = ConfigTable.getTutorialStreetId

  // This subquery gets the most commonly accessed set of labels. It removes labels that have been deleted, labels from
  // the tutorial, and labels from users where `excluded=TRUE` in the `user_stat` table.
  val labels = labelsUnfiltered
    .innerJoin(auditTasks).on(_.auditTaskId === _.auditTaskId)
    .innerJoin(UserStatTable.userStats).on(_._2.userId === _.userId)
    .filterNot { case ((_l, _at), _us) =>
      _l.deleted || _l.tutorial || _l.streetEdgeId === tutorialStreetId || _at.streetEdgeId === tutorialStreetId ||
        _us.excluded
    }.map(_._1._1)

  // Subquery for labels without deleted or tutorial ones, but includes "excluded" users. You might need to include
  // these users if you're displaying a page for one of those users (like the user dashboard).
  val labelsWithExcludedUsers = labelsUnfiltered
    .innerJoin(auditTasks).on(_.auditTaskId === _.auditTaskId)
    .filterNot { case (_l, _at) =>
      _l.deleted || _l.tutorial || _l.streetEdgeId === tutorialStreetId || _at.streetEdgeId === tutorialStreetId
    }.map(_._1)

  // Subquery for labels without deleted ones, but includes tutorial labels and labels from "excluded" users. You might
  // need to include these users if you're displaying a page for one of those users (like the user dashboard).
  val labelsWithTutorialAndExcludedUsers = labelsUnfiltered.filter(_.deleted === false)

  // Subquery for labels without deleted ones or labels from "excluded" users, but includes tutorial labels.
  val labelsWithTutorial = labelsUnfiltered
    .innerJoin(UserStatTable.userStats).on(_.userId === _.userId)
    .filterNot { case (_l, _us) => _l.deleted || _us.excluded }
    .map(_._1)

  // Defines some common fields for a label metadata, which allows us to create generic functions using these fields.
  trait BasicLabelMetadata {
    val labelId: Int
    val labelType: String
    val gsvPanoramaId: String
    val heading: Float
    val pitch: Float
    val zoom: Int
  }

  case class LabelCountPerDay(date: String, count: Int)

  case class LabelMetadata(labelId: Int, gsvPanoramaId: String, tutorial: Boolean, imageCaptureDate: String,
                           pov: POV, canvasXY: LocationXY, auditTaskId: Int, streetEdgeId: Int, regionId: Int,
                           userId: String, username: String, timestamp: java.sql.Timestamp, labelTypeKey: String,
                           labelTypeValue: String, severity: Option[Int], temporary: Boolean,
                           description: Option[String], userValidation: Option[Int], validations: Map[String, Int],
                           tags: List[String], lowQualityIncompleteStaleFlags: (Boolean, Boolean, Boolean),
                           comments: Option[List[String]])
  implicit val labelMetadataWithValidationConverter = GetResult[LabelMetadata](r =>
    LabelMetadata(
      r.nextInt, r.nextString, r.nextBoolean, r.nextString, POV(r.nextDouble, r.nextDouble, r.nextInt),
      LocationXY(r.nextInt, r.nextInt), r.nextInt, r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextTimestamp,
      r.nextString, r.nextString, r.nextIntOption, r.nextBoolean, r.nextStringOption, r.nextIntOption,
      r.nextString.split(',').map(x => x.split(':')).map { y => (y(0), y(1).toInt) }.toMap,
      r.nextString.split(",").filter(_.nonEmpty).toList, (r.nextBoolean, r.nextBoolean, r.nextBoolean),
      r.nextStringOption.filter(_.nonEmpty).map(_.split(":").filter(_.nonEmpty).toList)
    )
  )

  case class LabelMetadataUserDash(labelId: Int, gsvPanoramaId: String, heading: Float, pitch: Float, zoom: Int,
                                   canvasX: Int, canvasY: Int, labelType: String,
                                   timeValidated: Option[java.sql.Timestamp], validatorComment: Option[String]) extends BasicLabelMetadata

  // NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
  case class LabelValidationMetadata(labelId: Int, labelType: String, gsvPanoramaId: String, imageCaptureDate: String,
                                     timestamp: java.sql.Timestamp, lat: Float, lng: Float, heading: Float,
                                     pitch: Float, zoom: Int, canvasXY: LocationXY, severity: Option[Int],
                                     temporary: Boolean, description: Option[String], streetEdgeId: Int, regionId: Int,
                                     validationInfo: LabelValidationInfo, userValidation: Option[Int],
                                     tags: List[String]) extends BasicLabelMetadata
  implicit val labelValidationMetadataConverter = GetResult[LabelValidationMetadata](r =>
    LabelValidationMetadata(
      r.nextInt, r.nextString, r.nextString, r.nextString, r.nextTimestamp, r.nextFloat, r.nextFloat, r.nextFloat,
      r.nextFloat, r.nextInt, LocationXY(r.nextInt, r.nextInt), r.nextIntOption, r.nextBoolean, r.nextStringOption, r.nextInt,
      r.nextInt, LabelValidationInfo(r.nextInt, r.nextInt, r.nextInt, r.nextBooleanOption), r.nextIntOption,
      r.nextStringOption.map(tags => tags.split(",").filter(_.nonEmpty).toList).getOrElse(List())
    )
  )

  // Extra data to include with validations for Admin Validate. Includes usernames and previous validators.
  case class AdminValidationData(labelId: Int, username: String, previousValidations: List[(String, Int)])

  case class ResumeLabelMetadata(labelData: Label, labelType: String, pointData: LabelPoint, panoLat: Option[Float],
                                 panoLng: Option[Float], cameraHeading: Option[Float], cameraPitch: Option[Float],
                                 panoWidth: Option[Int], panoHeight: Option[Int])

  case class LabelCVMetadata(labelId: Int, panoId: String, labelTypeId: Int, agreeCount: Int, disagreeCount: Int,
                             unsureCount: Int, panoWidth: Option[Int], panoHeight: Option[Int], panoX: Int, panoY: Int,
                             canvasWidth: Int, canvasHeight: Int, canvasX: Int, canvasY: Int, zoom: Int, heading: Float,
                             pitch: Float, cameraHeading: Float, cameraPitch: Float)

  case class LabelAllMetadata(labelId: Int, userId: String, panoId: String, labelType: String, severity: Option[Int],
                              tags: List[String], temporary: Boolean, description: Option[String], geom: LatLng,
                              timeCreated: Timestamp, streetEdgeId: Int, osmStreetId: Long, neighborhoodName: String,
                              validationInfo: LabelValidationInfo, validations: List[(String, Int)], auditTaskId: Int,
                              missionId: Int, imageCaptureDate: String, pov: POV, canvasXY: LocationXY,
                              panoLocation: (LocationXY, Option[Dimensions]), cameraHeadingPitch: (Double, Double)) extends BatchableAPIType {
    val gsvUrl = s"""https://maps.googleapis.com/maps/api/streetview?
                    |size=${LabelPointTable.canvasWidth}x${LabelPointTable.canvasHeight}
                    |&pano=${panoId}
                    |&heading=${pov.heading}
                    |&pitch=${pov.pitch}
                    |&fov=${GoogleMapsHelper.getFov(pov.zoom)}
                    |&key=YOUR_API_KEY
                    |&signature=YOUR_SIGNATURE""".stripMargin.replaceAll("\n", "")
    def toJSON: JsObject = APIFormats.rawLabelMetadataToJSON(this)
    def toCSVRow: String = APIFormats.rawLabelMetadataToCSVRow(this)
    // These make the fields easier to access from Java when making Shapefiles (Booleans and Option types are an issue).
    val panoWidth: Option[Int] = panoLocation._2.map(_.width)
    val panoHeight: Option[Int] = panoLocation._2.map(_.height)
    val correcStr: Option[String] = validationInfo.correct.map(_.toString)
  }
  object LabelAllMetadata {
    val csvHeader: String = {
      "Label ID,Latitude,Longitude,User ID,Panorama ID,Label Type,Severity,Tags,Temporary,Description,Label Date," +
        "Street ID,OSM Street ID,Neighborhood Name,Correct,Agree Count,Disagree Count,Unsure Count,Validations," +
        "Task ID,Mission ID,Image Capture Date,Heading,Pitch,Zoom,Canvas X,Canvas Y,Canvas Width,Canvas Height," +
        "GSV URL,Panorama X,Panorama Y,Panorama Width,Panorama Height,Panorama Heading,Panorama Pitch"
    }
  }
  implicit val labelAllMetadataConverter = GetResult[LabelAllMetadata](r => LabelAllMetadata(
    r.nextInt, r.nextString, r.nextString, r.nextString, r.nextIntOption,
    r.nextStringOption.map(tags => tags.split(",").filter(_.nonEmpty).toList).getOrElse(List()), r.nextBoolean,
    r.nextStringOption, LatLng(r.nextDouble, r.nextDouble), r.nextTimestamp, r.nextInt, r.nextLong, r.nextString,
    LabelValidationInfo(r.nextInt, r.nextInt, r.nextInt, r.nextBooleanOption),
    r.nextStringOption.map(_.split(",").map(v => (v.split(":")(0), v.split(":")(1).toInt)).toList).getOrElse(List()),
    r.nextInt, r.nextInt, r.nextString, POV(r.nextDouble, r.nextDouble, r.nextInt), LocationXY(r.nextInt, r.nextInt),
    (LocationXY(r.nextInt, r.nextInt), r.nextIntOption.flatMap(w => r.nextIntOption.map(h => Dimensions(w, h)))),
    (r.nextDouble, r.nextDouble)
  ))

  implicit val labelLocationConverter = GetResult[LabelLocation](r =>
    LabelLocation(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat, r.nextBooleanOption, r.nextBoolean))

  implicit val labelSeverityConverter = GetResult[LabelLocationWithSeverity](r =>
    LabelLocationWithSeverity(r.nextInt, r.nextInt, r.nextString, r.nextFloat, r.nextFloat, r.nextBooleanOption,
      r.nextBoolean, r.nextBoolean, r.nextBoolean, r.nextIntOption))

  implicit val projectSidewalkStatsConverter = GetResult[ProjectSidewalkStats](r => ProjectSidewalkStats(
    r.nextString, r.nextString, r.nextFloat, r.nextFloat, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt,
    r.nextInt,
    Map(
      "CurbRamp" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption),
      "NoCurbRamp" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption),
      "Obstacle" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption),
      "SurfaceProblem" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption),
      "NoSidewalk" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption),
      "Crosswalk" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption),
      "Signal" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption),
      "Occlusion" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption),
      "Other" -> LabelSeverityStats(r.nextInt, r.nextInt, r.nextFloatOption, r.nextFloatOption)
    ),
    r.nextInt,
    Map(
      "Overall" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "CurbRamp" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "NoCurbRamp" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "Obstacle" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "SurfaceProblem" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "NoSidewalk" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "Crosswalk" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "Signal" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "Occlusion" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption),
      "Other" -> LabelAccuracy(r.nextInt, r.nextInt, r.nextInt, r.nextFloatOption)
    )
  ))

  // Valid label type ids for the /validate -- excludes Other and Occlusion labels.
  val valLabelTypeIds: List[Int] = List(1, 2, 3, 4, 7, 9, 10)

  /**
    * Find a label based on temp_label_id and user_id.
    */
  def find(tempLabelId: Int, userId: UUID): Option[Label] = db.withSession { implicit session =>
    labelsUnfiltered.filter(l => l.temporaryLabelId === tempLabelId && l.userId === userId.toString).firstOption
  }

  def countLabels: Int = db.withSession(implicit session =>
    labelsWithTutorial.length.run
  )

  def countLabels(labelType: String): Int = db.withSession { implicit session =>
    labelsWithTutorial.filter(_.labelTypeId === LabelTypeTable.labelTypeToId(labelType)).length.run
  }

  /*
  * Counts the number of labels added today.
  *
  * If the task goes over two days, then all labels for that audit task will be added for the task end date.
  */
  def countTodayLabels: Int = db.withSession { implicit session =>
    val countQuery = Q.queryNA[Int](
      """SELECT COUNT(label_id)
        |FROM label
        |WHERE (time_created AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date
        |    AND deleted = false;""".stripMargin
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
      s"""SELECT COUNT(label_id)
         |FROM label
         |WHERE (time_created AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date
         |    AND label.deleted = false
         |    AND label.label_type_id = '${LabelTypeTable.labelTypeToId(labelType).get}';""".stripMargin
    )
    countQuery.first
  }

  /*
  * Counts the number of labels added during the last week.
  */
  def countPastWeekLabels: Int = db.withTransaction { implicit session =>
    val countQuery = Q.queryNA[Int](
      """SELECT COUNT(label_id)
        |FROM label
        |WHERE (time_created AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
        |    AND deleted = false;""".stripMargin
    )
    countQuery.first
  }

  /*
  * Counts the number of specific label types added during the last week.
  */
  def countPastWeekLabels(labelType: String): Int = db.withTransaction { implicit session =>
    val countQuery = Q.queryNA[Int](
      s"""SELECT COUNT(label.label_id)
         |FROM label
         |WHERE (time_created AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
         |    AND label.deleted = false
         |    AND label.label_type_id = ${LabelTypeTable.labelTypeToId(labelType).get};""".stripMargin
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
    labelsWithExcludedUsers.filter(_.userId === userId.toString).length.run
  }

  /**
   * Update the metadata that users might change on the Explore page after initially placing the label.
   *
   * @param labelId
   * @param deleted
   * @param severity
   * @param temporary
   * @param description
   * @param tags
   * @return
   */
  def updateFromExplore(labelId: Int, deleted: Boolean, severity: Option[Int], temporary: Boolean, description: Option[String], tags: List[String]): Int = db.withTransaction { implicit session =>
    val labelToUpdateQuery = labelsUnfiltered.filter(_.labelId === labelId)
    val labelToUpdate: Label = labelToUpdateQuery.first
    val cleanedTags: List[String] = TagTable.cleanTagList(tags, labelToUpdate.labelTypeId)

    // If the severity or tags have been changed, we need to update the label_history table as well.
    if (labelToUpdate.severity != severity || labelToUpdate.tags.toSet != cleanedTags.toSet) {
      // If there are multiple entries in the label_history table, then the label has been edited before and we need to
      // add an entirely new entry to the table. Otherwise we can just update the existing entry.
      val labelHistoryCount: Int = LabelHistoryTable.labelHistory.filter(_.labelId === labelId).length.run
      if (labelHistoryCount > 1) {
        LabelHistoryTable.save(LabelHistory(0, labelId, severity, cleanedTags, labelToUpdate.userId, new Timestamp(Instant.now.toEpochMilli), "Explore", None))
      } else {
        LabelHistoryTable.labelHistory.filter(_.labelId === labelId).map(l => (l.severity, l.tags)).update((severity, cleanedTags))
      }
    }

    // Update the label table here.
    labelToUpdateQuery
      .map(l => (l.deleted, l.severity, l.temporary, l.description, l.tags))
      .update((deleted, severity, temporary, description, tags.distinct))
  }

  /**
   * Updates severity and tags in the label table and saves the change in the label_history table. Called from Validate.
   *
   * @param labelId
   * @param severity
   * @param tags
   * @param userId
   * @return Int count of rows updated, either 0 or 1 because labelId is a primary key.
   */
  def updateAndSaveHistory(labelId: Int, severity: Option[Int], tags: List[String], userId: String, source: String, labelValidationId: Int): Int = db.withTransaction { implicit session =>
    val labelToUpdateQuery = labelsUnfiltered.filter(_.labelId === labelId)
    val labelToUpdate: Option[Label] = labelToUpdateQuery.firstOption
    // TODO do we need to pass session object to this function? https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3550
    val cleanedTags: Option[List[String]] = labelToUpdate.map(l => TagTable.cleanTagList(tags, l.labelTypeId))

    // If there is an actual change to the label, update it and add to the label_history table. O/w update nothing.
    if (labelToUpdate.isDefined && (labelToUpdate.get.severity != severity || labelToUpdate.get.tags.toSet != cleanedTags.get.toSet)) {
      LabelHistoryTable.save(LabelHistory(0, labelId, severity, cleanedTags.get, userId, new Timestamp(Instant.now.toEpochMilli), source, Some(labelValidationId)))
      labelToUpdateQuery.map(l => (l.severity, l.tags)).update((severity, cleanedTags.get))
    } else {
      0
    }
  }

  /**
   * Updates the label and label_history tables appropriately when a validation is deleted (using the back button).
   *
   * If the given validation represents the most recent change to the label, undo this validation's change in the label
   * table and delete this validation. If there have been subsequent changes to the label, just delete this validation.
   * However, if the next change to the label reverses the change made by this validation, the subsequent label_history
   * entry should be deleted as well (so that the history doesn't contain a redundant entry). And if the validation did
   * not change the severity or tags, then there is nothing to remove from the label_history table.
   * .
   * @param labelValidationId
   * @return
   */
  def removeLabelHistoryForValidation(labelValidationId: Int)(implicit session: Session): Boolean =  {
    val labelHistoryTable = LabelHistoryTable.labelHistory
    val historyEntry: Option[LabelHistory] = labelHistoryTable.filter(_.labelValidationId === labelValidationId).firstOption
    if (historyEntry.isDefined) {
      val fullHistory: List[LabelHistory] = labelHistoryTable.filter(_.labelId === historyEntry.get.labelId).list.sortBy(_.editTime.getTime)

      // If the given validation represents the most recent change to the label, undo this validation's change in the
      // label table and delete this validation from the label_history table.
      if (fullHistory.indexWhere(_.labelHistoryId == historyEntry.get.labelHistoryId) == fullHistory.length - 1) {
        val correctData: LabelHistory = fullHistory(fullHistory.length - 2)
        val labelToUpdateQuery = labelsUnfiltered.filter(_.labelId === historyEntry.get.labelId)
        labelToUpdateQuery.map(l => (l.severity, l.tags)).update((correctData.severity, correctData.tags))
        LabelHistoryTable.labelHistory.filter(_.labelValidationId === labelValidationId).delete > 0
      } else {
        // If the next history entry reverses what this one did, we can update the label table and delete both entries.
        val thisEntryIdx: Int = fullHistory.indexWhere(_.labelValidationId == Some(labelValidationId))
        if (fullHistory(thisEntryIdx - 1).severity == fullHistory(thisEntryIdx + 1).severity
          && fullHistory(thisEntryIdx - 1).tags == fullHistory(thisEntryIdx + 1).tags) {
          labelHistoryTable.filter(_.labelValidationId === labelValidationId).delete > 0 &&
            labelHistoryTable.filter(_.labelValidationId === fullHistory(thisEntryIdx + 1).labelValidationId).delete > 0
        } else {
          labelHistoryTable.filter(_.labelValidationId === labelValidationId).delete > 0
        }
      }
    } else {
      false // No label_history entry to delete (this would happen if the validation didn't change severity or tags).
    }
  }

  /**
   * Saves a new label in the table.
   */
  def save(label: Label): Int = db.withSession { implicit session =>
    val cleanLabel: Label = label.copy(tags = TagTable.cleanTagList(label.tags, label.labelTypeId))
    val labelId: Int = (labelsUnfiltered returning labelsUnfiltered.map(_.labelId)) += cleanLabel

    // Add a corresponding entry to the label_history table.
    LabelHistoryTable.save(LabelHistory(0, labelId, cleanLabel.severity, cleanLabel.tags, cleanLabel.userId, cleanLabel.timeCreated, "Explore", None))

    labelId
  }

  /**
   * Gets metadata for the `takeN` most recent labels. Optionally filter by user_id of the labeler.
   *
   * @param takeN Number of labels to retrieve
   * @param labelerId user_id of the person who placed the labels; an optional filter
   * @param validatorId optionally include this user's validation info for each label in the userValidation field
   * @param labelId optionally include this if you only want the metadata for the single given label
   * @return
   */
  def getRecentLabelsMetadata(takeN: Int, labelerId: Option[String] = None, validatorId: Option[String] = None, labelId: Option[Int] = None): List[LabelMetadata] = db.withSession { implicit session =>
    // Optional filter to only get labels placed by the given user.
    val labelerFilter: String = if (labelerId.isDefined) s"""u.user_id = '${labelerId.get}'""" else "TRUE"

    // Optionally include the given user's validation info for each label in the userValidation field.
    val validatorJoin: String =
      if (validatorId.isDefined) {
        s"""LEFT JOIN (
           |    SELECT label_id, validation_result
           |    FROM label_validation WHERE user_id = '${validatorId.get}'
           |) AS user_validation ON lb.label_id = user_validation.label_id""".stripMargin
      } else {
        "LEFT JOIN ( SELECT NULL AS validation_result ) AS user_validation ON lb.label_id = NULL"
      }

    // Either filter for the given labelId or filter out deleted and tutorial labels.
    val labelFilter: String = if (labelId.isDefined) {
      s"""lb1.label_id = ${labelId.get}"""
    } else {
      "lb1.deleted = FALSE AND lb1.tutorial = FALSE"
    }

    val selectQuery = Q.queryNA[LabelMetadata](
      s"""SELECT lb1.label_id,
         |       lb1.gsv_panorama_id,
         |       lb1.tutorial,
         |       gsv_data.capture_date,
         |       lp.heading,
         |       lp.pitch,
         |       lp.zoom,
         |       lp.canvas_x,
         |       lp.canvas_y,
         |       lb1.audit_task_id,
         |       lb1.street_edge_id,
         |       ser.region_id,
         |       u.user_id,
         |       u.username,
         |       lb1.time_created,
         |       lb_big.label_type,
         |       lb_big.label_type_desc,
         |       lb_big.severity,
         |       lb_big.temporary,
         |       lb_big.description,
         |       lb_big.validation_result,
         |       val.val_counts,
         |       array_to_string(lb_big.tags, ','),
         |       at.low_quality,
         |       at.incomplete,
         |       at.stale,
         |       comment.comments
         |FROM label AS lb1
         |INNER JOIN gsv_data ON lb1.gsv_panorama_id = gsv_data.gsv_panorama_id
         |INNER JOIN audit_task AS at ON lb1.audit_task_id = at.audit_task_id
         |INNER JOIN street_edge_region AS ser ON lb1.street_edge_id = ser.street_edge_id
         |INNER JOIN sidewalk_login.sidewalk_user AS u ON at.user_id = u.user_id
         |INNER JOIN label_point AS lp ON lb1.label_id = lp.label_id
         |INNER JOIN (
         |    SELECT lb.label_id,
         |           lb.gsv_panorama_id,
         |           lbt.label_type,
         |           lbt.description AS label_type_desc,
         |           lb.severity,
         |           lb.temporary,
         |           lb.description,
         |           user_validation.validation_result,
         |           lb.tags
         |    FROM label AS lb
         |    INNER JOIN label_type as lbt ON lb.label_type_id = lbt.label_type_id
         |    $validatorJoin
         |) AS lb_big ON lb1.label_id = lb_big.label_id
         |INNER JOIN (
         |    SELECT label_id,
         |           CONCAT('agree:', CAST(agree_count AS TEXT),
         |                  ',disagree:', CAST(disagree_count AS TEXT),
         |                  ',unsure:', CAST(unsure_count AS TEXT)) AS val_counts
         |    FROM label
         |) AS val ON lb1.label_id = val.label_id
         |LEFT JOIN (
         |    SELECT label_id, string_agg(comment, ':') AS comments
         |    FROM validation_task_comment
         |    GROUP BY label_id
         | ) AS comment ON lb1.label_id = comment.label_id
         |WHERE $labelFilter
         |    AND $labelerFilter
         |ORDER BY lb1.label_id DESC
         |LIMIT $takeN""".stripMargin
    )
    selectQuery.list
  }

  /**
   * Gets the metadata for the label with the given `labelId`.
   * @param labelId
   * @param userId
   * @return
   */
  def getSingleLabelMetadata(labelId: Int, userId: String): LabelMetadata = {
    getRecentLabelsMetadata(1, None, Some(userId), Some(labelId)).head
  }

  /**
    * Returns how many labels this user has available to validate (& how many need validations) for each label type.
    *
    * @return List[LabelTypeValidationsRemaining]
    */
  def getAvailableValidationLabelsByType(userId: UUID): List[LabelTypeValidationsLeft] = db.withSession { implicit session =>
    val userIdString: String = userId.toString
    val labelsValidatedByUser = labelValidations.filter(_.userId === userIdString)

    // Make sure there is a user_stat entry for the given user.
    UserStatTable.addUserStatIfNew(userId)

    // Get labels the given user has not placed that have non-expired GSV imagery.
    val labelsToValidate =  for {
      _lb <- labels
      _gd <- gsvData if _gd.gsvPanoramaId === _lb.gsvPanoramaId
      _us <- UserStatTable.userStats if _lb.userId === _us.userId
      if _us.highQuality && _gd.expired === false && _lb.userId =!= userIdString
    } yield (_lb.labelId, _lb.labelTypeId, _lb.correct)

    // Left join with the labels that the user has already validated, then filter those out.
    val filteredLabelsToValidate = for {
      (_lab, _val) <- labelsToValidate.leftJoin(labelsValidatedByUser).on(_._1 === _.labelId)
      if _val.labelId.?.isEmpty
    } yield _lab

    // Group by the label_type_id and count.
    // TODO when converting to Slick 3 we can use group.countDefined or something for the third column.
    filteredLabelsToValidate
      .groupBy(_._2).map{ case (labType, group) =>
        (labType, group.length, group.map { x => Case.If(x._3.isEmpty).Then(1).Else(0) }.sum.getOrElse(0))
      }.list.map(x => LabelTypeValidationsLeft(x._1, x._2, x._3))
  }

  /**
    * Retrieve n random labels that have existing GSVPanorama.
    *
    * Starts by querying for n * 5 labels, then checks GSV API to see if each gsv_panorama_id exists until we find n.
    *
    * @param userId         User ID for the current user.
    * @param n              Number of labels we need to query.
    * @param labelTypeId    Label Type ID of labels requested.
    * @param userIds        Optional list of user IDs to filter by.
    * @param regionIds      Optional list of region IDs to filter by.
    * @param skippedLabelId Label ID of the label that was just skipped (if applicable).
    * @return               Seq[LabelValidationMetadata]
    */
  def retrieveLabelListForValidation(userId: UUID, n: Int, labelTypeId: Int, userIds: Option[List[String]]=None, regionIds: Option[List[Int]]=None, skippedLabelId: Option[Int]=None): Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    val selectedLabels: ListBuffer[LabelValidationMetadata] = new ListBuffer[LabelValidationMetadata]()
    var potentialLabels: List[LabelValidationMetadata] = List()
    val checkedLabelIds: ListBuffer[Int] = ListBuffer[Int]()
    val userIdStr: String = userId.toString

    do {
      val selectRandomLabelsQuery = Q.queryNA[LabelValidationMetadata] (
        s"""SELECT label.label_id, label_type.label_type, label.gsv_panorama_id, gsv_data.capture_date,
           |       label.time_created, label_point.lat, label_point.lng, label_point.heading, label_point.pitch,
           |       label_point.zoom, label_point.canvas_x, label_point.canvas_y, label.severity, label.temporary,
           |       label.description, label.street_edge_id, street_edge_region.region_id, label.agree_count,
           |       label.disagree_count, label.unsure_count, label.correct, user_validation.validation_result,
           |       array_to_string(label.tags, ',')
           |FROM label
           |INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
           |INNER JOIN label_point ON label.label_id = label_point.label_id
           |INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
           |INNER JOIN user_stat ON label.user_id = user_stat.user_id
           |INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
           |INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
           |LEFT JOIN (
           |    -- This subquery counts how many of each users' labels have been validated. If it's less than 50, then
           |    -- we need more validations from them in order to infer worker quality, and they therefore get priority.
           |    SELECT user_id, COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) < 50 AS needs_validations
           |    FROM label
           |    WHERE deleted = FALSE AND tutorial = FALSE
           |    GROUP BY user_id
           |) needs_validations_query ON label.user_id = needs_validations_query.user_id
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
           |    AND user_stat.excluded = FALSE
           |    AND label.street_edge_id <> $tutorialStreetId
           |    AND audit_task.street_edge_id <> $tutorialStreetId
           |    AND gsv_data.expired = FALSE
           |    AND label_point.lat IS NOT NULL AND label_point.lng IS NOT NULL
           |    AND ${regionIds.map(ids => s"street_edge_region.region_id IN (${ids.mkString(",")})").getOrElse("TRUE")}
           |    AND ${userIds.map(ids => s"label.user_id IN ('${ids.mkString("','")}')").getOrElse("TRUE")}
           |    AND label.user_id <> '$userIdStr'
           |    AND label.label_id NOT IN (
           |        SELECT label_id
           |        FROM label_validation
           |        WHERE user_id = '$userIdStr'
           |    )
           |    AND ${if (checkedLabelIds.isEmpty) "TRUE" else s"label.label_id NOT IN (${checkedLabelIds.mkString(",")})"}
           |-- Generate a priority num for each label between 0 and 276. A label gets 100 points if the labeler has < 50
           |-- of their labels validated (and this label needs a validation). Another 50 points if the labeler was
           |-- marked as high quality. Up to 100 more points (100 / (1 + abs(agree_count - disagree_count))) depending
           |-- on how far we are from consensus. Another 25 points if the label was added in the past week. Then add a
           |-- random number so that the max score for each label is 276.
           |ORDER BY CASE WHEN COALESCE(needs_validations, TRUE) AND label.correct IS NULL AND NOT audit_task.low_quality AND NOT audit_task.stale THEN 100 ELSE 0 END +
           |    CASE WHEN user_stat.high_quality THEN 50 ELSE 0 END +
           |    100.0 / (1 + abs(label.agree_count - label.disagree_count)) +
           |    CASE WHEN label.time_created > now() - INTERVAL '1 WEEK' THEN 25 ELSE 0 END +
           |    RANDOM() * (276 - (
           |        CASE WHEN COALESCE(needs_validations,  TRUE) AND label.correct IS NULL AND NOT audit_task.low_quality AND NOT audit_task.stale THEN 100 ELSE 0 END +
           |            CASE WHEN user_stat.high_quality THEN 50 ELSE 0 END +
           |            100.0 / (1 + abs(label.agree_count - label.disagree_count)) +
           |            CASE WHEN label.time_created > now() - INTERVAL '1 WEEK' THEN 25 ELSE 0 END
           |        )) DESC
           |LIMIT ${n * 5};""".stripMargin
      )
      potentialLabels = selectRandomLabelsQuery.list

      // Remove label that was just skipped (if one was skipped).
      potentialLabels = potentialLabels.filter(_.labelId != skippedLabelId.getOrElse(-1))

      // Randomize those n * 5 high priority labels to prevent similar labels in a mission.
      potentialLabels = scala.util.Random.shuffle(potentialLabels)

      // Take the first `n` labels with non-expired GSV imagery.
      selectedLabels ++= checkForGsvImagery(potentialLabels, n)

      checkedLabelIds ++= potentialLabels.map(_.labelId)
    } while (selectedLabels.length < n && potentialLabels.length == n * 5) // Stop if we have enough or we run out.
    selectedLabels
  }

  /**
   * Get additional info about a label for use by admins on Admin Validate.
   * @param labelIds
   * @return
   */
  def getExtraAdminValidateData(labelIds: List[Int]): List[AdminValidationData] = db.withSession { implicit session =>
    labels.filter(_.labelId inSet labelIds)
      // Inner join label -> sidewalk_user to get username of person who placed the label.
      .innerJoin(users).on(_.userId === _.userId)
      // Left join label -> label_validation -> sidewalk_user to get username & validation result of ppl who validated.
      .leftJoin(labelValidations).on(_._1.labelId === _.labelId)
      .leftJoin(users).on(_._2.userId === _.userId)
      .map(x => (x._1._1._1.labelId, x._1._1._2.username, x._2.username.?, x._1._2.validationResult.?)).list
      // Turn the left joined validators into lists of tuples.
      .groupBy(l => (l._1, l._2)) // Group by label_id and username from the placed label.
      .map(x => (x._1._1, x._1._2, x._2.map(y => (y._3, y._4)))).toList
      .map(y => (y._1, y._2, y._3.collect({ case (Some(a), Some(b)) => (a, b) })))
      .map(AdminValidationData.tupled)
  }

  /**
   * Retrieves n labels of specified label type, severities, and tags. If no label type supplied, split across types.
   *
   * @param n Number of labels to grab.
   * @param labelTypeId       Label type specifying what type of labels to grab. None will give a mix.
   * @param loadedLabelIds    Set of labelIds already grabbed as to not grab them again.
   * @param valOptions        Set of correctness values to filter for: correct, incorrect, unsure, and/or unvalidated.
   * @param regionIds         Set of neighborhoods to get labels from. All neighborhoods if empty.
   * @param severity          Set of severities the labels grabbed can have.
   * @param tags              Set of tags the labels grabbed can have.
   * @return Seq[LabelValidationMetadata]
   */
  def getGalleryLabels(n: Int, labelTypeId: Option[Int], loadedLabelIds: Set[Int], valOptions: Set[String], regionIds: Set[Int], severity: Set[Int], tags: Set[String], userId: UUID): Seq[LabelValidationMetadata] = db.withSession { implicit session =>
    // Filter labels based on correctness.
    val _l1 = if (!valOptions.contains("correct")) labels.filter(l => l.correct.isEmpty || !l.correct) else labels
    val _l2 = if (!valOptions.contains("incorrect")) _l1.filter(l => l.correct.isEmpty || l.correct) else _l1
    val _l3 = if (!valOptions.contains("unsure")) _l2.filter(l => l.correct.isDefined || (l.agreeCount === 0 && l.disagreeCount === 0 && l.unsureCount === 0)) else _l2
    val _labelsFilteredByCorrectness = if (!valOptions.contains("unvalidated")) _l3.filter(l => l.agreeCount > 0 || l.disagreeCount > 0 || l.unsureCount > 0) else _l3

    // Grab labels and associated information. Label type and severity filters are included here.
    val _labelInfo = for {
      _lb <- _labelsFilteredByCorrectness if !(_lb.labelId inSet loadedLabelIds)
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
      _gd <- gsvData if _lb.gsvPanoramaId === _gd.gsvPanoramaId
      _us <- UserStatTable.userStats if _lb.userId === _us.userId
      _ser <- StreetEdgeRegionTable.streetEdgeRegionTable if _lb.streetEdgeId === _ser.streetEdgeId
      if _gd.expired === false
      if _lp.lat.isDefined && _lp.lng.isDefined
      if _lb.labelTypeId === labelTypeId || labelTypeId.isEmpty
      if (_ser.regionId inSet regionIds) || regionIds.isEmpty
      if (_lb.severity inSet severity) || severity.isEmpty
      if (_lb.tags @& tags.toList) || tags.isEmpty // @& is the overlap operator from postgres (&& in postgres).
      if _us.highQuality || (_lb.correct.isDefined && _lb.correct === true)
      if _lb.disagreeCount < 3 || _lb.disagreeCount < _lb.agreeCount * 2
    } yield (_lb, _lp, _lt, _gd, _ser)

    // Join with the validations that the user has given.
    val _userValidations = validationsFromUser(userId)
    val _labelInfoWithUserVals = for {
      (l, v) <- _labelInfo.leftJoin(_userValidations).on(_._1.labelId === _._1)
    } yield (l._1.labelId, l._3.labelType, l._1.gsvPanoramaId, l._4.captureDate, l._1.timeCreated, l._2.lat, l._2.lng,
      l._2.heading, l._2.pitch, l._2.zoom, (l._2.canvasX, l._2.canvasY), l._1.severity, l._1.temporary,
      l._1.description, l._1.streetEdgeId, l._5.regionId,
      (l._1.agreeCount, l._1.disagreeCount, l._1.unsureCount, l._1.correct), v._2.?, l._1.tags)

    // Remove duplicates that we got from joining with the `label_tag` table.
    val _uniqueLabels = if (tags.nonEmpty) _labelInfoWithUserVals.groupBy(x => x).map(_._1) else _labelInfoWithUserVals

    // Randomize & check for GSV imagery. If no label type is specified, do it by label type.
    if (labelTypeId.isDefined) {
      val rand = SimpleFunction.nullary[Double]("random")
      val _randomizedLabels = _uniqueLabels.sortBy(x => rand).list.map { l => LabelValidationMetadata(
        l._1, l._2, l._3, l._4, l._5, l._6.get, l._7.get, l._8, l._9, l._10, LocationXY.tupled(l._11), l._12, l._13,
        l._14, l._15, l._16, LabelValidationInfo.tupled(l._17), l._18, l._19
      )}

      // Take the first `n` labels with non-expired GSV imagery.
      checkForGsvImagery(_randomizedLabels, n)
    } else {
      val _potentialLabels: Map[String, List[LabelValidationMetadata]] =
        _uniqueLabels.list.map { l => LabelValidationMetadata(
          l._1, l._2, l._3, l._4, l._5, l._6.get, l._7.get, l._8, l._9, l._10, LocationXY(l._11._1, l._11._2), l._12,
          l._13, l._14, l._15, l._16, LabelValidationInfo.tupled(l._17), l._18, l._19
          )}.groupBy(_.labelType).map(l => l._1 -> scala.util.Random.shuffle(l._2))
      val nPerType: Int = n / LabelTypeTable.primaryLabelTypes.size

      // Take the first `nPerType` labels with non-expired GSV imagery for each label type, then randomize them.
      val chosenLabels: Seq[LabelValidationMetadata] = checkForImageryByLabelType(_potentialLabels, nPerType)
      scala.util.Random.shuffle(chosenLabels)
    }
  }

  /**
   * Get user's labels most recently validated as incorrect. Up to `nPerType` per label type.
   *
   * @param userId Id of the user who made these mistakes.
   * @param nPerType Number of mistakes to acquire of each label type.
   * @param labTypes List of label types where we are looking for mistakes.
   * @return
   */
  def getRecentValidatedLabelsForUser(userId: UUID, nPerType: Int, labTypes: List[String]): List[LabelMetadataUserDash] = db.withSession { implicit session =>
    // Attach comments to validations using a left join.
    val _validationsWithComments = labelValidations
      .leftJoin(ValidationTaskCommentTable.validationTaskComments)
      .on((v, c) => v.missionId === c.missionId && v.labelId === c.labelId)
      .map(x => (x._1.labelId, x._1.validationResult, x._1.userId, x._1.missionId, x._1.endTimestamp.?, x._2.comment.?))

    // Grab validations and associated label information for the given user's labels.
    val _validations = for {
      _lb <- labelsWithExcludedUsers
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
      _gd <- gsvData if _lb.gsvPanoramaId === _gd.gsvPanoramaId
      _vc <- _validationsWithComments if _lb.labelId === _vc._1
      _us <- UserStatTable.userStats if _vc._3 === _us.userId
      if _lb.userId === userId.toString && // Only include the given user's labels.
        _vc._3 =!= userId.toString && // Exclude any cases where the user may have validated their own label.
        _vc._2 === 2 && // Only times where users validated as incorrect.
        _us.excluded === false && // Don't use validations from excluded users
        _us.highQuality === true && // For now we only include validations from high quality users.
        _gd.expired === false && // Only include those with non-expired GSV imagery.
        _lb.correct.isDefined && _lb.correct === false && // Exclude outlier validations on a correct label.
        (_lt.labelType inSet labTypes) // Only include given label types.
    } yield (_lb.labelId, _lb.gsvPanoramaId, _lp.heading, _lp.pitch, _lp.zoom, _lp.canvasX, _lp.canvasY, _lt.labelType, _vc._5, _vc._6)

    // Run query, group by label type, get most recent validation for each label, and order by recency.
    val potentialLabels: Map[String, List[LabelMetadataUserDash]] =
      _validations.list.map(LabelMetadataUserDash.tupled).groupBy(_.labelType).map { case (labType, labs) =>
        val distinctLabs: List[LabelMetadataUserDash] = labs.groupBy(_.labelId).map(_._2.maxBy(_.timeValidated)).toList
        labType -> distinctLabs.sortBy(_.timeValidated)(Ordering[Option[Timestamp]].reverse)
      }

    // Get final label list by checking for GSV imagery.
    checkForImageryByLabelType(potentialLabels, nPerType)
  }

  /**
   * Searches in parallel for `n` labels with non-expired GSV imagery.
   *
   * @param potentialLabels A list of labels to check for non-expired GSV imagery.
   * @param n The number of to find.
   * @tparam A
   * @return
   */
  def checkForGsvImagery[A <: BasicLabelMetadata](potentialLabels: List[A], n: Int): List[A] = {
    var potentialStartIdx: Int = 0
    val selectedLabels: ListBuffer[A] = new ListBuffer[A]()

    // While the desired query size has not been met and there are still possibly valid labels to consider, traverse
    // through the list incrementally and see if a potentially valid label has pano data for viewability.
    while (selectedLabels.length < n && potentialStartIdx < potentialLabels.size) {
      val labelsNeeded: Int = n - selectedLabels.length
      val newLabels: Seq[A] =
        potentialLabels.slice(potentialStartIdx, potentialStartIdx + labelsNeeded).par.flatMap { currLabel =>
          // Include all labels that have non-expired GSV imagery.
          panoExists(currLabel.gsvPanoramaId).flatMap(if (_) Some(currLabel) else None)
        }.seq

      potentialStartIdx += labelsNeeded
      selectedLabels ++= newLabels
    }
    selectedLabels.toList
  }

  /**
   * Searches in parallel for `n` labels per label type with non-expired GSV imagery.
   *
   * @param potentialLabels A mapping from label type to a list of labels to check for GSV imagery.
   * @param n The number of labels to find for each label type.
   * @tparam A
   * @return
   */
  def checkForImageryByLabelType[A <: BasicLabelMetadata](potentialLabels: Map[String, List[A]], n: Int): List[A] = {
    // Get list of possible label types.
    val labTypes: List[String] = potentialLabels.keySet.toList

    // Prepare to check for GSV imagery in parallel by making mappings from label type to the number of labels needed
    // for that type and index we're at in the `potentialLabels` list.
    val numNeeded: collection.mutable.Map[String, Int] = collection.mutable.Map(labTypes.map(l => l -> n): _*)
    val startIndex: collection.mutable.Map[String, Int] = collection.mutable.Map(labTypes.map(l => l -> 0): _*)

    // Initialize list of labels to check for imagery by taking first `nPerType` for each label type.
    var labelsToTry: List[A] = potentialLabels.flatMap { case (labelType, labelList) =>
      labelList.slice(startIndex(labelType), startIndex(labelType) + numNeeded(labelType))
    }.toList

    // While there are still label types with fewer than `nPerType` labels and there are labels that might have valid
    // imagery remaining, check for GSV imagery in parallel.
    val selectedLabels: ListBuffer[A] = new ListBuffer[A]()
    while (labelsToTry.nonEmpty) {
      val newLabels: Seq[A] = labelsToTry.par.flatMap { currLabel =>
        // Include all labels that have non-expired GSV imagery.
        panoExists(currLabel.gsvPanoramaId).flatMap(if (_) Some(currLabel) else None)
      }.seq
      selectedLabels ++= newLabels

      // Update the `startIndex`, `numNeeded`, and `labelsToTry` maps for next round.
      labelsToTry.groupBy(_.labelType).foreach(t => startIndex(t._1) += t._2.length)
      newLabels.groupBy(_.labelType).foreach(t => numNeeded(t._1) -= t._2.length)
      labelsToTry = potentialLabels.flatMap { case (labelType, labelList) =>
        labelList.slice(startIndex(labelType), startIndex(labelType) + numNeeded(labelType))
      }.toList
    }
    selectedLabels.toList
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
    * Checks if the panorama associated with a label exists by pinging Google Maps.
    *
    * @param gsvPanoId  Panorama ID
    * @return           True if the panorama exists, false otherwise
    */
  def panoExists(gsvPanoId: String): Option[Boolean] = {
    val url: String = s"https://maps.googleapis.com/maps/api/streetview/metadata?pano=$gsvPanoId&key=${Play.configuration.getString("google-maps-api-key").get}"
    val signedUrl: String = VersionTable.signUrl(url)
    try {
      val connection: HttpsURLConnection = new URL(signedUrl).openConnection.asInstanceOf[HttpsURLConnection]
      connection.setConnectTimeout(5000)
      connection.setReadTimeout(5000)
      val inputStream: InputStream = connection.getInputStream
      val content: String = io.Source.fromInputStream(inputStream).mkString
      if (inputStream != null) inputStream.close()

      val imageStatus: String = (Json.parse(content) \ "status").as[String]
      val imageExists: Boolean = imageStatus == "OK"

      // Mark the expired status, last_checked, and last_viewed columns in the db.
      val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
      GSVDataTable.updateExpiredStatus(gsvPanoId, !imageExists, timestamp)

      Some(imageExists)
    } catch { // If there was an exception, don't assume it means a lack of GSV imagery.
      case ste: java.net.SocketTimeoutException => None
      case ioe: java.io.IOException => None
      case e: Exception => None
    }
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
          |);""".stripMargin
      )
      getTagsQuery(labelId).list
  }

  /**
    * Returns all the submitted labels with their severities included. If provided, filter for only given regions.
    */
  def selectLocationsAndSeveritiesOfLabels(regionIds: List[Int], routeIds: List[Int]): List[LabelLocationWithSeverity] = db.withSession { implicit session =>
    val _labels = for {
      _l <- labels
      _lType <- labelTypes if _l.labelTypeId === _lType.labelTypeId
      _lPoint <- labelPoints if _l.labelId === _lPoint.labelId
      _gsv <- gsvData if _l.gsvPanoramaId === _gsv.gsvPanoramaId
      _us <- UserStatTable.userStats if _l.userId === _us.userId
      _ser <- StreetEdgeRegionTable.streetEdgeRegionTable if _l.streetEdgeId === _ser.streetEdgeId
      if (_ser.regionId inSet regionIds) || regionIds.isEmpty
      if _lPoint.lat.isDefined && _lPoint.lng.isDefined // Make sure they are NOT NULL so we can safely use .get later.
    } yield (_l.labelId, _l.auditTaskId, _lType.labelType, _lPoint.lat, _lPoint.lng, _l.correct,
      _l.agreeCount > 0 || _l.disagreeCount > 0 || _l.unsureCount > 0, _gsv.expired, _us.highQuality, _l.severity, _ser.streetEdgeId)

    // Filter for labels along the given route. Distance experimentally set to 0.0005 degrees. Would like to switch to
    // different SRID and use meters: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3655.
    val _labelsNearRoute = if (routeIds.nonEmpty) {
      for {
        _rs <- RouteStreetTable.routeStreets if _rs.routeId inSet routeIds
        _se <- streets if _rs.streetEdgeId === _se.streetEdgeId
        _l <- _labels if _se.streetEdgeId === _l._11 ||
          _se.geom.distance(makePoint(_l._5.asColumnOf[Double], _l._4.asColumnOf[Double]).setSRID(4326)) < 0.0005F
      } yield _l
    } else {
      _labels
    }

    // For some reason we couldn't use both `_l.agreeCount > 0` and `_lPoint.lat.get` in the yield without a runtime
    // error, which is why we couldn't use `.tupled` here. This was the error message:
    // SlickException: Expected an option type, found Float/REAL
    _labelsNearRoute.list.map(l => LabelLocationWithSeverity(l._1, l._2, l._3, l._4.get, l._5.get, l._6, l._7, l._8, l._9, l._10))
  }

  /**
   * Returns a list of labels submitted by the given user, either everywhere or just in the given region.
   */
  def getLabelLocations(userId: UUID, regionId: Option[Int] = None): List[LabelLocation] = db.withSession { implicit session =>
    val _labels = for {
      _l <- labelsWithExcludedUsers
      _lt <- labelTypes if _l.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _l.labelId === _lp.labelId
      _at <- auditTasks if _l.auditTaskId === _at.auditTaskId
      _ser <- StreetEdgeRegionTable.streetEdgeRegionTable if _at.streetEdgeId === _ser.streetEdgeId
      if _l.userId === userId.toString
      if regionId.isEmpty.asColumnOf[Boolean] || _ser.regionId === regionId.getOrElse(-1)
      if _lp.lat.isDefined && _lp.lng.isDefined
    } yield (_l.labelId, _l.auditTaskId, _l.gsvPanoramaId, _lt.labelType, _lp.lat, _lp.lng, _l.correct, _l.agreeCount > 0 || _l.disagreeCount > 0 || _l.unsureCount > 0)
    _labels.list.map(l => LabelLocation(l._1, l._2, l._3, l._4, l._5.get, l._6.get, l._7, l._8))
  }

  /**
    * Returns a count of the number of labels placed on each day there were labels placed.
    */
  def selectLabelCountsPerDay: List[LabelCountPerDay] = db.withSession { implicit session =>
    val selectLabelCountQuery =  Q.queryNA[(String, Int)](
      """SELECT calendar_date, COUNT(label_id)
        |FROM
        |(
        |    SELECT label_id, time_created::date AS calendar_date
        |    FROM label
        |    WHERE deleted = FALSE
        |) AS calendar
        |GROUP BY calendar_date
        |ORDER BY calendar_date;""".stripMargin
    )
    selectLabelCountQuery.list.map(x => LabelCountPerDay.tupled(x))
  }

  /**
    * Select label counts per user.
    *
    * @return list of tuples of (user_id, role, label_count)
    */
  def getLabelCountsPerUser: List[(String, String, Int)] = db.withSession { implicit session =>

    val labs = for {
      _user <- users if _user.username =!= "anonymous"
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      _label <- labelsWithTutorial if _user.userId === _label.userId
    } yield (_user.userId, _role.role, _label.labelId)

    // Counts the number of labels for each user by grouping by user_id and role.
    labs.groupBy(l => (l._1, l._2)).map { case ((uId, role), group) => (uId, role, group.length) }.list
  }


  /**
    * Select street_edge_id of street closest to lat/lng position.
    *
    * @return street_edge_id
    */
  def getStreetEdgeIdClosestToLatLng(lat: Float, lng: Float): Option[Int] = db.withSession { implicit session =>
    val selectStreetEdgeIdQuery = Q.query[(Float, Float), Int](
      """SELECT street_edge_id
        |FROM street_edge
        |WHERE deleted = FALSE
        |ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(?, ?), 4326)) ASC
        |LIMIT 1;""".stripMargin
    )
    //NOTE: these parameters are being passed in correctly. ST_MakePoint accepts lng first, then lat.
    selectStreetEdgeIdQuery((lng, lat)).firstOption
  }

  /**
   * Gets the labels placed by a user in a region.
   *
   * @param regionId Region ID to get labels from
   * @param userId User ID of user to find labels for
   * @return list of labels placed by user in region
   */
  def getLabelsFromUserInRegion(regionId: Int, userId: UUID): List[ResumeLabelMetadata] = db.withSession { implicit session =>
    (for {
      _mission <- missions
      _label <- labels if _mission.missionId === _label.missionId
      _labelPoint <- labelPoints if _label.labelId === _labelPoint.labelId
      _labelType <- labelTypes if _label.labelTypeId === _labelType.labelTypeId
      _gsvData <- gsvData if _label.gsvPanoramaId === _gsvData.gsvPanoramaId
      if _mission.regionId === regionId && _mission.userId === userId.toString
      if _labelPoint.lat.isDefined && _labelPoint.lng.isDefined
    } yield (_label, _labelType.labelType, _labelPoint, _gsvData.lat, _gsvData.lng, _gsvData.cameraHeading, _gsvData.cameraPitch, _gsvData.width, _gsvData.height))
      .list.map(ResumeLabelMetadata.tupled)
  }

  /**
   * Gets raw labels with all metadata within a bounding box for the public API.
   * @param bbox
   * @param startIndex
   * @param n
   */
  def getAllLabelMetadata(bbox: APIBBox, startIndex: Option[Int] = None, n: Option[Int] = None): List[LabelAllMetadata] = db.withSession { implicit session =>
    // TODO convert to Slick syntax once we can do array aggregation after upgrading to Slick 3.
    val labelsQuery = Q.queryNA[LabelAllMetadata](
      s"""SELECT label.label_id, label.user_id, label.gsv_panorama_id, label_type.label_type, label.severity,
         |       array_to_string(label.tags, ','), label.temporary, label.description, label_point.lat, label_point.lng,
         |       label.time_created, label.street_edge_id, osm_way_street_edge.osm_way_id, region.name,
         |       label.agree_count, label.disagree_count, label.unsure_count, label.correct, vals.validations,
         |       audit_task.audit_task_id, label.mission_id, gsv_data.capture_date, label_point.heading,
         |       label_point.pitch, label_point.zoom, label_point.canvas_x, label_point.canvas_y, label_point.pano_x,
         |       label_point.pano_y, gsv_data.width, gsv_data.height, gsv_data.camera_heading, gsv_data.camera_pitch
         |FROM label
         |INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
         |INNER JOIN label_point ON label.label_id = label_point.label_id
         |INNER JOIN osm_way_street_edge ON label.street_edge_id = osm_way_street_edge.street_edge_id
         |INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
         |INNER JOIN region ON street_edge_region.region_id = region.region_id
         |INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
         |INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
         |INNER JOIN user_stat ON label.user_id = user_stat.user_id
         |LEFT JOIN (
         |    SELECT label.label_id,
         |    array_to_string(array_agg(CONCAT(label_validation.user_id, ':', label_validation.validation_result)), ',') AS validations
         |    FROM label
         |    INNER JOIN label_validation ON label.label_id = label_validation.label_id
         |    GROUP BY label.label_id
         |) AS "vals" ON label.label_id = vals.label_id
         |WHERE label.deleted = FALSE
         |    AND label.tutorial = FALSE
         |    AND user_stat.excluded = FALSE
         |    AND label.street_edge_id <> $tutorialStreetId
         |    AND audit_task.street_edge_id <> $tutorialStreetId
         |    AND label_point.lat > ${bbox.minLat}
         |    AND label_point.lat < ${bbox.maxLat}
         |    AND label_point.lng > ${bbox.minLng}
         |    AND label_point.lng < ${bbox.maxLng}
         |ORDER BY label.label_id
         |${if (n.isDefined && startIndex.isDefined) s"LIMIT ${n.get} OFFSET ${startIndex.get}" else ""};""".stripMargin
    )
    labelsQuery.list
  }

  def getOverallStatsForAPI(filterLowQuality: Boolean): ProjectSidewalkStats = db.withSession { implicit session =>
    // We use a different filter in all the sub-queries, depending on whether or not we filter out low quality data.
    val userFilter: String =
      if (filterLowQuality) "user_stat.high_quality"
      else "NOT user_stat.excluded"

    val cityId: String = Play.configuration.getString("city-id").get
    val launchDate: String = Play.configuration.getString(s"city-params.launch-date.$cityId").get

    val recentLabelDates: List[Timestamp] = labels.sortBy(_.timeCreated.desc).take(100).list.map(_.timeCreated)
    val avgRecentLabels: Timestamp = new Timestamp(recentLabelDates.map(_.getTime).sum / recentLabelDates.length)

    val overallStatsQuery = Q.queryNA[ProjectSidewalkStats](
      s"""SELECT '$launchDate' AS launch_date,
         |       '$avgRecentLabels' AS avg_timestamp_last_100_labels,
         |       km_audited.km_audited AS km_audited,
         |       km_audited_no_overlap.km_audited_no_overlap AS km_audited_no_overlap,
         |       users.total_users,
         |       users.audit_users,
         |       users.validation_users,
         |       users.registered_users,
         |       users.anon_users,
         |       users.turker_users,
         |       users.researcher_users,
         |       label_counts_and_severity.label_count,
         |       label_counts_and_severity.n_ramp,
         |       label_counts_and_severity.n_ramp_with_sev,
         |       label_counts_and_severity.ramp_sev_mean,
         |       label_counts_and_severity.ramp_sev_sd,
         |       label_counts_and_severity.n_noramp,
         |       label_counts_and_severity.n_noramp_with_sev,
         |       label_counts_and_severity.noramp_sev_mean,
         |       label_counts_and_severity.noramp_sev_sd,
         |       label_counts_and_severity.n_obs,
         |       label_counts_and_severity.n_obs_with_sev,
         |       label_counts_and_severity.obs_sev_mean,
         |       label_counts_and_severity.obs_sev_sd,
         |       label_counts_and_severity.n_surf,
         |       label_counts_and_severity.n_surf_with_sev,
         |       label_counts_and_severity.surf_sev_mean,
         |       label_counts_and_severity.surf_sev_sd,
         |       label_counts_and_severity.n_nosidewalk,
         |       label_counts_and_severity.n_nosidewalk_with_sev,
         |       label_counts_and_severity.nosidewalk_sev_mean,
         |       label_counts_and_severity.nosidewalk_sev_sd,
         |       label_counts_and_severity.n_crswlk,
         |       label_counts_and_severity.n_crswlk_with_sev,
         |       label_counts_and_severity.crswlk_sev_mean,
         |       label_counts_and_severity.crswlk_sev_sd,
         |       label_counts_and_severity.n_signal,
         |       0 AS signal_with_sev,
         |       NULL AS signal_sev_mean,
         |       NULL AS signal_sev_sd,
         |       label_counts_and_severity.n_occlusion,
         |       0 AS occlusion_with_sev,
         |       NULL AS occlusion_sev_mean,
         |       NULL AS occlusion_sev_sd,
         |       label_counts_and_severity.n_other,
         |       label_counts_and_severity.n_other_with_sev,
         |       label_counts_and_severity.other_sev_mean,
         |       label_counts_and_severity.other_sev_sd,
         |       total_val_count.validation_count,
         |       val_counts.n_validated,
         |       val_counts.n_agree,
         |       val_counts.n_disagree,
         |       1.0 * val_counts.n_agree / NULLIF(val_counts.n_validated, 0) AS overall_accuracy,
         |       val_counts.n_ramp_total,
         |       val_counts.n_ramp_agree,
         |       val_counts.n_ramp_disagree,
         |       1.0 * val_counts.n_ramp_agree / NULLIF(val_counts.n_ramp_total, 0) AS ramp_accuracy,
         |       val_counts.n_noramp_total,
         |       val_counts.n_noramp_agree,
         |       val_counts.n_noramp_disagree,
         |       1.0 * val_counts.n_noramp_agree / NULLIF(val_counts.n_noramp_total, 0) AS noramp_accuracy,
         |       val_counts.n_obs_total,
         |       val_counts.n_obs_agree,
         |       val_counts.n_obs_disagree,
         |       1.0 * val_counts.n_obs_agree / NULLIF(val_counts.n_obs_total, 0) AS obs_accuracy,
         |       val_counts.n_surf_total,
         |       val_counts.n_surf_agree,
         |       val_counts.n_surf_disagree,
         |       1.0 * val_counts.n_surf_agree / NULLIF(val_counts.n_surf_total, 0) AS surf_accuracy,
         |       val_counts.n_nosidewalk_total,
         |       val_counts.n_nosidewalk_agree,
         |       val_counts.n_nosidewalk_disagree,
         |       1.0 * val_counts.n_nosidewalk_agree / NULLIF(val_counts.n_nosidewalk_total, 0) AS nosidewalk_accuracy,
         |       val_counts.n_crswlk_total,
         |       val_counts.n_crswlk_agree,
         |       val_counts.n_crswlk_disagree,
         |       1.0 * val_counts.n_crswlk_agree / NULLIF(val_counts.n_crswlk_total, 0) AS crswlk_accuracy,
         |       val_counts.n_signal_total,
         |       val_counts.n_signal_agree,
         |       val_counts.n_signal_disagree,
         |       1.0 * val_counts.n_signal_agree / NULLIF(val_counts.n_signal_total, 0) AS signal_accuracy,
         |       val_counts.n_occlusion_total,
         |       val_counts.n_occlusion_agree,
         |       val_counts.n_occlusion_disagree,
         |       1.0 * val_counts.n_occlusion_agree / NULLIF(val_counts.n_occlusion_total, 0) AS occlusion_accuracy,
         |       val_counts.n_other_total,
         |       val_counts.n_other_agree,
         |       val_counts.n_other_disagree,
         |       1.0 * val_counts.n_other_agree / NULLIF(val_counts.n_other_total, 0) AS other_accuracy
         |FROM (
         |    SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km_audited
         |    FROM street_edge
         |    INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
         |    INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
         |    WHERE completed = TRUE AND $userFilter
         |) AS km_audited, (
         |    SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km_audited_no_overlap
         |    FROM (
         |        SELECT DISTINCT street_edge.street_edge_id, geom
         |        FROM street_edge
         |        INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
         |        INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
         |        WHERE completed = TRUE AND $userFilter
         |    ) distinct_streets
         |) AS km_audited_no_overlap, (
         |    SELECT COUNT(DISTINCT(users.user_id)) AS total_users,
         |           COUNT(CASE WHEN mission_type = 'validation' THEN 1 END) AS validation_users,
         |           COUNT(CASE WHEN mission_type = 'audit' THEN 1 END) AS audit_users,
         |           COUNT(DISTINCT(CASE WHEN role = 'Registered' THEN user_id END)) AS registered_users,
         |           COUNT(DISTINCT(CASE WHEN role = 'Anonymous' THEN user_id END)) AS anon_users,
         |           COUNT(DISTINCT(CASE WHEN role = 'Turker' THEN user_id END)) AS turker_users,
         |           COUNT(DISTINCT(CASE WHEN role IN ('Researcher', 'Administrator', 'Owner') THEN user_id END)) AS researcher_users
         |    FROM (
         |        SELECT users_with_type.user_id, mission_type, role.role
         |        FROM (
         |            SELECT DISTINCT(label_validation.user_id), 'validation' AS mission_type
         |            FROM label_validation
         |            UNION
         |            SELECT DISTINCT(user_id), 'audit' AS mission_type
         |            FROM audit_task
         |            WHERE audit_task.completed = TRUE
         |        ) users_with_type
         |        INNER JOIN user_stat ON users_with_type.user_id = user_stat.user_id
         |        INNER JOIN sidewalk_login.user_role ON users_with_type.user_id = user_role.user_id
         |        INNER JOIN sidewalk_login.role ON user_role.role_id = role.role_id
         |        WHERE $userFilter
         |    ) users
         |) AS users, (
         |    SELECT COUNT(*) AS label_count,
         |           COUNT(CASE WHEN label_type.label_type = 'CurbRamp' THEN 1 END) AS n_ramp,
         |           COUNT(CASE WHEN label_type.label_type = 'CurbRamp' AND severity IS NOT NULL THEN 1 END) AS n_ramp_with_sev,
         |           avg(CASE WHEN label_type.label_type = 'CurbRamp' THEN severity END) AS ramp_sev_mean,
         |           stddev(CASE WHEN label_type.label_type = 'CurbRamp' THEN severity END) AS ramp_sev_sd,
         |           COUNT(CASE WHEN label_type.label_type = 'NoCurbRamp' THEN 1 END) AS n_noramp,
         |           COUNT(CASE WHEN label_type.label_type = 'NoCurbRamp' AND severity IS NOT NULL THEN 1 END) AS n_noramp_with_sev,
         |           avg(CASE WHEN label_type.label_type = 'NoCurbRamp' THEN severity END) AS noramp_sev_mean,
         |           stddev(CASE WHEN label_type.label_type = 'NoCurbRamp' THEN severity END) AS noramp_sev_sd,
         |           COUNT(CASE WHEN label_type.label_type = 'Obstacle' THEN 1 END) AS n_obs,
         |           COUNT(CASE WHEN label_type.label_type = 'Obstacle' AND severity IS NOT NULL THEN 1 END) AS n_obs_with_sev,
         |           avg(CASE WHEN label_type.label_type = 'Obstacle' THEN severity END) AS obs_sev_mean,
         |           stddev(CASE WHEN label_type.label_type = 'Obstacle' THEN severity END) AS obs_sev_sd,
         |           COUNT(CASE WHEN label_type.label_type = 'SurfaceProblem' THEN 1 END) AS n_surf,
         |           COUNT(CASE WHEN label_type.label_type = 'SurfaceProblem' AND severity IS NOT NULL THEN 1 END) AS n_surf_with_sev,
         |           avg(CASE WHEN label_type.label_type = 'SurfaceProblem' THEN severity END) AS surf_sev_mean,
         |           stddev(CASE WHEN label_type.label_type = 'SurfaceProblem' THEN severity END) AS surf_sev_sd,
         |           COUNT(CASE WHEN label_type.label_type = 'NoSidewalk' THEN 1 END) AS n_nosidewalk,
         |           COUNT(CASE WHEN label_type.label_type = 'NoSidewalk' AND severity IS NOT NULL THEN 1 END) AS n_nosidewalk_with_sev,
         |           avg(CASE WHEN label_type.label_type = 'NoSidewalk' THEN severity END) AS nosidewalk_sev_mean,
         |           stddev(CASE WHEN label_type.label_type = 'NoSidewalk' THEN severity END) AS nosidewalk_sev_sd,
         |           COUNT(CASE WHEN label_type.label_type = 'Crosswalk' THEN 1 END) AS n_crswlk,
         |           COUNT(CASE WHEN label_type.label_type = 'Crosswalk' AND severity IS NOT NULL THEN 1 END) AS n_crswlk_with_sev,
         |           avg(CASE WHEN label_type.label_type = 'Crosswalk' THEN severity END) AS crswlk_sev_mean,
         |           stddev(CASE WHEN label_type.label_type = 'Crosswalk' THEN severity END) AS crswlk_sev_sd,
         |           COUNT(CASE WHEN label_type.label_type = 'Signal' THEN 1 END) AS n_signal,
         |           COUNT(CASE WHEN label_type.label_type = 'Occlusion' THEN 1 END) AS n_occlusion,
         |           COUNT(CASE WHEN label_type.label_type = 'Other' THEN 1 END) AS n_other,
         |           COUNT(CASE WHEN label_type.label_type = 'Other' AND severity IS NOT NULL THEN 1 END) AS n_other_with_sev,
         |           avg(CASE WHEN label_type.label_type = 'Other' THEN severity END) AS other_sev_mean,
         |           stddev(CASE WHEN label_type.label_type = 'Other' THEN severity END) AS other_sev_sd
         |    FROM label
         |    INNER JOIN user_stat ON label.user_id = user_stat.user_id
         |    INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
         |    INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
         |    WHERE $userFilter
         |        AND deleted = FALSE
         |        AND tutorial = FALSE
         |        AND label.street_edge_id <> $tutorialStreetId
         |        AND audit_task.street_edge_id <> $tutorialStreetId
         |) AS label_counts_and_severity, (
         |    SELECT COUNT(*) AS validation_count
         |    FROM label_validation
         |    INNER JOIN user_stat ON label_validation.user_id = user_stat.user_id
         |    WHERE $userFilter
         |) AS total_val_count, (
         |    SELECT COUNT(CASE WHEN correct THEN 1 END) AS n_agree,
         |           COUNT(CASE WHEN NOT correct THEN 1 END) AS n_disagree,
         |           COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS n_validated,
         |           COUNT(CASE WHEN label_type = 'CurbRamp' AND correct THEN 1 END) AS n_ramp_agree,
         |           COUNT(CASE WHEN label_type = 'CurbRamp' AND NOT correct THEN 1 END) AS n_ramp_disagree,
         |           COUNT(CASE WHEN label_type = 'CurbRamp' AND correct IS NOT NULL THEN 1 END) AS n_ramp_total,
         |           COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct THEN 1 END) AS n_noramp_agree,
         |           COUNT(CASE WHEN label_type = 'NoCurbRamp' AND NOT correct THEN 1 END) AS n_noramp_disagree,
         |           COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct IS NOT NULL THEN 1 END) AS n_noramp_total,
         |           COUNT(CASE WHEN label_type = 'Obstacle' AND correct THEN 1 END) AS n_obs_agree,
         |           COUNT(CASE WHEN label_type = 'Obstacle' AND NOT correct THEN 1 END) AS n_obs_disagree,
         |           COUNT(CASE WHEN label_type = 'Obstacle' AND correct IS NOT NULL THEN 1 END) AS n_obs_total,
         |           COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct THEN 1 END) AS n_surf_agree,
         |           COUNT(CASE WHEN label_type = 'SurfaceProblem' AND NOT correct THEN 1 END) AS n_surf_disagree,
         |           COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct IS NOT NULL THEN 1 END) AS n_surf_total,
         |           COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct THEN 1 END) AS n_nosidewalk_agree,
         |           COUNT(CASE WHEN label_type = 'NoSidewalk' AND NOT correct THEN 1 END) AS n_nosidewalk_disagree,
         |           COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct IS NOT NULL THEN 1 END) AS n_nosidewalk_total,
         |           COUNT(CASE WHEN label_type = 'Crosswalk' AND correct THEN 1 END) AS n_crswlk_agree,
         |           COUNT(CASE WHEN label_type = 'Crosswalk' AND NOT correct THEN 1 END) AS n_crswlk_disagree,
         |           COUNT(CASE WHEN label_type = 'Crosswalk' AND correct IS NOT NULL THEN 1 END) AS n_crswlk_total,
         |           COUNT(CASE WHEN label_type = 'Signal' AND correct THEN 1 END) AS n_signal_agree,
         |           COUNT(CASE WHEN label_type = 'Signal' AND NOT correct THEN 1 END) AS n_signal_disagree,
         |           COUNT(CASE WHEN label_type = 'Signal' AND correct IS NOT NULL THEN 1 END) AS n_signal_total,
         |           COUNT(CASE WHEN label_type = 'Occlusion' AND correct THEN 1 END) AS n_occlusion_agree,
         |           COUNT(CASE WHEN label_type = 'Occlusion' AND NOT correct THEN 1 END) AS n_occlusion_disagree,
         |           COUNT(CASE WHEN label_type = 'Occlusion' AND correct IS NOT NULL THEN 1 END) AS n_occlusion_total,
         |           COUNT(CASE WHEN label_type = 'Other' AND correct THEN 1 END) AS n_other_agree,
         |           COUNT(CASE WHEN label_type = 'Other' AND NOT correct THEN 1 END) AS n_other_disagree,
         |           COUNT(CASE WHEN label_type = 'Other' AND correct IS NOT NULL THEN 1 END) AS n_other_total
         |    FROM label
         |    INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
         |    INNER JOIN user_stat ON label.user_id = user_stat.user_id
         |    INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
         |    WHERE $userFilter
         |        AND deleted = FALSE
         |        AND tutorial = FALSE
         |        AND label.street_edge_id <> $tutorialStreetId
         |        AND audit_task.street_edge_id <> $tutorialStreetId
         |) AS val_counts;""".stripMargin
    )
    overallStatsQuery.first
  }

  /**
    * Get next temp label id to be used. That would be the max used + 1, or just 1 if no labels in this task.
    */
  def nextTempLabelId(userId: UUID): Int = db.withSession { implicit session =>
    labelsUnfiltered.filter(_.userId === userId.toString).map(_.temporaryLabelId).max.run.map(x => x + 1).getOrElse(1)
  }

  /**
   * Get metadata used for 2022 CV project for all labels.
   */
  def getLabelCVMetadata(startIndex: Int, batchSize: Int): List[LabelCVMetadata] = db.withSession { implicit session =>
    (for {
      _l <- labels
      _lp <- labelPoints if _l.labelId === _lp.labelId
      _gsv <- gsvData if _l.gsvPanoramaId === _gsv.gsvPanoramaId
      if _gsv.cameraHeading.isDefined && _gsv.cameraPitch.isDefined
    } yield (
      _l.labelId, _gsv.gsvPanoramaId, _l.labelTypeId, _l.agreeCount, _l.disagreeCount, _l.unsureCount, _gsv.width,
      _gsv.height, _lp.panoX, _lp.panoY, LabelPointTable.canvasWidth, LabelPointTable.canvasHeight, _lp.canvasX,
      _lp.canvasY, _lp.zoom, _lp.heading, _lp.pitch, _gsv.cameraHeading.asColumnOf[Float],
      _gsv.cameraPitch.asColumnOf[Float]
    )).sortBy(_._1).drop(startIndex).take(batchSize).list.map(LabelCVMetadata.tupled)
  }
}
