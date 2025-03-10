package models.label

import com.google.inject.ImplementedBy
import controllers.{APIBBox, StreamingAPIType}
import formats.json.APIFormats
import models.audit.AuditTaskTableDef
import models.label.LabelTable._
import models.mission.MissionTableDef
import models.region.RegionTableDef
import models.route.RouteStreetTableDef
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTableDef}
import models.user.{RoleTableDef, UserStatTableDef}
import models.utils.ConfigTableDef
import org.geotools.geometry.jts.JTSFactoryFinder
import org.locationtech.jts.geom.{Coordinate, GeometryFactory, Point}
import service.GSVDataService
import slick.sql.SqlStreamingAction

import java.time.{Duration, Instant, OffsetDateTime, ZoneOffset}
import scala.concurrent.ExecutionContext
import models.gsv.GSVDataTableDef
import models.user.{SidewalkUserTableDef, UserRoleTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult
import play.api.libs.json.JsObject

import javax.inject.{Inject, Singleton}


case class Label(labelId: Int, auditTaskId: Int, missionId: Int, userId: String, gsvPanoramaId: String,
                 labelTypeId: Int, deleted: Boolean, temporaryLabelId: Int, timeCreated: OffsetDateTime,
                 tutorial: Boolean, streetEdgeId: Int, agreeCount: Int, disagreeCount: Int, unsureCount: Int,
                 correct: Option[Boolean], severity: Option[Int], temporary: Boolean, description: Option[String],
                 tags: List[String])

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
                         userId: String, username: String, timestamp: OffsetDateTime, labelTypeKey: String,
                         labelTypeValue: String, severity: Option[Int], temporary: Boolean,
                         description: Option[String], userValidation: Option[Int], validations: Map[String, Int],
                         tags: List[String], lowQualityIncompleteStaleFlags: (Boolean, Boolean, Boolean),
                         comments: Option[List[String]])

// Extra data to include with validations for Admin Validate. Includes usernames and previous validators.
case class AdminValidationData(labelId: Int, username: String, previousValidations: Seq[(String, Int)])

case class ResumeLabelMetadata(labelData: Label, labelType: String, pointData: LabelPoint, panoLat: Option[Float],
                               panoLng: Option[Float], cameraHeading: Option[Float], cameraPitch: Option[Float],
                               panoWidth: Option[Int], panoHeight: Option[Int])

case class LabelCVMetadata(labelId: Int, panoId: String, labelTypeId: Int, agreeCount: Int, disagreeCount: Int,
                           unsureCount: Int, panoWidth: Option[Int], panoHeight: Option[Int], panoX: Int, panoY: Int,
                           canvasWidth: Int, canvasHeight: Int, canvasX: Int, canvasY: Int, zoom: Int, heading: Float,
                           pitch: Float, cameraHeading: Float, cameraPitch: Float)

case class LabelMetadataUserDash(labelId: Int, gsvPanoramaId: String, heading: Float, pitch: Float, zoom: Int,
                                 canvasX: Int, canvasY: Int, labelType: String, timeValidated: Option[OffsetDateTime],
                                 validatorComment: Option[String]) extends BasicLabelMetadata

// NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
case class LabelValidationMetadata(labelId: Int, labelType: String, gsvPanoramaId: String, imageCaptureDate: String,
                                   timestamp: OffsetDateTime, lat: Float, lng: Float, heading: Float, pitch: Float,
                                   zoom: Int, canvasXY: LocationXY, severity: Option[Int], temporary: Boolean,
                                   description: Option[String], streetEdgeId: Int, regionId: Int,
                                   validationInfo: LabelValidationInfo, userValidation: Option[Int],
                                   tags: Seq[String]) extends BasicLabelMetadata

case class LabelAllMetadata(labelId: Int, userId: String, panoId: String, labelType: String, severity: Option[Int],
                            tags: List[String], temporary: Boolean, description: Option[String], geom: Point,
                            timeCreated: OffsetDateTime, streetEdgeId: Int, osmStreetId: Long, neighborhoodName: String,
                            validationInfo: LabelValidationInfo, validations: List[(String, Int)], auditTaskId: Int,
                            missionId: Int, imageCaptureDate: String, pov: POV, canvasXY: LocationXY,
                            panoLocation: (LocationXY, Option[Dimensions]), cameraHeadingPitch: (Double, Double)) extends StreamingAPIType {
  val gsvUrl = s"""https://maps.googleapis.com/maps/api/streetview?
                  |size=${LabelPointTable.canvasWidth}x${LabelPointTable.canvasHeight}
                  |&pano=${panoId}
                  |&heading=${pov.heading}
                  |&pitch=${pov.pitch}
                  |&fov=${GSVDataService.getFov(pov.zoom)}
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
      "GSV URL,Panorama X,Panorama Y,Panorama Width,Panorama Height,Panorama Heading,Panorama Pitch\n"
  }
}

class LabelTableDef(tag: slick.lifted.Tag) extends Table[Label](tag, "label") {
  def labelId: Rep[Int] = column[Int]("label_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId: Rep[Int] = column[Int]("audit_task_id")
  def missionId: Rep[Int] = column[Int]("mission_id")
  def userId: Rep[String] = column[String]("user_id")
  def gsvPanoramaId: Rep[String] = column[String]("gsv_panorama_id")
  def labelTypeId: Rep[Int] = column[Int]("label_type_id")
  def deleted: Rep[Boolean] = column[Boolean]("deleted")
  def temporaryLabelId: Rep[Int] = column[Int]("temporary_label_id")
  def timeCreated: Rep[OffsetDateTime] = column[OffsetDateTime]("time_created")
  def tutorial: Rep[Boolean] = column[Boolean]("tutorial")
  def streetEdgeId: Rep[Int] = column[Int]("street_edge_id")
  def agreeCount: Rep[Int] = column[Int]("agree_count")
  def disagreeCount: Rep[Int] = column[Int]("disagree_count")
  def unsureCount: Rep[Int] = column[Int]("unsure_count")
  def correct: Rep[Option[Boolean]] = column[Option[Boolean]]("correct")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")
  def temporary: Rep[Boolean] = column[Boolean]("temporary")
  def description: Rep[Option[String]] = column[Option[String]]("description")
  def tags: Rep[List[String]] = column[List[String]]("tags", O.Default(List()))

  def * = (labelId, auditTaskId, missionId, userId, gsvPanoramaId, labelTypeId, deleted,
    temporaryLabelId, timeCreated, tutorial, streetEdgeId, agreeCount, disagreeCount, unsureCount, correct, severity,
    temporary, description, tags) <> ((Label.apply _).tupled, Label.unapply)

//  def auditTask: ForeignKeyQuery[AuditTaskTable, AuditTask] =
//    foreignKey("label_audit_task_id_fkey", auditTaskId, TableQuery[AuditTaskTableDef])(_.auditTaskId)
//
//  def mission: ForeignKeyQuery[MissionTable, Mission] =
//    foreignKey("label_mission_id_fkey", missionId, TableQuery[MissionTableDef])(_.missionId)
//
//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("label_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
//
//  def labelType: ForeignKeyQuery[LabelTypeTable, LabelType] =
//    foreignKey("label_label_type_id_fkey", labelTypeId, TableQuery[LabelTypeTableDef])(_.labelTypeId)
}


/**
 * Companion object with constants and types that are shared throughout codebase.
 */
object LabelTable {
  // Type aliases for the tuple representation of LabelValidationMetadata and queries for them.
  // TODO in Scala 3 I think that we can make these top-level like we do for the case class version.
  type LabelValidationMetadataTuple = (Int, String, String, String, OffsetDateTime, Option[Float],
    Option[Float], Float, Float, Int, (Int, Int), Option[Int],
    Boolean, Option[String], Int, Int, (Int, Int, Int, Option[Boolean]),
    Option[Int], List[String])
  type LabelValidationMetadataTupleRep = (Rep[Int], Rep[String], Rep[String], Rep[String],
    Rep[OffsetDateTime], Rep[Option[Float]], Rep[Option[Float]],
    Rep[Float], Rep[Float], Rep[Int], (Rep[Int], Rep[Int]),
    Rep[Option[Int]], Rep[Boolean], Rep[Option[String]], Rep[Int],
    Rep[Int], (Rep[Int], Rep[Int], Rep[Int], Rep[Option[Boolean]]),
    Rep[Option[Int]], Rep[List[String]])
}


@ImplementedBy(classOf[LabelTable])
trait LabelTableRepository {
  def find(labelId: Int): DBIO[Option[Label]]
  def find(tempLabelId: Int, userId: String): DBIO[Option[Label]]
  def getRecentLabelsMetadata(takeN: Int, labelerId: Option[String] = None, validatorId: Option[String] = None, labelId: Option[Int] = None): DBIO[Seq[LabelMetadata]]
  def getExtraAdminValidateData(labelIds: Seq[Int]): DBIO[Seq[AdminValidationData]]
  def selectLocationsAndSeveritiesOfLabels(regionIds: Seq[Int], routeIds: Seq[Int]): DBIO[Seq[LabelLocationWithSeverity]]
}

@Singleton
class LabelTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends LabelTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val gf: GeometryFactory = JTSFactoryFinder.getGeometryFactory

  val labelsUnfiltered = TableQuery[LabelTableDef]
  val auditTasks = TableQuery[AuditTaskTableDef]
  val gsvData = TableQuery[GSVDataTableDef]
  val labelTypes = TableQuery[LabelTypeTableDef]
  val tagTable = TableQuery[TagTableDef]
  val labelPoints = TableQuery[LabelPointTableDef]
  val labelValidations = TableQuery[LabelValidationTableDef]
  val missions = TableQuery[MissionTableDef]
  val streets = TableQuery[StreetEdgeTableDef]
  val regions = TableQuery[RegionTableDef]
  val users = TableQuery[SidewalkUserTableDef]
  val userStats = TableQuery[UserStatTableDef]
  val userRoles = TableQuery[UserRoleTableDef]
  val roleTable = TableQuery[RoleTableDef]
  val configTable = TableQuery[ConfigTableDef]
  val streetEdgeRegions = TableQuery[StreetEdgeRegionTableDef]
  val routeStreets = TableQuery[RouteStreetTableDef]

  val neighborhoods = regions.filter(_.deleted === false)

//  // Grab the tutorial street id for the city.
//  val tutorialStreetId: Int = ConfigTable.getTutorialStreetId
  val tutorialStreetId: Query[Rep[Int], Int, Seq] = configTable.map(_.tutorialStreetEdgeID)

  // This subquery gets the most commonly accessed set of labels. It removes labels that have been deleted, labels from
  // the tutorial, and labels from users where `excluded=TRUE` in the `user_stat` table. The first version also includes
  // the joined tables, bc doing an additional join with the same table in the future can drastically slow queries.
  val labelsWithAuditTasksAndUserStats = labelsUnfiltered
    .join(auditTasks).on(_.auditTaskId === _.auditTaskId)
    .join(userStats).on(_._2.userId === _.userId)
    .filterNot(_._1._1.streetEdgeId in tutorialStreetId) // Checking label.street_edge_id.
    .filterNot(_._1._2.streetEdgeId in tutorialStreetId) // Checking audit_task.street_edge_id.
    .filterNot { case ((_l, _at), _us) => _l.deleted || _l.tutorial || _us.excluded }
    .map(x => (x._1._1, x._1._2, x._2))
  val labels = labelsWithAuditTasksAndUserStats.map(_._1)

  // Subquery for labels without deleted or tutorial ones, but includes "excluded" users. You might need to include
  // these users if you're displaying a page for one of those users (like the user dashboard).
  val labelsWithExcludedUsers = labelsUnfiltered
    .join(auditTasks).on(_.auditTaskId === _.auditTaskId)
    .filterNot(x => x._1.streetEdgeId in tutorialStreetId) // Checking label.street_edge_id.
    .filterNot(_._2.streetEdgeId in tutorialStreetId)      // Checking audit_task.street_edge_id.
    .filterNot { case (_l, _at) => _l.deleted || _l.tutorial }
    .map(_._1)

  // Subquery for labels without deleted ones, but includes tutorial labels and labels from "excluded" users. You might
  // need to include these users if you're displaying a page for one of those users (like the user dashboard).
  val labelsWithTutorialAndExcludedUsers = labelsUnfiltered.filter(_.deleted === false)

  // Subquery for labels without deleted ones or labels from "excluded" users, but includes tutorial labels.
  val labelsWithTutorial = labelsUnfiltered
    .join(userStats).on(_.userId === _.userId)
    .filterNot { case (_l, _us) => _l.deleted || _us.excluded }
    .map(_._1)

  implicit def labelMetadataConverter = GetResult[LabelMetadata] { r =>
    LabelMetadata(r.nextInt, r.nextString, r.nextBoolean, r.nextString, POV(r.nextDouble, r.nextDouble, r.nextInt),
      LocationXY(r.nextInt, r.nextInt), r.nextInt, r.nextInt, r.nextInt, r.nextString, r.nextString,
      OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC), r.nextString, r.nextString, r.nextIntOption,
      r.nextBoolean, r.nextStringOption, r.nextIntOption,
      r.nextString.split(',').map(x => x.split(':')).map { y => (y(0), y(1).toInt) }.toMap,
      r.nextString.split(",").filter(_.nonEmpty).toList, (r.nextBoolean, r.nextBoolean, r.nextBoolean),
      r.nextStringOption.filter(_.nonEmpty).map(_.split(":").filter(_.nonEmpty).toList))
  }
//  implicit val labelMetadataWithValidationConverter = GetResult[LabelMetadata](r =>
//    LabelMetadata(
//      r.nextInt, r.nextString, r.nextBoolean, r.nextString, POV(r.nextDouble, r.nextDouble, r.nextInt),
//      LocationXY(r.nextInt, r.nextInt), r.nextInt, r.nextInt, r.nextInt, r.nextString, r.nextString, OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC),
//      r.nextString, r.nextString, r.nextIntOption, r.nextBoolean, r.nextStringOption, r.nextIntOption,
//      r.nextString.split(',').map(x => x.split(':')).map { y => (y(0), y(1).toInt) }.toMap,
//      r.nextString.split(",").filter(_.nonEmpty).toList, (r.nextBoolean, r.nextBoolean, r.nextBoolean),
//      r.nextStringOption.filter(_.nonEmpty).map(_.split(":").filter(_.nonEmpty).toList)
//    )
//  )

//  implicit def labelValidationMetadataConverter = GetResult[LabelValidationMetadata] { r =>
//    LabelValidationMetadata(r.nextInt, r.nextString, r.nextString, r.nextString, r.<<[OffsetDateTime], r.nextFloat, r.nextFloat,
//      r.nextFloat, r.nextFloat, r.nextInt, LocationXY(r.nextInt, r.nextInt), r.<<?[Int], r.nextBoolean, r.<<?[String],
//      r.nextInt, r.nextInt, LabelValidationInfo(r.nextInt, r.nextInt, r.nextInt, r.<<?[Boolean]), r.<<?[Int],
//      r.<<?[String].map(tags => tags.split(",").filter(_.nonEmpty).toSeq).getOrElse(Seq())
//    )
//  }

  implicit val labelAllMetadataConverter = GetResult[LabelAllMetadata](r => LabelAllMetadata(
    r.nextInt, r.nextString, r.nextString, r.nextString, r.nextIntOption,
    r.nextStringOption.map(tags => tags.split(",").filter(_.nonEmpty).toList).getOrElse(List()), r.nextBoolean,
    r.nextStringOption, gf.createPoint(new Coordinate(r.nextDouble, r.nextDouble)),
    OffsetDateTime.ofInstant(r.nextTimestamp.toInstant, ZoneOffset.UTC), r.nextInt, r.nextLong, r.nextString,
    LabelValidationInfo(r.nextInt, r.nextInt, r.nextInt, r.nextBooleanOption),
    r.nextStringOption.map(_.split(",").map(v => (v.split(":")(0), v.split(":")(1).toInt)).toList).getOrElse(List()),
    r.nextInt, r.nextInt, r.nextString, POV(r.nextDouble, r.nextDouble, r.nextInt), LocationXY(r.nextInt, r.nextInt),
    (LocationXY(r.nextInt, r.nextInt), r.nextIntOption.flatMap(w => r.nextIntOption.map(h => Dimensions(w, h)))),
    (r.nextDouble, r.nextDouble)
  ))

//  implicit val labelLocationConverter = GetResult[LabelLocation](r =>
//    LabelLocation(r.nextInt, r.nextInt, r.nextString, r.nextString, r.nextFloat, r.nextFloat, r.nextBooleanOption, r.nextBoolean))
//
//  implicit val labelSeverityConverter = GetResult[LabelLocationWithSeverity](r =>
//    LabelLocationWithSeverity(r.nextInt, r.nextInt, r.nextString, r.nextFloat, r.nextFloat, r.nextBooleanOption,
//      r.nextBoolean, r.nextBoolean, r.nextBoolean, r.nextIntOption))

  implicit val projectSidewalkStatsConverter = GetResult[ProjectSidewalkStats](r => ProjectSidewalkStats(
    r.nextString, r.nextString, r.nextFloat, r.nextFloat, r.nextInt, r.nextInt, r.nextInt, r.nextInt, r.nextInt,
    r.nextInt, r.nextInt, r.nextInt,
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

  def find(labelId: Int): DBIO[Option[Label]] = {
    labelsUnfiltered.filter(_.labelId === labelId).result.headOption
  }

  /**
   * Find a label based on temp_label_id and user_id.
   */
  def find(tempLabelId: Int, userId: String): DBIO[Option[Label]] = {
      labelsUnfiltered.filter(l => l.temporaryLabelId === tempLabelId && l.userId === userId).result.headOption
  }

  def countLabels: DBIO[Int] = labelsWithTutorial.length.result

  def countLabels(labelType: String): DBIO[Int] = {
    labelsWithTutorial
      .join(labelTypes).on(_.labelTypeId === _.labelTypeId)
      .filter(_._2.labelType === labelType)
      .length.result
  }

//  /*
//  * Counts the number of labels added today.
//  *
//  * If the task goes over two days, then all labels for that audit task will be added for the task end date.
//  */
//  def countTodayLabels: Int = {
//    val countQuery = Q.queryNA[Int](
//      """SELECT COUNT(label_id)
//        |FROM label
//        |WHERE (time_created AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date
//        |    AND deleted = false;""".stripMargin
//    )
//    countQuery.first
//  }
//
//  /*
//  * Counts the number of specific label types added today.
//  *
//  * If the task goes over two days, then all labels for that audit task will be added for the task end date.
//  */
//  def countTodayLabels(labelType: String): Int = {
//    val countQuery = Q.queryNA[Int](
//      s"""SELECT COUNT(label_id)
//         |FROM label
//         |WHERE (time_created AT TIME ZONE 'US/Pacific')::date = (now() AT TIME ZONE 'US/Pacific')::date
//         |    AND label.deleted = false
//         |    AND label.label_type_id = '${LabelTypeTable.labelTypeToId(labelType).get}';""".stripMargin
//    )
//    countQuery.first
//  }
//
//  /*
//  * Counts the number of labels added during the last week.
//  */
//  def countPastWeekLabels: Int = {
//    val countQuery = Q.queryNA[Int](
//      """SELECT COUNT(label_id)
//        |FROM label
//        |WHERE (time_created AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
//        |    AND deleted = false;""".stripMargin
//    )
//    countQuery.first
//  }
//
//  /*
//  * Counts the number of specific label types added during the last week.
//  */
//  def countPastWeekLabels(labelType: String): Int = {
//    val countQuery = Q.queryNA[Int](
//      s"""SELECT COUNT(label.label_id)
//         |FROM label
//         |INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
//         |WHERE (time_created AT TIME ZONE 'US/Pacific') > (now() AT TIME ZONE 'US/Pacific') - interval '168 hours'
//         |    AND label.deleted = false
//         |    AND label_type.label_type = '$labelType';""".stripMargin
//    )
//    countQuery.first
//  }

  /**
    * Returns the number of labels submitted by the given user.
    *
    * @param userId User id
    * @return A number of labels submitted by the user
    */
  def countLabelsFromUser(userId: String): DBIO[Int] = {
    labelsWithExcludedUsers.filter(_.userId === userId).size.result
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
  def getRecentLabelsMetadata(takeN: Int, labelerId: Option[String] = None, validatorId: Option[String] = None, labelId: Option[Int] = None): DBIO[Seq[LabelMetadata]] = {
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

    sql"""
      SELECT lb1.label_id,
             lb1.gsv_panorama_id,
             lb1.tutorial,
             gsv_data.capture_date,
             lp.heading,
             lp.pitch,
             lp.zoom,
             lp.canvas_x,
             lp.canvas_y,
             lb1.audit_task_id,
             lb1.street_edge_id,
             ser.region_id,
             u.user_id,
             u.username,
             lb1.time_created,
             lb_big.label_type,
             lb_big.label_type_desc,
             lb_big.severity,
             lb_big.temporary,
             lb_big.description,
             lb_big.validation_result,
             val.val_counts,
             array_to_string(lb_big.tags, ','),
             at.low_quality,
             at.incomplete,
             at.stale,
             comment.comments
      FROM label AS lb1
      INNER JOIN gsv_data ON lb1.gsv_panorama_id = gsv_data.gsv_panorama_id
      INNER JOIN audit_task AS at ON lb1.audit_task_id = at.audit_task_id
      INNER JOIN street_edge_region AS ser ON lb1.street_edge_id = ser.street_edge_id
      INNER JOIN sidewalk_login.sidewalk_user AS u ON at.user_id = u.user_id
      INNER JOIN label_point AS lp ON lb1.label_id = lp.label_id
      INNER JOIN (
          SELECT lb.label_id,
                 lb.gsv_panorama_id,
                 lbt.label_type,
                 lbt.description AS label_type_desc,
                 lb.severity,
                 lb.temporary,
                 lb.description,
                 user_validation.validation_result,
                 lb.tags
          FROM label AS lb
          INNER JOIN label_type as lbt ON lb.label_type_id = lbt.label_type_id
          #$validatorJoin
      ) AS lb_big ON lb1.label_id = lb_big.label_id
      INNER JOIN (
          SELECT label_id,
                 CONCAT('agree:', CAST(agree_count AS TEXT),
                        ',disagree:', CAST(disagree_count AS TEXT),
                        ',unsure:', CAST(unsure_count AS TEXT)) AS val_counts
          FROM label
      ) AS val ON lb1.label_id = val.label_id
      LEFT JOIN (
          SELECT label_id, string_agg(comment, ':') AS comments
          FROM validation_task_comment
          GROUP BY label_id
       ) AS comment ON lb1.label_id = comment.label_id
      WHERE #$labelFilter
          AND #$labelerFilter
      ORDER BY lb1.label_id DESC
      LIMIT $takeN
    """.as[LabelMetadata]
  }

  /**
    * Returns how many labels this user has available to validate (& how many need validations) for each label type.
    */
  def getAvailableValidationsLabelsByType(userId: String): DBIO[Seq[LabelTypeValidationsLeft]] = {
    val labelsValidatedByUser = labelValidations.filter(_.userId === userId)

    // Get labels the given user has not placed that have non-expired GSV imagery.
    val labelsToValidate =  for {
      _lb <- labels
      _gd <- gsvData if _gd.gsvPanoramaId === _lb.gsvPanoramaId
      _us <- userStats if _lb.userId === _us.userId
      if _us.highQuality && _gd.expired === false && _lb.userId =!= userId
    } yield (_lb.labelId, _lb.labelTypeId, _lb.correct)

    // Left join with the labels that the user has already validated, then filter those out.
    val filteredLabelsToValidate = for {
      (_lab, _val) <- labelsToValidate.joinLeft(labelsValidatedByUser).on(_._1 === _.labelId)
      if _val.isEmpty
    } yield _lab

    // Group by the label_type_id and count.
    filteredLabelsToValidate
      .groupBy(_._2).map{ case (labType, group) =>
        (labType, group.length, group.length - group.map(_._3).countDefined)
      }.result.map(_.map(x => LabelTypeValidationsLeft(x._1, x._2, x._3)))
  }

  /**
   * Returns a query to get set of labels matching filters for validation, ordered according to our priority algorithm.
   *
   * Priority is determined as follows: Generate a priority num for each label between 0 and 276. A label gets 100
   * points if the labeler has < 50 of their labels validated (and this label needs a validation). Another 50 points if
   * the labeler was marked as high quality. Up to 100 more points (100 / (1 + abs(agree_count - disagree_count)))
   * depending on how far we are from consensus. Another 25 points if the label was added in the past week. Then add a
   * random number so that the max score for each label is 276.
   *
   * @param userId         User ID for the current user.
   * @param labelTypeId    Label Type ID of labels requested.
   * @param userIds        Optional list of user IDs to filter by.
   * @param regionIds      Optional list of region IDs to filter by.
   * @param skippedLabelId Label ID of the label that was just skipped (if applicable).
   * @return               Seq[LabelValidationMetadata]
   */
  def retrieveLabelListForValidationQuery(userId: String, labelTypeId: Int, userIds: Set[String]=Set(), regionIds: Set[Int]=Set(), skippedLabelId: Option[Int]=None): Query[LabelValidationMetadataTupleRep, LabelValidationMetadataTuple, Seq] = {
    val _labelInfo = for {
      (_lb, _at, _us) <- labelsWithAuditTasksAndUserStats
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
      _gd <- gsvData if _lb.gsvPanoramaId === _gd.gsvPanoramaId
      _ser <- streetEdgeRegions if _lb.streetEdgeId === _ser.streetEdgeId
      if _lt.labelTypeId === labelTypeId && !_gd.expired && _lp.lat.isDefined && _lp.lng.isDefined && _lb.userId =!= userId
      if (_lb.labelId =!= skippedLabelId) || skippedLabelId.isEmpty // TODO test that this works correctly.
      if (_ser.regionId inSet regionIds) || regionIds.isEmpty
      if (_lb.userId inSet userIds) || userIds.isEmpty
    } yield (_lb, _lp, _lt, _gd, _us, _ser, _at)

    // Filter out labels that have already been validated by this user.
    val _labelInfoFiltered = _labelInfo
      .joinLeft(labelValidations.filter(_.userId === userId)).on(_._1.labelId === _.labelId)
      .filter(_._2.isEmpty)
      .map(_._1)

    // This subquery counts how many of each users' labels have been validated. If it's less than 50, then we need more
    // validations from them in order to infer worker quality, and they therefore get priority.
    val needsValidationsQuery = labels
      .filter(l => !l.deleted && !l.tutorial)
      .groupBy(_.userId)
      .map { case (userId, group) =>
        (userId, group.filter(_.correct.isDefined).length < 50)
      }

    // Priority ordering algorithm is described in the method comment, max score is 276.
    val _labelInfoSorted = _labelInfoFiltered
      .joinLeft(needsValidationsQuery).on(_._1.userId === _._1)
      .sortBy {
        case ((l, lp, lt, gd, us, ser, at), nv) => {
          // A label gets 100 if the labeler as < 50 of their labels validated (and this label needs a validation).
          val needsValidationScore = Case.If(
            nv.map(_._2).getOrElse(true) && l.correct.isEmpty && !at.lowQuality && !at.stale
          ).Then(100D).Else(0D)

          // Another 50 points if the labeler was marked as high quality.
          val highQualityScore = Case.If(us.highQuality).Then(50D).Else(0D)

          // Up to 100 points based on how far we are from consensus: (100 / (1 + abs(agree_count - disagree_count))).
          val agreementScore = 100.0D.bind / (1D.bind + (l.agreeCount - l.disagreeCount).abs.asColumnOf[Double])

          // Another 25 points if the label was added in the past week.
          val currentTimestamp = SimpleLiteral[OffsetDateTime]("current_timestamp")
          val weekInterval = SimpleLiteral[Duration]("interval '7 days'")
          val recencyScore = Case.If(l.timeCreated > currentTimestamp --- weekInterval).Then(25D).Else(0D)

          // Calculate the total deterministic score.
          val deterministicScore: Rep[Double] = needsValidationScore + highQualityScore + agreementScore + recencyScore

          // Finally, add a random number so that the max score for each label is 276. Sort descending.
          val rand = SimpleFunction.nullary[Double]("random")
          (deterministicScore + rand * (276.0D.bind - deterministicScore)).desc
        }
      }
      // Select only the columns needed for the LabelValidationMetadata class.
      .map { case ((l, lp, lt, gd, us, ser, at), nv) => (
        l.labelId, lt.labelType, l.gsvPanoramaId, gd.captureDate, l.timeCreated, lp.lat, lp.lng, lp.heading, lp.pitch,
        lp.zoom, (lp.canvasX, lp.canvasY), l.severity, l.temporary, l.description, l.streetEdgeId, ser.regionId,
        (l.agreeCount, l.disagreeCount, l.unsureCount, l.correct), Option.empty[Int].bind, l.tags
      )}
    _labelInfoSorted
  }

  /**
   * Get additional info about a label for use by admins on Admin Validate.
   * @param labelIds
   * @return
   */
  def getExtraAdminValidateData(labelIds: Seq[Int]): DBIO[Seq[AdminValidationData]] = {
    labelsUnfiltered.filter(_.labelId inSet labelIds)
      // Inner join label -> sidewalk_user to get username of person who placed the label.
      .join(users).on(_.userId === _.userId)
      // Left join label -> label_validation -> sidewalk_user to get username & validation result of ppl who validated.
      .joinLeft(labelValidations).on(_._1.labelId === _.labelId)
      .joinLeft(users).on(_._2.map(_.userId) === _.userId)
      .map(x => (x._1._1._1.labelId, x._1._1._2.username, x._2.map(_.username), x._1._2.map(_.validationResult)))
      .result.map { results =>  // This starts the in-memory operations.
        results
          // Turn the left joined validators into lists of tuples.
          .groupBy(l => (l._1, l._2))
          .map(x => (x._1._1, x._1._2, x._2.map(y => (y._3, y._4)))).toSeq
          .map(y => (y._1, y._2, y._3.collect({ case (Some(a), Some(b)) => (a, b) })))
          .map(AdminValidationData.tupled)
      }
  }

  /**
   * Retrieves n labels of specified label type, severities, and tags. If no label type supplied, split across types.
   *
   * @param labelTypeId       Label type specifying what type of labels to grab.
   * @param loadedLabelIds    Set of labelIds already grabbed as to not grab them again.
   * @param valOptions        Set of correctness values to filter for: correct, incorrect, unsure, and/or unvalidated.
   * @param regionIds         Set of neighborhoods to get labels from. All neighborhoods if empty.
   * @param severity          Set of severities the labels grabbed can have.
   * @param tags              Set of tags the labels grabbed can have.
   * @param userId            User ID of the user requesting the labels.
   * @return                  Query object to get the labels.
   */
  def getGalleryLabelsQuery(labelTypeId: Int, loadedLabelIds: Set[Int], valOptions: Set[String], regionIds: Set[Int], severity: Set[Int], tags: Set[String], userId: String): Query[LabelValidationMetadataTupleRep, LabelValidationMetadataTuple, Seq] = {
    // Filter labels based on correctness.
    val _labelsFilteredByCorrectness = {
      var query = labels
      if (!valOptions.contains("correct")) query = query.filter(l => l.correct.isEmpty || !l.correct)
      if (!valOptions.contains("incorrect")) query = query.filter(l => l.correct.isEmpty || l.correct)
      if (!valOptions.contains("unsure")) query = query.filter(l => l.correct.isDefined || (l.agreeCount === 0 && l.disagreeCount === 0 && l.unsureCount === 0))
      if (!valOptions.contains("unvalidated")) query = query.filter(l => l.agreeCount > 0 || l.disagreeCount > 0 || l.unsureCount > 0)
      query
    }

    val _labelInfo = for {
      _lb <- _labelsFilteredByCorrectness if !(_lb.labelId inSet loadedLabelIds)
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
      _gd <- gsvData if _lb.gsvPanoramaId === _gd.gsvPanoramaId
      _us <- userStats if _lb.userId === _us.userId
      _ser <- streetEdgeRegions if _lb.streetEdgeId === _ser.streetEdgeId
      if _gd.expired === false
      if _lp.lat.isDefined && _lp.lng.isDefined
      if _lt.labelTypeId === labelTypeId
      if (_ser.regionId inSet regionIds) || regionIds.isEmpty
      if (_lb.severity inSet severity) || severity.isEmpty
      if (_lb.tags @& tags.toList) || tags.isEmpty // @& is the overlap operator from postgres (&& in postgres).
      if _us.highQuality || (_lb.correct.isDefined && _lb.correct === true)
      if _lb.disagreeCount < 3 || _lb.disagreeCount < _lb.agreeCount * 2
    } yield (_lb, _lp, _lt, _gd, _ser)

    // Join with user validations.
    val _userValidations = labelValidations.filter(_.userId === userId)
    val _labelInfoWithUserVals = for {
      (l, v) <- _labelInfo.joinLeft(_userValidations).on(_._1.labelId === _.labelId)
    } yield (l._1.labelId, l._3.labelType, l._1.gsvPanoramaId, l._4.captureDate, l._1.timeCreated,
      l._2.lat, l._2.lng, l._2.heading, l._2.pitch, l._2.zoom,
      (l._2.canvasX, l._2.canvasY), l._1.severity, l._1.temporary,
      l._1.description, l._1.streetEdgeId, l._5.regionId,
      (l._1.agreeCount, l._1.disagreeCount, l._1.unsureCount, l._1.correct),
      v.map(_.validationResult), l._1.tags)

    // Remove duplicates if needed and randomize.
    val rand = SimpleFunction.nullary[Double]("random")
    val _uniqueLabels = if (tags.nonEmpty)
      _labelInfoWithUserVals.groupBy(x => x).map(_._1).sortBy(_ => rand)
    else
      _labelInfoWithUserVals.sortBy(_ => rand)

    _uniqueLabels
  }

//  /**
//   * Get user's labels most recently validated as incorrect. Up to `nPerType` per label type.
//   *
//   * @param userId Id of the user who made these mistakes.
//   * @param nPerType Number of mistakes to acquire of each label type.
//   * @param labTypes List of label types where we are looking for mistakes.
//   * @return
//   */
//  def getRecentValidatedLabelsForUser(userId: UUID, nPerType: Int, labTypes: List[String]): List[LabelMetadataUserDash] = {
//    // Attach comments to validations using a left join.
//    val _validationsWithComments = labelValidations
//      .joinLeft(ValidationTaskCommentTable.validationTaskComments)
//      .on((v, c) => v.missionId === c.missionId && v.labelId === c.labelId)
//      .map(x => (x._1.labelId, x._1.validationResult, x._1.userId, x._1.missionId, x._1.endTimestamp.?, x._2.comment.?))
//
//    // Grab validations and associated label information for the given user's labels.
//    val _validations = for {
//      _lb <- labelsWithExcludedUsers
//      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
//      _lp <- labelPoints if _lb.labelId === _lp.labelId
//      _gd <- gsvData if _lb.gsvPanoramaId === _gd.gsvPanoramaId
//      _vc <- _validationsWithComments if _lb.labelId === _vc._1
//      _us <- userStats if _vc._3 === _us.userId
//      if _lb.userId === userId.toString && // Only include the given user's labels.
//        _vc._3 =!= userId.toString && // Exclude any cases where the user may have validated their own label.
//        _vc._2 === 2 && // Only times where users validated as incorrect.
//        _us.excluded === false && // Don't use validations from excluded users
//        _us.highQuality === true && // For now we only include validations from high quality users.
//        _gd.expired === false && // Only include those with non-expired GSV imagery.
//        _lb.correct.isDefined && _lb.correct === false && // Exclude outlier validations on a correct label.
//        (_lt.labelType inSet labTypes) // Only include given label types.
//    } yield (_lb.labelId, _lb.gsvPanoramaId, _lp.heading, _lp.pitch, _lp.zoom, _lp.canvasX, _lp.canvasY, _lt.labelType, _vc._5, _vc._6)
//
//    // Run query, group by label type, get most recent validation for each label, and order by recency.
//    val potentialLabels: Map[String, List[LabelMetadataUserDash]] =
//      _validations.list.map(LabelMetadataUserDash.tupled).groupBy(_.labelType).map { case (labType, labs) =>
//        val distinctLabs: List[LabelMetadataUserDash] = labs.groupBy(_.labelId).map(_._2.maxBy(_.timeValidated)).toList
//        labType -> distinctLabs.sortBy(_.timeValidated)(Ordering[Option[OffsetDateTime]].reverse)
//      }
//
//    // Get final label list by checking for GSV imagery.
//    checkForImageryByLabelType(potentialLabels, nPerType)
//  }

  /**
   * Searches in parallel for `n` labels with non-expired GSV imagery.
   * TODO remove this after I've made the new version for Play 2.4 more generic.
   *
   * @param potentialLabels A list of labels to check for non-expired GSV imagery.
   * @param n The number of to find.
   * @tparam A
   * @return
   */
//  def checkForGsvImagery[A <: BasicLabelMetadata](potentialLabels: List[A], n: Int): List[A] = {
//    var potentialStartIdx: Int = 0
//    val selectedLabels: ListBuffer[A] = new ListBuffer[A]()
//
//    // While the desired query size has not been met and there are still possibly valid labels to consider, traverse
//    // through the list incrementally and see if a potentially valid label has pano data for viewability.
//    while (selectedLabels.length < n && potentialStartIdx < potentialLabels.size) {
//      val labelsNeeded: Int = n - selectedLabels.length
//      val newLabels: Seq[A] =
//        potentialLabels.slice(potentialStartIdx, potentialStartIdx + labelsNeeded).par.flatMap { currLabel =>
//          // Include all labels that have non-expired GSV imagery.
//          panoExists(currLabel.gsvPanoramaId).flatMap(if (_) Some(currLabel) else None)
//        }.seq
//
//      potentialStartIdx += labelsNeeded
//      selectedLabels ++= newLabels
//    }
//    selectedLabels.toList
//  }

//  /**
//   * Searches in parallel for `n` labels per label type with non-expired GSV imagery.
//   * TODO remove this after I've made the new version for Play 2.4 more generic.
//   *
//   * @param potentialLabels A mapping from label type to a list of labels to check for GSV imagery.
//   * @param n The number of labels to find for each label type.
//   * @tparam A
//   * @return
//   */
//  def checkForImageryByLabelType[A <: BasicLabelMetadata](potentialLabels: Map[String, List[A]], n: Int): List[A] = {
//    // Get list of possible label types.
//    val labTypes: List[String] = potentialLabels.keySet.toList
//
//    // Prepare to check for GSV imagery in parallel by making mappings from label type to the number of labels needed
//    // for that type and index we're at in the `potentialLabels` list.
//    val numNeeded: collection.mutable.Map[String, Int] = collection.mutable.Map(labTypes.map(l => l -> n): _*)
//    val startIndex: collection.mutable.Map[String, Int] = collection.mutable.Map(labTypes.map(l => l -> 0): _*)
//
//    // Initialize list of labels to check for imagery by taking first `nPerType` for each label type.
//    var labelsToTry: List[A] = potentialLabels.flatMap { case (labelType, labelList) =>
//      labelList.slice(startIndex(labelType), startIndex(labelType) + numNeeded(labelType))
//    }.toList
//
//    // While there are still label types with fewer than `nPerType` labels and there are labels that might have valid
//    // imagery remaining, check for GSV imagery in parallel.
//    val selectedLabels: ListBuffer[A] = new ListBuffer[A]()
//    while (labelsToTry.nonEmpty) {
//      val newLabels: Seq[A] = labelsToTry.par.flatMap { currLabel =>
//        // Include all labels that have non-expired GSV imagery.
//        panoExists(currLabel.gsvPanoramaId).flatMap(if (_) Some(currLabel) else None)
//      }.seq
//      selectedLabels ++= newLabels
//
//      // Update the `startIndex`, `numNeeded`, and `labelsToTry` maps for next round.
//      labelsToTry.groupBy(_.labelType).foreach(t => startIndex(t._1) += t._2.length)
//      newLabels.groupBy(_.labelType).foreach(t => numNeeded(t._1) -= t._2.length)
//      labelsToTry = potentialLabels.flatMap { case (labelType, labelList) =>
//        labelList.slice(startIndex(labelType), startIndex(labelType) + numNeeded(labelType))
//      }.toList
//    }
//    selectedLabels.toList
//  }
//
//  /**
//    * This method returns a list of strings with all the tags associated with a label
//    *
//    * @return A list of strings with all the tags associated with a label.
//    */
//  def getTagsFromLabelId(labelId: Int): List[String] = {
//      val getTagsQuery = Q.query[Int, (String)](
//        """SELECT tag
//          |FROM tag
//          |WHERE tag.tag_id IN
//          |(
//          |    SELECT tag_id
//          |    FROM label_tag
//          |    WHERE label_tag.label_id = ?
//          |);""".stripMargin
//      )
//      getTagsQuery(labelId).list
//  }

  /**
    * Returns all the submitted labels with their severities included. If provided, filter for only given regions.
    */
  def selectLocationsAndSeveritiesOfLabels(regionIds: Seq[Int], routeIds: Seq[Int]): DBIO[Seq[LabelLocationWithSeverity]] = {
    val _labels = for {
      (_l, _at, _us) <- labelsWithAuditTasksAndUserStats
      _lType <- labelTypes if _l.labelTypeId === _lType.labelTypeId
      _lPoint <- labelPoints if _l.labelId === _lPoint.labelId
      _gsv <- gsvData if _l.gsvPanoramaId === _gsv.gsvPanoramaId
      _ser <- streetEdgeRegions if _l.streetEdgeId === _ser.streetEdgeId
      if (_ser.regionId inSet regionIds) || regionIds.isEmpty
      if _lPoint.lat.isDefined && _lPoint.lng.isDefined // Make sure they are NOT NULL so we can safely use .get later.
    } yield (
      _l.labelId, _l.auditTaskId, _lType.labelType, _lPoint.lat, _lPoint.lng, _l.correct,
      _l.agreeCount > 0 || _l.disagreeCount > 0 || _l.unsureCount > 0, _gsv.expired, _us.highQuality, _l.severity,
      _ser.streetEdgeId
    )

    // Filter for labels along the given route. Distance experimentally set to 0.0005 degrees. Would like to switch to
    // different SRID and use meters: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3655.
    val _labelsNearRoute = if (routeIds.nonEmpty) {
      (for {
        _rs <- routeStreets if _rs.routeId inSet routeIds
        _se <- streets if _rs.streetEdgeId === _se.streetEdgeId
        _l <- _labels if _se.streetEdgeId === _l._11 ||
          _se.geom.distance(makePoint(_l._5.asColumnOf[Double], _l._4.asColumnOf[Double]).setSRID(4326)) < 0.0005F
      } yield _l).distinct
    } else {
      _labels
    }

    // For some reason we couldn't use both `_l.agreeCount > 0` and `_lPoint.lat.get` in the yield without a runtime
    // error, which is why we couldn't use `.tupled` here. This was the error message:
    // SlickException: Expected an option type, found Float/REAL
    _labelsNearRoute.result.map(_.map(l => LabelLocationWithSeverity(l._1, l._2, l._3, l._4.get, l._5.get, l._6, l._7, l._8, l._9, l._10)))
  }

//  /**
//   * Returns a list of labels submitted by the given user, either everywhere or just in the given region.
//   */
//  def getLabelLocations(userId: UUID, regionId: Option[Int] = None): List[LabelLocation] = {
//    val _labels = for {
//      _l <- labelsWithExcludedUsers
//      _lt <- labelTypes if _l.labelTypeId === _lt.labelTypeId
//      _lp <- labelPoints if _l.labelId === _lp.labelId
//      _at <- auditTasks if _l.auditTaskId === _at.auditTaskId
//      _ser <- StreetEdgeRegionTable.streetEdgeRegionTable if _at.streetEdgeId === _ser.streetEdgeId
//      if _l.userId === userId.toString
//      if regionId.isEmpty.asColumnOf[Boolean] || _ser.regionId === regionId.getOrElse(-1)
//      if _lp.lat.isDefined && _lp.lng.isDefined
//    } yield (_l.labelId, _l.auditTaskId, _l.gsvPanoramaId, _lt.labelType, _lp.lat, _lp.lng, _l.correct, _l.agreeCount > 0 || _l.disagreeCount > 0 || _l.unsureCount > 0)
//
//    // For some reason we couldn't use both `_l.agreeCount > 0` and `_lPoint.lat.get` in the yield without a runtime
//    // error, which is why we couldn't use `.tupled` here. This was the error message:
//    // SlickException: Expected an option type, found Float/REAL
//    _labels.list.map(l => LabelLocation(l._1, l._2, l._3, l._4, l._5.get, l._6.get, l._7, l._8))
//  }
//
//  /**
//    * Returns a count of the number of labels placed on each day there were labels placed.
//    */
//  def selectLabelCountsPerDay: List[LabelCountPerDay] = {
//    val selectLabelCountQuery =  Q.queryNA[(String, Int)](
//      """SELECT calendar_date, COUNT(label_id)
//        |FROM
//        |(
//        |    SELECT label_id, time_created::date AS calendar_date
//        |    FROM label
//        |    WHERE deleted = FALSE
//        |) AS calendar
//        |GROUP BY calendar_date
//        |ORDER BY calendar_date;""".stripMargin
//    )
//    selectLabelCountQuery.list.map(x => LabelCountPerDay.tupled(x))
//  }
//
//  /**
//    * Select label counts per user.
//    *
//    * @return list of tuples of (user_id, role, label_count)
//    */
//  def getLabelCountsPerUser: List[(String, String, Int)] = {
//
//    val labs = for {
//      _user <- users if _user.username =!= "anonymous"
//      _userRole <- userRoles if _user.userId === _userRole.userId
//      _role <- roleTable if _userRole.roleId === _role.roleId
//      _label <- labelsWithTutorial if _user.userId === _label.userId
//    } yield (_user.userId, _role.role, _label.labelId)
//
//    // Counts the number of labels for each user by grouping by user_id and role.
//    labs.groupBy(l => (l._1, l._2)).map { case ((uId, role), group) => (uId, role, group.length) }.list
//  }

  /**
   * Select street_edge_id of street closest to lat/lng position.
   *
   * @return street_edge_id
   */
  def getStreetEdgeIdClosestToLatLng(lat: Float, lng: Float): DBIO[Int] = {
    streets.filterNot(_.deleted)
      .map(s => (s.streetEdgeId, s.geom.distance(makePoint(lng.asColumnOf[Double], lat.asColumnOf[Double]).setSRID(4326))))
      .sortBy(_._2).map(_._1).take(1).result.head
  }

  /**
   * Gets the labels placed by a user in a region.
   *
   * @param regionId Region ID to get labels from
   * @param userId User ID of user to find labels for
   * @return list of labels placed by user in region
   */
  def getLabelsFromUserInRegion(regionId: Int, userId: String): DBIO[Seq[ResumeLabelMetadata]] = {
    (for {
      _mission <- missions
      _label <- labels if _mission.missionId === _label.missionId
      _labelPoint <- labelPoints if _label.labelId === _labelPoint.labelId
      _labelType <- labelTypes if _label.labelTypeId === _labelType.labelTypeId
      _gsvData <- gsvData if _label.gsvPanoramaId === _gsvData.gsvPanoramaId
      if _mission.regionId === regionId && _mission.userId === userId
      if _labelPoint.lat.isDefined && _labelPoint.lng.isDefined
    } yield (_label, _labelType.labelType, _labelPoint, _gsvData.lat, _gsvData.lng, _gsvData.cameraHeading, _gsvData.cameraPitch, _gsvData.width, _gsvData.height))
      .result.map(_.map(ResumeLabelMetadata.tupled))
  }

  /**
   * Gets raw labels with all metadata within a bounding box for the public API.
   * @param bbox
   */
  def getAllLabelMetadata(bbox: APIBBox): SqlStreamingAction[Vector[LabelAllMetadata], LabelAllMetadata, Effect] = {
    // TODO convert to Slick syntax now that we can use .makeEnvelope, .within, and array aggregation.
    sql"""
      SELECT label.label_id, label.user_id, label.gsv_panorama_id, label_type.label_type, label.severity,
             array_to_string(label.tags, ','), label.temporary, label.description, label_point.lng, label_point.lat,
             label.time_created, label.street_edge_id, osm_way_street_edge.osm_way_id, region.name,
             label.agree_count, label.disagree_count, label.unsure_count, label.correct, vals.validations,
             audit_task.audit_task_id, label.mission_id, gsv_data.capture_date, label_point.heading,
             label_point.pitch, label_point.zoom, label_point.canvas_x, label_point.canvas_y, label_point.pano_x,
             label_point.pano_y, gsv_data.width, gsv_data.height, gsv_data.camera_heading, gsv_data.camera_pitch
      FROM label
      INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
      INNER JOIN label_point ON label.label_id = label_point.label_id
      INNER JOIN osm_way_street_edge ON label.street_edge_id = osm_way_street_edge.street_edge_id
      INNER JOIN street_edge_region ON label.street_edge_id = street_edge_region.street_edge_id
      INNER JOIN region ON street_edge_region.region_id = region.region_id
      INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
      INNER JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
      INNER JOIN user_stat ON label.user_id = user_stat.user_id
      LEFT JOIN (
          SELECT label.label_id,
          array_to_string(array_agg(CONCAT(label_validation.user_id, ':', label_validation.validation_result)), ',') AS validations
          FROM label
          INNER JOIN label_validation ON label.label_id = label_validation.label_id
          GROUP BY label.label_id
      ) AS "vals" ON label.label_id = vals.label_id
      WHERE label.deleted = FALSE
          AND label.tutorial = FALSE
          AND user_stat.excluded = FALSE
          AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
          AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
          AND label_point.lat > #${bbox.minLat}
          AND label_point.lat < #${bbox.maxLat}
          AND label_point.lng > #${bbox.minLng}
          AND label_point.lng < #${bbox.maxLng}
      ORDER BY label.label_id;
      """.as[LabelAllMetadata]
  }

  def recentLabelsAvgLabelDate(n: Int): DBIO[Option[OffsetDateTime]] = {
    labels.sortBy(_.timeCreated.desc).take(n).map(_.timeCreated).result.map { dates =>
      if (dates.nonEmpty) {
        val avgDate = dates.map(_.toInstant.toEpochMilli).sum / dates.length
        Some(Instant.ofEpochMilli(avgDate).atOffset(ZoneOffset.UTC))
      } else {
        None
      }
    }
  }

  def getOverallStatsForAPI(filterLowQuality: Boolean, launchDate: String, avgRecentLabels: Option[OffsetDateTime]): DBIO[ProjectSidewalkStats] = {
    // We use a different filter in all the sub-queries, depending on whether we filter out low quality data.
    val userFilter: String =
      if (filterLowQuality) "user_stat.high_quality"
      else "NOT user_stat.excluded"

    sql"""
      SELECT '#$launchDate' AS launch_date,
             '#${avgRecentLabels.map(_.toString).getOrElse("N/A")}' AS avg_timestamp_last_100_labels,
             km_audited.km_audited AS km_audited,
             km_audited_no_overlap.km_audited_no_overlap AS km_audited_no_overlap,
             users.total_users,
             users.audit_users,
             users.validation_users,
             users.registered_users,
             users.anon_users,
             users.turker_users,
             users.researcher_users,
             label_counts_and_severity.label_count,
             label_counts_and_severity.n_ramp,
             label_counts_and_severity.n_ramp_with_sev,
             label_counts_and_severity.ramp_sev_mean,
             label_counts_and_severity.ramp_sev_sd,
             label_counts_and_severity.n_noramp,
             label_counts_and_severity.n_noramp_with_sev,
             label_counts_and_severity.noramp_sev_mean,
             label_counts_and_severity.noramp_sev_sd,
             label_counts_and_severity.n_obs,
             label_counts_and_severity.n_obs_with_sev,
             label_counts_and_severity.obs_sev_mean,
             label_counts_and_severity.obs_sev_sd,
             label_counts_and_severity.n_surf,
             label_counts_and_severity.n_surf_with_sev,
             label_counts_and_severity.surf_sev_mean,
             label_counts_and_severity.surf_sev_sd,
             label_counts_and_severity.n_nosidewalk,
             label_counts_and_severity.n_nosidewalk_with_sev,
             label_counts_and_severity.nosidewalk_sev_mean,
             label_counts_and_severity.nosidewalk_sev_sd,
             label_counts_and_severity.n_crswlk,
             label_counts_and_severity.n_crswlk_with_sev,
             label_counts_and_severity.crswlk_sev_mean,
             label_counts_and_severity.crswlk_sev_sd,
             label_counts_and_severity.n_signal,
             0 AS signal_with_sev,
             NULL AS signal_sev_mean,
             NULL AS signal_sev_sd,
             label_counts_and_severity.n_occlusion,
             0 AS occlusion_with_sev,
             NULL AS occlusion_sev_mean,
             NULL AS occlusion_sev_sd,
             label_counts_and_severity.n_other,
             label_counts_and_severity.n_other_with_sev,
             label_counts_and_severity.other_sev_mean,
             label_counts_and_severity.other_sev_sd,
             total_val_count.validation_count,
             val_counts.n_validated,
             val_counts.n_agree,
             val_counts.n_disagree,
             1.0 * val_counts.n_agree / NULLIF(val_counts.n_validated, 0) AS overall_accuracy,
             val_counts.n_ramp_total,
             val_counts.n_ramp_agree,
             val_counts.n_ramp_disagree,
             1.0 * val_counts.n_ramp_agree / NULLIF(val_counts.n_ramp_total, 0) AS ramp_accuracy,
             val_counts.n_noramp_total,
             val_counts.n_noramp_agree,
             val_counts.n_noramp_disagree,
             1.0 * val_counts.n_noramp_agree / NULLIF(val_counts.n_noramp_total, 0) AS noramp_accuracy,
             val_counts.n_obs_total,
             val_counts.n_obs_agree,
             val_counts.n_obs_disagree,
             1.0 * val_counts.n_obs_agree / NULLIF(val_counts.n_obs_total, 0) AS obs_accuracy,
             val_counts.n_surf_total,
             val_counts.n_surf_agree,
             val_counts.n_surf_disagree,
             1.0 * val_counts.n_surf_agree / NULLIF(val_counts.n_surf_total, 0) AS surf_accuracy,
             val_counts.n_nosidewalk_total,
             val_counts.n_nosidewalk_agree,
             val_counts.n_nosidewalk_disagree,
             1.0 * val_counts.n_nosidewalk_agree / NULLIF(val_counts.n_nosidewalk_total, 0) AS nosidewalk_accuracy,
             val_counts.n_crswlk_total,
             val_counts.n_crswlk_agree,
             val_counts.n_crswlk_disagree,
             1.0 * val_counts.n_crswlk_agree / NULLIF(val_counts.n_crswlk_total, 0) AS crswlk_accuracy,
             val_counts.n_signal_total,
             val_counts.n_signal_agree,
             val_counts.n_signal_disagree,
             1.0 * val_counts.n_signal_agree / NULLIF(val_counts.n_signal_total, 0) AS signal_accuracy,
             val_counts.n_occlusion_total,
             val_counts.n_occlusion_agree,
             val_counts.n_occlusion_disagree,
             1.0 * val_counts.n_occlusion_agree / NULLIF(val_counts.n_occlusion_total, 0) AS occlusion_accuracy,
             val_counts.n_other_total,
             val_counts.n_other_agree,
             val_counts.n_other_disagree,
             1.0 * val_counts.n_other_agree / NULLIF(val_counts.n_other_total, 0) AS other_accuracy
      FROM (
          SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km_audited
          FROM street_edge
          INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
          INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
          WHERE completed = TRUE AND #$userFilter
      ) AS km_audited, (
          SELECT SUM(ST_LENGTH(ST_TRANSFORM(geom, 26918))) / 1000 AS km_audited_no_overlap
          FROM (
              SELECT DISTINCT street_edge.street_edge_id, geom
              FROM street_edge
              INNER JOIN audit_task ON street_edge.street_edge_id = audit_task.street_edge_id
              INNER JOIN user_stat ON audit_task.user_id = user_stat.user_id
              WHERE completed = TRUE AND #$userFilter
          ) distinct_streets
      ) AS km_audited_no_overlap, (
          SELECT COUNT(DISTINCT(users.user_id)) AS total_users,
                 COUNT(CASE WHEN mission_type = 'validation' THEN 1 END) AS validation_users,
                 COUNT(CASE WHEN mission_type = 'audit' THEN 1 END) AS audit_users,
                 COUNT(DISTINCT(CASE WHEN role = 'Registered' THEN user_id END)) AS registered_users,
                 COUNT(DISTINCT(CASE WHEN role = 'Anonymous' THEN user_id END)) AS anon_users,
                 COUNT(DISTINCT(CASE WHEN role = 'Turker' THEN user_id END)) AS turker_users,
                 COUNT(DISTINCT(CASE WHEN role IN ('Researcher', 'Administrator', 'Owner') THEN user_id END)) AS researcher_users
          FROM (
              SELECT users_with_type.user_id, mission_type, role.role
              FROM (
                  SELECT DISTINCT(label_validation.user_id), 'validation' AS mission_type
                  FROM label_validation
                  UNION
                  SELECT DISTINCT(user_id), 'audit' AS mission_type
                  FROM audit_task
                  WHERE audit_task.completed = TRUE
              ) users_with_type
              INNER JOIN user_stat ON users_with_type.user_id = user_stat.user_id
              INNER JOIN sidewalk_login.user_role ON users_with_type.user_id = user_role.user_id
              INNER JOIN sidewalk_login.role ON user_role.role_id = role.role_id
              WHERE #$userFilter
          ) users
      ) AS users, (
          SELECT COUNT(*) AS label_count,
                 COUNT(CASE WHEN label_type.label_type = 'CurbRamp' THEN 1 END) AS n_ramp,
                 COUNT(CASE WHEN label_type.label_type = 'CurbRamp' AND severity IS NOT NULL THEN 1 END) AS n_ramp_with_sev,
                 avg(CASE WHEN label_type.label_type = 'CurbRamp' THEN severity END) AS ramp_sev_mean,
                 stddev(CASE WHEN label_type.label_type = 'CurbRamp' THEN severity END) AS ramp_sev_sd,
                 COUNT(CASE WHEN label_type.label_type = 'NoCurbRamp' THEN 1 END) AS n_noramp,
                 COUNT(CASE WHEN label_type.label_type = 'NoCurbRamp' AND severity IS NOT NULL THEN 1 END) AS n_noramp_with_sev,
                 avg(CASE WHEN label_type.label_type = 'NoCurbRamp' THEN severity END) AS noramp_sev_mean,
                 stddev(CASE WHEN label_type.label_type = 'NoCurbRamp' THEN severity END) AS noramp_sev_sd,
                 COUNT(CASE WHEN label_type.label_type = 'Obstacle' THEN 1 END) AS n_obs,
                 COUNT(CASE WHEN label_type.label_type = 'Obstacle' AND severity IS NOT NULL THEN 1 END) AS n_obs_with_sev,
                 avg(CASE WHEN label_type.label_type = 'Obstacle' THEN severity END) AS obs_sev_mean,
                 stddev(CASE WHEN label_type.label_type = 'Obstacle' THEN severity END) AS obs_sev_sd,
                 COUNT(CASE WHEN label_type.label_type = 'SurfaceProblem' THEN 1 END) AS n_surf,
                 COUNT(CASE WHEN label_type.label_type = 'SurfaceProblem' AND severity IS NOT NULL THEN 1 END) AS n_surf_with_sev,
                 avg(CASE WHEN label_type.label_type = 'SurfaceProblem' THEN severity END) AS surf_sev_mean,
                 stddev(CASE WHEN label_type.label_type = 'SurfaceProblem' THEN severity END) AS surf_sev_sd,
                 COUNT(CASE WHEN label_type.label_type = 'NoSidewalk' THEN 1 END) AS n_nosidewalk,
                 COUNT(CASE WHEN label_type.label_type = 'NoSidewalk' AND severity IS NOT NULL THEN 1 END) AS n_nosidewalk_with_sev,
                 avg(CASE WHEN label_type.label_type = 'NoSidewalk' THEN severity END) AS nosidewalk_sev_mean,
                 stddev(CASE WHEN label_type.label_type = 'NoSidewalk' THEN severity END) AS nosidewalk_sev_sd,
                 COUNT(CASE WHEN label_type.label_type = 'Crosswalk' THEN 1 END) AS n_crswlk,
                 COUNT(CASE WHEN label_type.label_type = 'Crosswalk' AND severity IS NOT NULL THEN 1 END) AS n_crswlk_with_sev,
                 avg(CASE WHEN label_type.label_type = 'Crosswalk' THEN severity END) AS crswlk_sev_mean,
                 stddev(CASE WHEN label_type.label_type = 'Crosswalk' THEN severity END) AS crswlk_sev_sd,
                 COUNT(CASE WHEN label_type.label_type = 'Signal' THEN 1 END) AS n_signal,
                 COUNT(CASE WHEN label_type.label_type = 'Occlusion' THEN 1 END) AS n_occlusion,
                 COUNT(CASE WHEN label_type.label_type = 'Other' THEN 1 END) AS n_other,
                 COUNT(CASE WHEN label_type.label_type = 'Other' AND severity IS NOT NULL THEN 1 END) AS n_other_with_sev,
                 avg(CASE WHEN label_type.label_type = 'Other' THEN severity END) AS other_sev_mean,
                 stddev(CASE WHEN label_type.label_type = 'Other' THEN severity END) AS other_sev_sd
          FROM label
          INNER JOIN user_stat ON label.user_id = user_stat.user_id
          INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
          INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
          WHERE #$userFilter
              AND deleted = FALSE
              AND tutorial = FALSE
              AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
              AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
      ) AS label_counts_and_severity, (
          SELECT COUNT(*) AS validation_count
          FROM label_validation
          INNER JOIN user_stat ON label_validation.user_id = user_stat.user_id
          WHERE #$userFilter
      ) AS total_val_count, (
          SELECT COUNT(CASE WHEN correct THEN 1 END) AS n_agree,
                 COUNT(CASE WHEN NOT correct THEN 1 END) AS n_disagree,
                 COUNT(CASE WHEN correct IS NOT NULL THEN 1 END) AS n_validated,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND correct THEN 1 END) AS n_ramp_agree,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND NOT correct THEN 1 END) AS n_ramp_disagree,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND correct IS NOT NULL THEN 1 END) AS n_ramp_total,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct THEN 1 END) AS n_noramp_agree,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND NOT correct THEN 1 END) AS n_noramp_disagree,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct IS NOT NULL THEN 1 END) AS n_noramp_total,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND correct THEN 1 END) AS n_obs_agree,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND NOT correct THEN 1 END) AS n_obs_disagree,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND correct IS NOT NULL THEN 1 END) AS n_obs_total,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct THEN 1 END) AS n_surf_agree,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND NOT correct THEN 1 END) AS n_surf_disagree,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct IS NOT NULL THEN 1 END) AS n_surf_total,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct THEN 1 END) AS n_nosidewalk_agree,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND NOT correct THEN 1 END) AS n_nosidewalk_disagree,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct IS NOT NULL THEN 1 END) AS n_nosidewalk_total,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND correct THEN 1 END) AS n_crswlk_agree,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND NOT correct THEN 1 END) AS n_crswlk_disagree,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND correct IS NOT NULL THEN 1 END) AS n_crswlk_total,
                 COUNT(CASE WHEN label_type = 'Signal' AND correct THEN 1 END) AS n_signal_agree,
                 COUNT(CASE WHEN label_type = 'Signal' AND NOT correct THEN 1 END) AS n_signal_disagree,
                 COUNT(CASE WHEN label_type = 'Signal' AND correct IS NOT NULL THEN 1 END) AS n_signal_total,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND correct THEN 1 END) AS n_occlusion_agree,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND NOT correct THEN 1 END) AS n_occlusion_disagree,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND correct IS NOT NULL THEN 1 END) AS n_occlusion_total,
                 COUNT(CASE WHEN label_type = 'Other' AND correct THEN 1 END) AS n_other_agree,
                 COUNT(CASE WHEN label_type = 'Other' AND NOT correct THEN 1 END) AS n_other_disagree,
                 COUNT(CASE WHEN label_type = 'Other' AND correct IS NOT NULL THEN 1 END) AS n_other_total
          FROM label
          INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
          INNER JOIN user_stat ON label.user_id = user_stat.user_id
          INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
          WHERE #$userFilter
              AND deleted = FALSE
              AND tutorial = FALSE
              AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
              AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
      ) AS val_counts;""".as[ProjectSidewalkStats].head
  }

  /**
   * Get next temp label id to be used. That would be the max used + 1, or just 1 if no labels in this task.
   */
  def nextTempLabelId(userId: String): DBIO[Int] = {
    labelsUnfiltered.filter(_.userId === userId).map(_.temporaryLabelId).max.result.map(_.map(x => x + 1).getOrElse(1))
  }

//  /**
//   * Get metadata used for 2022 CV project for all labels.
//   */
//  def getLabelCVMetadata(startIndex: Int, batchSize: Int): List[LabelCVMetadata] = {
//    (for {
//      _l <- labels
//      _lp <- labelPoints if _l.labelId === _lp.labelId
//      _gsv <- gsvData if _l.gsvPanoramaId === _gsv.gsvPanoramaId
//      if _gsv.cameraHeading.isDefined && _gsv.cameraPitch.isDefined
//    } yield (
//      _l.labelId, _gsv.gsvPanoramaId, _l.labelTypeId, _l.agreeCount, _l.disagreeCount, _l.unsureCount, _gsv.width,
//      _gsv.height, _lp.panoX, _lp.panoY, LabelPointTable.canvasWidth, LabelPointTable.canvasHeight, _lp.canvasX,
//      _lp.canvasY, _lp.zoom, _lp.heading, _lp.pitch, _gsv.cameraHeading.asColumnOf[Float],
//      _gsv.cameraPitch.asColumnOf[Float]
//    )).sortBy(_._1).drop(startIndex).take(batchSize).list.map(LabelCVMetadata.tupled)
//  }
}
