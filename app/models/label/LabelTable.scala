package models.label

import com.google.inject.ImplementedBy
import formats.json.ApiFormats
import models.api.{LabelDataForApi, LabelValidationSummaryForApi, RawLabelFiltersForApi}
import models.audit.AuditTaskTableDef
import models.computation.StreamingApiType
import models.gsv.{GsvData, GsvDataTableDef}
import models.label.LabelTable._
import models.label.LabelTypeEnum._
import models.mission.MissionTableDef
import models.region.RegionTableDef
import models.route.RouteStreetTableDef
import models.street.{StreetEdgeRegionTableDef, StreetEdgeTableDef}
import models.user._
import models.utils.MyPostgresProfile.api._
import models.utils.{ConfigTableDef, MyPostgresProfile}
import models.validation.{LabelValidationTableDef, ValidationTaskCommentTableDef}
import org.geotools.geometry.jts.JTSFactoryFinder
import org.locationtech.jts.geom.GeometryFactory
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.JsValue
import service.TimeInterval
import service.TimeInterval.TimeInterval
import slick.jdbc.GetResult
import slick.sql.SqlStreamingAction
import java.time.{Duration, Instant, OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class Label(
    labelId: Int,
    auditTaskId: Int,
    missionId: Int,
    userId: String,
    gsvPanoramaId: String,
    labelTypeId: Int,
    deleted: Boolean,
    temporaryLabelId: Int,
    timeCreated: OffsetDateTime,
    tutorial: Boolean,
    streetEdgeId: Int,
    agreeCount: Int,
    disagreeCount: Int,
    unsureCount: Int,
    correct: Option[Boolean],
    severity: Option[Int],
    description: Option[String],
    tags: List[String]
)

case class LabelValidationInfo(agreeCount: Int, disagreeCount: Int, unsureCount: Int, correct: Option[Boolean])
case class POV(heading: Double, pitch: Double, zoom: Int)
case class Dimensions(width: Int, height: Int)
case class LocationXY(x: Int, y: Int)

case class LabelLocation(
    labelId: Int,
    auditTaskId: Int,
    gsvPanoramaId: String,
    labelType: String,
    lat: Float,
    lng: Float,
    correct: Option[Boolean],
    hasValidations: Boolean
)

case class LabelForLabelMap(
    labelId: Int,
    auditTaskId: Int,
    labelType: String,
    lat: Float,
    lng: Float,
    correct: Option[Boolean],
    hasValidations: Boolean,
    aiValidation: Option[Int],
    expired: Boolean,
    highQualityUser: Boolean,
    severity: Option[Int]
)

case class TagCount(labelType: String, tag: String, count: Int)
case class LabelSeverityStats(
    n: Int,
    nWithSeverity: Option[Int],
    severityMean: Option[Float],
    severitySD: Option[Float]
)
case class LabelAccuracy(n: Int, nAgree: Int, nDisagree: Int, accuracy: Option[Float], nWithValidation: Int)
case class AiConcurrence(aiYesHumanConcurs: Int, aiYesHumanDiffers: Int, aiNoHumanDiffers: Int, aiNoHumanConcurs: Int)
case class ProjectSidewalkStats(
    launchDate: String,
    avgTimestampLast100Labels: OffsetDateTime,
    kmExplored: Float,
    kmExploreNoOverlap: Float,
    nUsers: Int,
    nExplorers: Int,
    nValidators: Int,
    nRegistered: Int,
    nAnon: Int,
    nTurker: Int,
    nResearcher: Int,
    nLabels: Int,
    nLabelsWithSeverity: Int,
    avgLabelTimestamp: OffsetDateTime,
    avgImageAgeByLabel: Duration,
    severityByLabelType: Map[String, LabelSeverityStats],
    nValidations: Int,
    accuracyByLabelType: Map[String, LabelAccuracy],
    aiPerformance: Map[String, Map[String, AiConcurrence]]
)
case class LabelTypeValidationsLeft(labelType: LabelTypeEnum.Base, validationsAvailable: Int, validationsNeeded: Int)

case class LabelCount(count: Int, timeInterval: TimeInterval, labelType: String) {
  require((validLabelTypes ++ Seq("All")).contains(labelType))
}

// Defines some common fields for a label metadata, which allows us to create generic functions using these fields.
trait BasicLabelMetadata {
  val labelId: Int
  val labelType: String
  val gsvPanoramaId: String
  val pov: POV
}

case class LabelMetadata(
    labelId: Int,
    gsvPanoramaId: String,
    tutorial: Boolean,
    imageCaptureDate: String,
    pov: POV,
    canvasXY: LocationXY,
    auditTaskId: Int,
    streetEdgeId: Int,
    regionId: Int,
    userId: String,
    username: String,
    timestamp: OffsetDateTime,
    labelType: String,
    severity: Option[Int],
    description: Option[String],
    userValidation: Option[Int],
    aiValidation: Option[Int],
    validations: Map[String, Int],
    tags: List[String],
    lowQualityIncompleteStaleFlags: (Boolean, Boolean, Boolean),
    comments: Option[Seq[String]]
)

// Extra data to include with validations for Admin Validate. Includes usernames and previous validators.
case class AdminValidationData(labelId: Int, username: String, previousValidations: Seq[(String, Int)])

case class ResumeLabelMetadata(
    labelData: Label,
    labelType: String,
    pointData: LabelPoint,
    panoLat: Option[Float],
    panoLng: Option[Float],
    cameraHeading: Option[Float],
    cameraPitch: Option[Float],
    panoWidth: Option[Int],
    panoHeight: Option[Int]
)

case class LabelCVMetadata(
    labelId: Int,
    panoId: String,
    labelTypeId: Int,
    agreeCount: Int,
    disagreeCount: Int,
    unsureCount: Int,
    panoWidth: Option[Int],
    panoHeight: Option[Int],
    panoX: Int,
    panoY: Int,
    canvasWidth: Int,
    canvasHeight: Int,
    canvasX: Int,
    canvasY: Int,
    zoom: Int,
    heading: Float,
    pitch: Float,
    cameraHeading: Float,
    cameraPitch: Float
) extends StreamingApiType {
  def toJson: JsValue  = ApiFormats.labelCVMetadataToJSON(this)
  def toCsvRow: String = ApiFormats.labelCVMetadataToCSVRow(this)
}
object LabelCVMetadata {
  val csvHeader: String = "Label ID,Panorama ID,Label Type ID,Agree Count,Disagree Count,Unsure Count,Panorama Width," +
    "Panorama Height,Panorama X,Panorama Y,Canvas Width,Canvas Height,Canvas X,Canvas Y,Zoom,Heading,Pitch," +
    "Camera Heading,Camera Pitch\n"
}

case class LabelDataForAi(labelId: Int, labelTypeId: Int, labelPoint: LabelPoint, gsvData: GsvData)

case class LabelMetadataUserDash(
    labelId: Int,
    gsvPanoramaId: String,
    pov: POV,
    canvasX: Int,
    canvasY: Int,
    labelType: String,
    timeValidated: OffsetDateTime,
    validatorComment: Option[String]
) extends BasicLabelMetadata

// NOTE: canvas_x and canvas_y are null when the label is not visible when validation occurs.
case class LabelValidationMetadata(
    labelId: Int,
    labelType: String,
    gsvPanoramaId: String,
    imageCaptureDate: String,
    timestamp: OffsetDateTime,
    lat: Float,
    lng: Float,
    pov: POV,
    canvasXY: LocationXY,
    severity: Option[Int],
    description: Option[String],
    streetEdgeId: Int,
    regionId: Int,
    validationInfo: LabelValidationInfo,
    userValidation: Option[Int],
    aiValidation: Option[Int],
    tags: Seq[String],
    cameraLat: Option[Float],
    cameraLng: Option[Float],
    aiTags: Option[Seq[String]]
) extends BasicLabelMetadata

class LabelTableDef(tag: slick.lifted.Tag) extends Table[Label](tag, "label") {
  def labelId: Rep[Int]                = column[Int]("label_id", O.PrimaryKey, O.AutoInc)
  def auditTaskId: Rep[Int]            = column[Int]("audit_task_id")
  def missionId: Rep[Int]              = column[Int]("mission_id")
  def userId: Rep[String]              = column[String]("user_id")
  def gsvPanoramaId: Rep[String]       = column[String]("gsv_panorama_id")
  def labelTypeId: Rep[Int]            = column[Int]("label_type_id")
  def deleted: Rep[Boolean]            = column[Boolean]("deleted")
  def temporaryLabelId: Rep[Int]       = column[Int]("temporary_label_id")
  def timeCreated: Rep[OffsetDateTime] = column[OffsetDateTime]("time_created")
  def tutorial: Rep[Boolean]           = column[Boolean]("tutorial")
  def streetEdgeId: Rep[Int]           = column[Int]("street_edge_id")
  def agreeCount: Rep[Int]             = column[Int]("agree_count")
  def disagreeCount: Rep[Int]          = column[Int]("disagree_count")
  def unsureCount: Rep[Int]            = column[Int]("unsure_count")
  def correct: Rep[Option[Boolean]]    = column[Option[Boolean]]("correct")
  def severity: Rep[Option[Int]]       = column[Option[Int]]("severity")
  def description: Rep[Option[String]] = column[Option[String]]("description")
  def tags: Rep[List[String]]          = column[List[String]]("tags", O.Default(List()))

  def * = (labelId, auditTaskId, missionId, userId, gsvPanoramaId, labelTypeId, deleted, temporaryLabelId, timeCreated,
    tutorial, streetEdgeId, agreeCount, disagreeCount, unsureCount, correct, severity, description, tags) <> (
    (Label.apply _).tupled,
    Label.unapply
  )

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
  // Define a type class for converting tuples to instances of a case class.
  trait TupleConverter[Tuple, A] {
    def fromTuple(tuple: Tuple): A
  }

  // Type aliases for the tuple representation of LabelMetadataUserDash and queries for them.
  // TODO in Scala 3 I think that we can make these top-level like we do for the case class version.
  type LabelMetadataUserDashTuple =
    (Int, String, (Double, Double, Int), Int, Int, String, OffsetDateTime, Option[String])
  type LabelMetadataUserDashTupleRep = (
      Rep[Int],                             // labelId
      Rep[String],                          // gsvPanoramaId
      (Rep[Double], Rep[Double], Rep[Int]), // pov (heading, pitch, zoom)
      Rep[Int],                             // canvasX
      Rep[Int],                             // canvasY
      Rep[String],                          // labelType
      Rep[OffsetDateTime],                  // timeValidated
      Rep[Option[String]]                   // validatorComment
  )

  // Define an implicit conversion from the tuple representation to the case class.
  implicit val labelMetadataUserDashConverter: TupleConverter[LabelMetadataUserDashTuple, LabelMetadataUserDash] =
    new TupleConverter[LabelMetadataUserDashTuple, LabelMetadataUserDash] {
      def fromTuple(t: LabelMetadataUserDashTuple): LabelMetadataUserDash =
        LabelMetadataUserDash(t._1, t._2, POV.tupled(t._3), t._4, t._5, t._6, t._7, t._8)
    }

  // Type aliases for the tuple representation of LabelValidationMetadata and queries for them.
  // TODO in Scala 3 I think that we can make these top-level like we do for the case class version.
  type LabelValidationMetadataTuple = (
      Int,                              // labelId
      String,                           // labelType
      String,                           // gsvPanoramaId
      String,                           // imageCaptureDate
      OffsetDateTime,                   // timestamp
      Option[Float],                    // lat
      Option[Float],                    // lng
      (Double, Double, Int),            // pov (heading, pitch, zoom)
      (Int, Int),                       // canvasXY (x, y)
      Option[Int],                      // severity
      Option[String],                   // description
      Int,                              // streetEdgeId
      Int,                              // regionId
      (Int, Int, Int, Option[Boolean]), // validationInfo (agreeCount, disagreeCount, unsureCount, correct)
      Option[Int],                      // userValidation
      Option[Int],                      // aiValidation
      List[String],                     // tags
      Option[Float],                    // cameraLat
      Option[Float],                    // cameraLng
      Option[List[String]]              // aiTags
  )
  type LabelValidationMetadataTupleRep = (
      Rep[Int],                                             // labelId
      Rep[String],                                          // labelType
      Rep[String],                                          // gsvPanoramaId
      Rep[String],                                          // imageCaptureDate
      Rep[OffsetDateTime],                                  // timestamp
      Rep[Option[Float]],                                   // lat
      Rep[Option[Float]],                                   // lng
      (Rep[Double], Rep[Double], Rep[Int]),                 // pov (heading, pitch, zoom)
      (Rep[Int], Rep[Int]),                                 // canvasXY (x, y)
      Rep[Option[Int]],                                     // severity
      Rep[Option[String]],                                  // description
      Rep[Int],                                             // streetEdgeId
      Rep[Int],                                             // regionId
      (Rep[Int], Rep[Int], Rep[Int], Rep[Option[Boolean]]), // validationInfo (nAgree, nDisagree, nUnsure, correct)
      Rep[Option[Int]],                                     // userValidation
      Rep[Option[Int]],                                     // aiValidation
      Rep[List[String]],                                    // tags
      Rep[Option[Float]],                                   // cameraLat
      Rep[Option[Float]],                                   // cameraLng
      Rep[Option[List[String]]]                             // aiTags
  )

  // Define an implicit conversion from the tuple representation to the case class.
  implicit val labelValidationMetadataConverter: TupleConverter[LabelValidationMetadataTuple, LabelValidationMetadata] =
    new TupleConverter[LabelValidationMetadataTuple, LabelValidationMetadata] {
      def fromTuple(t: LabelValidationMetadataTuple): LabelValidationMetadata = LabelValidationMetadata(
        t._1, t._2, t._3, t._4, t._5, t._6.get, t._7.get, POV.tupled(t._8), LocationXY.tupled(t._9), t._10, t._11,
        t._12, t._13, LabelValidationInfo.tupled(t._14), t._15, t._16, t._17, t._18, t._19, t._20
      )
    }

  // Type alias for the tuple representation of LabelCVMetadata.
  // TODO in Scala 3 I think that we can make these top-level like we do for the case class version.
  type LabelCVMetadataTuple = (
      Int,         // labelId
      String,      // panoId
      Int,         // labelTypeId
      Int,         // agreeCount
      Int,         // disagreeCount
      Int,         // unsureCount
      Option[Int], // panoWidth
      Option[Int], // panoHeight
      Int,         // panoX
      Int,         // panoY
      Int,         // canvasWidth
      Int,         // canvasHeight
      Int,         // canvasX
      Int,         // canvasY
      Int,         // zoom
      Float,       // heading
      Float,       // pitch
      Float,       // cameraHeading
      Float        // cameraPitch
  )

  /**
   * Implicit converter from SQL results to LabelDataForApi objects.
   */
  implicit val labelDataConverter: GetResult[LabelDataForApi] = GetResult[LabelDataForApi] { r =>
    LabelDataForApi(
      labelId = r.nextInt(),
      userId = r.nextString(),
      gsvPanoramaId = r.nextString(),
      labelType = r.nextString(),
      severity = r.nextIntOption(),
      tags = {
        val tagsStr = r.nextString()
        if (tagsStr != null && tagsStr.nonEmpty) tagsStr.split(",").filter(_.nonEmpty).toList else List.empty
      },
      description = r.nextStringOption(),
      timeCreated = {
        val timestamp = r.nextTimestamp()
        if (timestamp != null) {
          OffsetDateTime.ofInstant(timestamp.toInstant, ZoneOffset.UTC)
        } else {
          // Use current time as a fallback
          OffsetDateTime.now(ZoneOffset.UTC)
        }
      },
      streetEdgeId = r.nextInt(),
      osmWayId = r.nextLong(),
      neighborhood = r.nextString(),
      correct = r.nextBooleanOption(),
      agreeCount = r.nextInt(),
      disagreeCount = r.nextInt(),
      unsureCount = r.nextInt(),
      validations = {
        val validationsStr = r.nextStringOption().getOrElse("")
        if (validationsStr.isEmpty) {
          List.empty[LabelValidationSummaryForApi]
        } else {
          validationsStr
            .split(",")
            .map { v =>
              val parts = v.split(":")
              if (parts.length >= 2) {
                LabelValidationSummaryForApi(parts(0), parts(1))
              } else {
                LabelValidationSummaryForApi("unknown", "unknown")
              }
            }
            .toList
        }
      },
      auditTaskId = r.nextIntOption(),
      missionId = r.nextIntOption(),
      imageCaptureDate = r.nextStringOption(),
      heading = r.nextDoubleOption(),
      pitch = r.nextDoubleOption(),
      zoom = r.nextIntOption(),
      canvasX = r.nextIntOption(),
      canvasY = r.nextIntOption(),

      // TODO FIX THESE SO THEY ARE NOT CONSTANTS
      canvasWidth = Some(LabelPointTable.canvasWidth),
      canvasHeight = Some(LabelPointTable.canvasHeight),
      panoX = r.nextIntOption(),
      panoY = r.nextIntOption(),
      panoWidth = r.nextIntOption(),
      panoHeight = r.nextIntOption(),
      cameraHeading = r.nextDoubleOption(),
      cameraPitch = r.nextDoubleOption(),
      latitude = r.nextDouble(),
      longitude = r.nextDouble()
    )
  }
}

@ImplementedBy(classOf[LabelTable])
trait LabelTableRepository {}

@Singleton
class LabelTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    sidewalkUserTable: SidewalkUserTable
)(implicit ec: ExecutionContext)
    extends LabelTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val gf: GeometryFactory = JTSFactoryFinder.getGeometryFactory

  val labelsUnfiltered       = TableQuery[LabelTableDef]
  val auditTasks             = TableQuery[AuditTaskTableDef]
  val gsvData                = TableQuery[GsvDataTableDef]
  val labelTypes             = TableQuery[LabelTypeTableDef]
  val labelPoints            = TableQuery[LabelPointTableDef]
  val labelValidations       = TableQuery[LabelValidationTableDef]
  val labelAiAssessments     = TableQuery[LabelAiAssessmentTableDef]
  val missions               = TableQuery[MissionTableDef]
  val streets                = TableQuery[StreetEdgeTableDef]
  val regions                = TableQuery[RegionTableDef]
  val usersUnfiltered        = TableQuery[SidewalkUserTableDef]
  val userStats              = TableQuery[UserStatTableDef]
  val userRoles              = TableQuery[UserRoleTableDef]
  val roleTable              = TableQuery[RoleTableDef]
  val configTable            = TableQuery[ConfigTableDef]
  val streetEdgeRegions      = TableQuery[StreetEdgeRegionTableDef]
  val routeStreets           = TableQuery[RouteStreetTableDef]
  val validationTaskComments = TableQuery[ValidationTaskCommentTableDef]

  val aiValidations =
    labelValidations.join(sidewalkUserTable.aiUsers).on(_.userId === _.userId).map(_._1).distinctOn(_.labelId)
  val neighborhoods        = regions.filter(_.deleted === false)
  val usersWithoutExcluded = usersUnfiltered
    .join(userStats)
    .on(_.userId === _.userId)
    .filterNot(_._2.excluded) // Exclude users with excluded = true
    .map(_._1)

  val tutorialStreetId: Query[Rep[Int], Int, Seq] = configTable.map(_.tutorialStreetEdgeID)

  // This subquery gets the most commonly accessed set of labels. It removes labels that have been deleted, labels from
  // the tutorial, and labels from users where `excluded=TRUE` in the `user_stat` table. The first version also includes
  // the joined tables, bc doing an additional join with the same table in the future can drastically slow queries.
  val labelsWithAuditTasksAndUserStats = labelsUnfiltered
    .join(auditTasks)
    .on(_.auditTaskId === _.auditTaskId)
    .join(userStats)
    .on(_._2.userId === _.userId)
    .filterNot(_._1._1.streetEdgeId in tutorialStreetId) // Checking label.street_edge_id.
    .filterNot(_._1._2.streetEdgeId in tutorialStreetId) // Checking audit_task.street_edge_id.
    .filterNot { case ((_l, _at), _us) => _l.deleted || _l.tutorial || _us.excluded }
    .map(x => (x._1._1, x._1._2, x._2))
  val labels = labelsWithAuditTasksAndUserStats.map(_._1)

  // Subquery for labels without deleted or tutorial ones, but includes "excluded" users. You might need to include
  // these users if you're displaying a page for one of those users (like the user dashboard).
  val labelsWithExcludedUsers = labelsUnfiltered
    .join(auditTasks)
    .on(_.auditTaskId === _.auditTaskId)
    .filterNot(x => x._1.streetEdgeId in tutorialStreetId) // Checking label.street_edge_id.
    .filterNot(_._2.streetEdgeId in tutorialStreetId)      // Checking audit_task.street_edge_id.
    .filterNot { case (_l, _at) => _l.deleted || _l.tutorial }
    .map(_._1)

  // Subquery for labels without deleted ones, but includes tutorial labels and labels from "excluded" users. You might
  // need to include these users if you're displaying a page for one of those users (like the user dashboard).
  val labelsWithTutorialAndExcludedUsers = labelsUnfiltered.filter(_.deleted === false)

  // Subquery for labels without deleted ones or labels from "excluded" users, but includes tutorial labels.
  val labelsWithTutorial = labelsUnfiltered
    .join(userStats)
    .on(_.userId === _.userId)
    .filterNot { case (_l, _us) => _l.deleted || _us.excluded }
    .map(_._1)

  implicit def labelMetadataConverter: GetResult[LabelMetadata] = GetResult[LabelMetadata] { r =>
    LabelMetadata(
      r.nextInt(),
      r.nextString(),
      r.nextBoolean(),
      r.nextString(),
      POV(r.nextDouble(), r.nextDouble(), r.nextInt()),
      LocationXY(r.nextInt(), r.nextInt()),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextString(),
      r.nextString(),
      OffsetDateTime.ofInstant(r.nextTimestamp().toInstant, ZoneOffset.UTC),
      r.nextString(),
      r.nextIntOption(),
      r.nextStringOption(),
      r.nextIntOption(), // userValidation
      r.nextIntOption(), // aiValidation
      r.nextString().split(',').map(x => x.split(':')).map { y => (y(0), y(1).toInt) }.toMap,
      r.nextString().split(",").filter(_.nonEmpty).toList,
      (r.nextBoolean(), r.nextBoolean(), r.nextBoolean()),
      r.nextStringOption().filter(_.nonEmpty).map(_.split(":").filter(_.nonEmpty).toSeq)
    )
  }

  implicit val projectSidewalkStatsConverter: GetResult[ProjectSidewalkStats] = GetResult[ProjectSidewalkStats](r =>
    ProjectSidewalkStats(
      r.nextString(),
      r.nextOffsetDateTime(),
      r.nextFloat(),
      r.nextFloat(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextInt(),
      r.nextOffsetDateTime(),
      r.nextDuration(),
      Map(
        CurbRamp.name   -> LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption()),
        NoCurbRamp.name -> LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption()),
        Obstacle.name   -> LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption()),
        SurfaceProblem.name ->
          LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption()),
        NoSidewalk.name -> LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption()),
        Crosswalk.name  -> LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption()),
        Signal.name     -> LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption()),
        Occlusion.name  -> LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption()),
        Other.name      -> LabelSeverityStats(r.nextInt(), r.nextIntOption(), r.nextFloatOption(), r.nextFloatOption())
      ),
      r.nextInt(),
      Map(
        "Overall"           -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        CurbRamp.name       -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        NoCurbRamp.name     -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        Obstacle.name       -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        SurfaceProblem.name -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        NoSidewalk.name     -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        Crosswalk.name      -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        Signal.name         -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        Occlusion.name      -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt()),
        Other.name          -> LabelAccuracy(r.nextInt(), r.nextInt(), r.nextInt(), r.nextFloatOption(), r.nextInt())
      ),
      Map(
        "Overall" -> Map(
          "human_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
          "admin_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt())
        ),
        CurbRamp.name -> Map(
          "human_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
          "admin_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt())
        ),
        NoCurbRamp.name -> Map(
          "human_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
          "admin_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt())
        ),
        Obstacle.name -> Map(
          "human_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
          "admin_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt())
        ),
        SurfaceProblem.name -> Map(
          "human_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
          "admin_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt())
        ),
        Crosswalk.name -> Map(
          "human_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt()),
          "admin_majority_vote" -> AiConcurrence(r.nextInt(), r.nextInt(), r.nextInt(), r.nextInt())
        )
      )
    )
  )

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

  /**
   * Count number of labels of each label type in the specific time range. Includes an entry for all labels across type.
   * @param timeInterval can be "today" or "week". If anything else, defaults to "all_time".
   */
  def countLabelsByType(timeInterval: TimeInterval = TimeInterval.AllTime): DBIO[Seq[LabelCount]] = {
    // Filter by the given time interval.
    val labelsInTimeInterval = timeInterval match {
      case TimeInterval.Today => labelsWithTutorial.filter(l => l.timeCreated > OffsetDateTime.now().minusDays(1))
      case TimeInterval.Week  => labelsWithTutorial.filter(l => l.timeCreated >= OffsetDateTime.now().minusDays(7))
      case _                  => labelsWithTutorial
    }

    labelsInTimeInterval
      .join(labelTypes)
      .on(_.labelTypeId === _.labelTypeId)
      .groupBy(_._2.labelType)
      .map { case (labelType, rows) => (labelType, rows.length) }
      .result
      .map { labelCounts =>
        // Put data into LabelCount objects, and add an entry for any nonexistent label types with count=0.
        val countsByType: Seq[LabelCount] = validLabelTypes.map { labelType =>
          LabelCount(labelCounts.find(_._1 == labelType).map(_._2).getOrElse(0), timeInterval, labelType)
        }.toSeq

        // Create an "All" entry that sums all the counts.
        countsByType ++ Seq(LabelCount(labelCounts.map(_._2).sum, timeInterval, "All"))
      }
  }

  def countLabelsByUser: DBIO[Seq[(String, Int)]] = {
    labelsWithTutorialAndExcludedUsers.groupBy(_.userId).map { case (_userId, rows) => (_userId, rows.length) }.result
  }

  /**
   * Returns the number of labels submitted by the given user.
   * @param userId ID of user whose labels we're counting
   * @return A number of labels submitted by the user
   */
  def countLabelsFromUser(userId: String): DBIO[Int] = {
    labelsWithExcludedUsers.filter(_.userId === userId).length.result
  }

  /**
   * Gets metadata for the `takeN` most recent labels. Optionally filter by user_id of the labeler.
   * @param takeN Number of labels to retrieve
   * @param labelerId user_id of the person who placed the labels; an optional filter
   * @param validatorId optionally include this user's validation info for each label in the userValidation field
   * @param labelId optionally include this if you only want the metadata for the single given label
   * @return
   */
  def getRecentLabelsMetadata(
      takeN: Int,
      labelerId: Option[String] = None,
      validatorId: Option[String] = None,
      labelId: Option[Int] = None
  ): DBIO[Seq[LabelMetadata]] = {
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
             lb_big.severity,
             lb_big.description,
             lb_big.validation_result, -- userValidation
             ai_val.validation_result, -- aiValidation
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
      INNER JOIN sidewalk_user AS u ON at.user_id = u.user_id
      INNER JOIN label_point AS lp ON lb1.label_id = lp.label_id
      INNER JOIN (
          SELECT lb.label_id,
                 lb.gsv_panorama_id,
                 lbt.label_type,
                 lb.severity,
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
          SELECT label_id, validation_result
          FROM label_validation
          INNER JOIN user_role ON label_validation.user_id = user_role.user_id
          INNER JOIN role ON user_role.role_id = role.role_id
          WHERE role.role = 'AI'
      ) AS ai_val ON lb1.label_id = ai_val.label_id
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
    val labelsToValidate = for {
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
      .groupBy(_._2)
      .map { case (labType, group) =>
        (labType, group.length, group.length - group.map(_._3).countDefined)
      }
      .result
      .map(_.map(x => LabelTypeValidationsLeft(LabelTypeEnum.byId(x._1), x._2, x._3)))
  }

  /**
   * Returns a query to get set of labels matching filters for validation, ordered according to our priority algorithm.
   *
   * Priority is determined as follows: Generate a priority num for each label between 0 and 426. A label gets 150
   * points if the labeler has < 50 of their labels validated (and this label needs a validation). Another 50 points if
   * the labeler was marked as high quality. Up to 200 more points `(200 / (1 + abs(agree_count - disagree_count)^2))`
   * depending on how far we are from consensus. Another 25 points if the label was added in the past week. Then add a
   * random number so that the max score for each label is 426.
   *
   * @param userId         User ID for the current user.
   * @param labelTypeId    Label Type ID of labels requested.
   * @param userIds        Optional list of user IDs to filter by.
   * @param regionIds      Optional list of region IDs to filter by.
   * @param skippedLabelId Label ID of the label that was just skipped (if applicable).
   * @return               Seq[LabelValidationMetadata]
   */
  def retrieveLabelListForValidationQuery(
      userId: String,
      labelTypeId: Int,
      includeAiTags: Boolean = true,
      userIds: Option[Set[String]] = None,
      regionIds: Option[Set[Int]] = None,
      unvalidatedOnly: Boolean = false,
      skippedLabelId: Option[Int] = None
  ): Query[LabelValidationMetadataTupleRep, LabelValidationMetadataTuple, Seq] = {
    println(includeAiTags)

    // Join all necessary tables and filter potential labels according to the given parameters.
    val _labelInfo = for {
      (_lb, _at, _us) <- labelsWithAuditTasksAndUserStats
      _lt             <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp             <- labelPoints if _lb.labelId === _lp.labelId
      _gd             <- gsvData if _lb.gsvPanoramaId === _gd.gsvPanoramaId
      _ser            <- streetEdgeRegions if _lb.streetEdgeId === _ser.streetEdgeId
      if _lt.labelTypeId === labelTypeId && !_gd.expired && _lp.lat.isDefined && _lp.lng.isDefined && _lb.userId =!= userId
      if !unvalidatedOnly.asColumnOf[Boolean] || _lb.correct.isEmpty                     // Filter out validated labels.
      if skippedLabelId.map(_lb.labelId =!= _).getOrElse(true: Rep[Boolean])             // Filter out skipped label.
      if regionIds.map(ids => _ser.regionId inSetBind ids).getOrElse(true: Rep[Boolean]) // Filter by region IDs.
      if userIds.map(ids => _lb.userId inSetBind ids).getOrElse(true: Rep[Boolean])      // Filter by user IDs.
    } yield (_lb, _lp, _lt, _gd, _us, _ser, _at)

    // Get AI validations.
    val _labelInfoWithAIValidation = _labelInfo
      .joinLeft(aiValidations)
      .on(_._1.labelId === _.labelId)
      .map { case ((_lb, _lp, _lt, _gd, _us, _ser, _at), _aiv) => (_lb, _lp, _lt, _gd, _us, _ser, _at, _aiv) }

    // Get AI suggested tags.
    val _labelInfoWithAiTagSuggestions = _labelInfoWithAIValidation
      .joinLeft(labelAiAssessments)
      .on(_._1.labelId === _.labelId)
      .map { case ((_lb, _lp, _lt, _gd, _us, _ser, _at, _aiv), _la) => (_lb, _lp, _lt, _gd, _us, _ser, _at, _aiv, _la) }

    // Filter out labels that have already been validated by this user.
    val _labelInfoFiltered = _labelInfoWithAiTagSuggestions
      .joinLeft(labelValidations.filter(_.userId === userId))
      .on(_._1.labelId === _.labelId)
      .filter(_._2.isEmpty)
      .map(_._1)

    // Priority ordering algorithm is described in the method comment, max score is 276.
    val _labelInfoSorted = _labelInfoFiltered
      .sortBy {
        case (l, lp, lt, gd, us, ser, at, aiv, la) => {
          // A label gets 150 if the labeler as < 50 of their labels validated (and this label needs a validation).
          val needsValidationScore =
            Case.If(us.ownLabelsValidated < 50 && l.correct.isEmpty && !at.lowQuality && !at.stale).Then(150d).Else(0d)

          // Another 50 points if the labeler was marked as high quality.
          val highQualityScore = Case.If(us.highQuality).Then(50d).Else(0d)

          // Up to 100 points based on how far we are from consensus: (200 / (1 + abs(agree_count - disagree_count)^2)).
          val valDifference  = (l.agreeCount - l.disagreeCount).abs
          val agreementScore = 200.0d.bind / (1d.bind + (valDifference * valDifference).asColumnOf[Double])

          // Another 25 points if the label was added in the past week.
          val currentTimestamp = SimpleLiteral[OffsetDateTime]("current_timestamp")
          val weekInterval     = SimpleLiteral[Duration]("interval '7 days'")
          val recencyScore     = Case.If(l.timeCreated > currentTimestamp --- weekInterval).Then(25d).Else(0d)

          // Calculate the total deterministic score.
          val deterministicScore: Rep[Double] = needsValidationScore + highQualityScore + agreementScore + recencyScore

          // Finally, add a random number so that the max score for each label is 426. Sort descending.
          val rand = SimpleFunction.nullary[Double]("random")
          (deterministicScore + rand * (426.0d.bind - deterministicScore)).desc
        }
      }
      // Select only the columns needed for the LabelValidationMetadata class.
      .map { case (l, lp, lt, gd, us, ser, at, aiv, la) =>
        (
          l.labelId,
          lt.labelType,
          l.gsvPanoramaId,
          gd.captureDate,
          l.timeCreated,
          lp.lat,
          lp.lng,
          (lp.heading.asColumnOf[Double], lp.pitch.asColumnOf[Double], lp.zoom),
          (lp.canvasX, lp.canvasY),
          l.severity,
          l.description,
          l.streetEdgeId,
          ser.regionId,
          (l.agreeCount, l.disagreeCount, l.unsureCount, l.correct),
          Option.empty[Int].bind, // userValidation, always None bc we only show labels they haven't already validated.
          aiv.map(_.validationResult), // aiValidation, if it exists.
          l.tags,
          gd.lat,
          gd.lng,
          // Include AI tags if requested.
          if (includeAiTags) la.flatMap(_.tags).getOrElse(List.empty[String].bind).asColumnOf[Option[List[String]]]
          else None.asInstanceOf[Option[List[String]]].asColumnOf[Option[List[String]]]
        )
      }

    _labelInfoSorted
  }

  /**
   * Get additional info about a label for use by admins on Admin Validate.
   * @param labelIds Seq of label IDs to get extra info for.
   */
  def getExtraAdminValidateData(labelIds: Seq[Int]): DBIO[Seq[AdminValidationData]] = {
    labelsUnfiltered
      .filter(_.labelId inSetBind labelIds)
      // Inner join label -> sidewalk_user to get username of person who placed the label.
      .join(usersUnfiltered)
      .on(_.userId === _.userId)
      // Left join label -> label_validation -> sidewalk_user to get username & validation result of ppl who validated.
      .joinLeft(labelValidations)
      .on(_._1.labelId === _.labelId)
      .joinLeft(usersWithoutExcluded)
      .on(_._2.map(_.userId) === _.userId)
      .map(x => (x._1._1._1.labelId, x._1._1._2.username, x._2.map(_.username), x._1._2.map(_.validationResult)))
      .result
      .map { results => // This starts the in-memory operations.
        results
          // Turn the left joined validators into lists of tuples.
          .groupBy(l => (l._1, l._2))
          .map(x => (x._1._1, x._1._2, x._2.map(y => (y._3, y._4))))
          .toSeq
          .map(y => (y._1, y._2, y._3.collect { case (Some(a), Some(b)) => (a, b) }))
          .map(AdminValidationData.tupled)
      }
  }

  /**
   * Retrieves n labels of specified label type, severities, and tags. If no label type supplied, split across types.
   * @param labelType         Label type specifying what type of labels to grab.
   * @param loadedLabelIds    Set of labelIds already grabbed as to not grab them again.
   * @param valOptions        Set of correctness values to filter for: correct, incorrect, unsure, and/or unvalidated.
   * @param regionIds         Set of neighborhoods to get labels from. All neighborhoods if empty.
   * @param severity          Set of severities the labels grabbed can have.
   * @param tags              Set of tags the labels grabbed can have.
   * @param aiValOptions      Set of AI validations to filter for: correct, incorrect, unsure, and/or unvalidated.
   * @param userId            User ID of the user requesting the labels.
   * @return                  Query object to get the labels.
   */
  def getGalleryLabelsQuery(
      labelType: LabelTypeEnum.Base,
      loadedLabelIds: Set[Int],
      valOptions: Set[String],
      regionIds: Set[Int],
      severity: Set[Int],
      tags: Set[String],
      aiValOptions: Set[String],
      userId: String
  ): Query[LabelValidationMetadataTupleRep, LabelValidationMetadataTuple, Seq] = {
    // Filter labels based on correctness.
    val _labelsFilteredByCorrectness = {
      var query = labels
      if (!valOptions.contains("correct")) query = query.filter(l => l.correct.isEmpty || !l.correct)
      if (!valOptions.contains("incorrect")) query = query.filter(l => l.correct.isEmpty || l.correct)
      if (!valOptions.contains("unsure"))
        query =
          query.filter(l => l.correct.isDefined || (l.agreeCount === 0 && l.disagreeCount === 0 && l.unsureCount === 0))
      if (!valOptions.contains("unvalidated"))
        query = query.filter(l => l.agreeCount > 0 || l.disagreeCount > 0 || l.unsureCount > 0)
      query
    }

    val _labelInfo = for {
      _lb  <- _labelsFilteredByCorrectness if !(_lb.labelId inSetBind loadedLabelIds)
      _lt  <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp  <- labelPoints if _lb.labelId === _lp.labelId
      _gd  <- gsvData if _lb.gsvPanoramaId === _gd.gsvPanoramaId
      _us  <- userStats if _lb.userId === _us.userId
      _ser <- streetEdgeRegions if _lb.streetEdgeId === _ser.streetEdgeId
      if _gd.expired === false
      if _lp.lat.isDefined && _lp.lng.isDefined
      if _lt.labelTypeId === labelType.id
      if (_ser.regionId inSetBind regionIds) || regionIds.isEmpty
      if (_lb.severity inSetBind severity) || severity.isEmpty
      if (_lb.tags @& tags.toList) || tags.isEmpty // @& is the overlap operator from postgres (&& in postgres).
      if _us.highQuality || (_lb.correct.isDefined && _lb.correct === true)
      if _lb.disagreeCount < 3 || _lb.disagreeCount < _lb.agreeCount * 2
    } yield (_lb, _lp, _lt, _gd, _ser)

    // Get AI validations.
    val _labelInfoWithAIValidation = _labelInfo
      .joinLeft(aiValidations)
      .on(_._1.labelId === _.labelId)
      .map { case ((_lb, _lp, _lt, _gd, _ser), _aiv) => (_lb, _lp, _lt, _gd, _ser, _aiv) }

    // Filter labels based on how the AI validated them. If no filters provided, do no filtering here.
    val _labelsFilteredByAiValidation = {
      var query = _labelInfoWithAIValidation
      if (aiValOptions.nonEmpty) {
        if (!aiValOptions.contains("correct"))
          query = query.filter(l => l._6.isEmpty || l._6.map(_.validationResult) =!= 1.asColumnOf[Option[Int]])
        if (!aiValOptions.contains("incorrect"))
          query = query.filter(l => l._6.isEmpty || l._6.map(_.validationResult) =!= 2.asColumnOf[Option[Int]])
        if (!aiValOptions.contains("unsure"))
          query = query.filter(l => l._6.isEmpty || l._6.map(_.validationResult) =!= 3.asColumnOf[Option[Int]])
        if (!aiValOptions.contains("unvalidated")) query = query.filter(l => l._6.isDefined)
      }
      query
    }

    // Join with user validations.
    val _userValidations       = labelValidations.filter(_.userId === userId)
    val _labelInfoWithUserVals = for {
      ((_lb, _lp, _lt, _gd, _ser, _aiv), _uv) <-
        _labelsFilteredByAiValidation.joinLeft(_userValidations).on(_._1.labelId === _.labelId)
    } yield (
      _lb.labelId,
      _lt.labelType,
      _lb.gsvPanoramaId,
      _gd.captureDate,
      _lb.timeCreated,
      _lp.lat,
      _lp.lng,
      (_lp.heading.asColumnOf[Double], _lp.pitch.asColumnOf[Double], _lp.zoom),
      (_lp.canvasX, _lp.canvasY),
      _lb.severity,
      _lb.description,
      _lb.streetEdgeId,
      _ser.regionId,
      (_lb.agreeCount, _lb.disagreeCount, _lb.unsureCount, _lb.correct),
      _uv.map(_.validationResult),  // userValidation
      _aiv.map(_.validationResult), // aiValidation
      _lb.tags,
      _gd.lat,
      _gd.lng,
      // Placeholder for AI tags, since we don't show those on Gallery right now.
      None.asInstanceOf[Option[List[String]]].asColumnOf[Option[List[String]]]
    )

    // Remove duplicates if needed and randomize.
    val rand          = SimpleFunction.nullary[Double]("random")
    val _uniqueLabels =
      if (tags.nonEmpty)
        _labelInfoWithUserVals.groupBy(x => x).map(_._1).sortBy(_ => rand)
      else
        _labelInfoWithUserVals.sortBy(_ => rand)

    _uniqueLabels
  }

  /**
   * Get user's labels most recently validated as incorrect.
   * @param userId    ID of the user who made these mistakes.
   * @param labelType Label types where we are looking for mistakes.
   * @return          Query object to get the labels.
   */
  def getValidatedLabelsForUserQuery(
      userId: String,
      labelType: LabelTypeEnum.Base
  ): Query[LabelMetadataUserDashTupleRep, LabelMetadataUserDashTuple, Seq] = {
    // Attach comments to validations using a left join.
    val _validationsWithComments = labelValidations
      .joinLeft(validationTaskComments)
      .on((v, c) => v.missionId === c.missionId && v.labelId === c.labelId)
      .map(x =>
        (x._1.labelId, x._1.validationResult, x._1.userId, x._1.missionId, x._1.endTimestamp, x._2.map(_.comment))
      )

    // Grab validations and associated label information for the given user's labels.
    val _validations = for {
      _lb <- labelsWithExcludedUsers
      _lt <- labelTypes if _lb.labelTypeId === _lt.labelTypeId
      _lp <- labelPoints if _lb.labelId === _lp.labelId
      _gd <- gsvData if _lb.gsvPanoramaId === _gd.gsvPanoramaId
      _vc <- _validationsWithComments if _lb.labelId === _vc._1
      _us <- userStats if _vc._3 === _us.userId
      if _lb.userId === userId &&   // Only include the given user's labels.
        _vc._3 =!= userId &&        // Exclude any cases where the user may have validated their own label.
        _vc._2 === 2 &&             // Only times when users validated as incorrect.
        _us.excluded === false &&   // Don't use validations from excluded users
        _us.highQuality === true && // For now, we only include validations from high quality users.
        _gd.expired === false &&    // Only include those with non-expired GSV imagery.
        _lb.correct.isDefined && _lb.correct === false && // Exclude outlier validations on a correct label.
        _lt.labelType === labelType.name                  // Only include given label types.
    } yield (
      _lb.labelId,
      _lb.gsvPanoramaId,
      (_lp.heading.asColumnOf[Double], _lp.pitch.asColumnOf[Double], _lp.zoom),
      _lp.canvasX,
      _lp.canvasY,
      _lt.labelType,
      _vc._5,
      _vc._6
    )

    // Get the most recent matching validation for each label.
    _validations.sortBy(r => (r._1, r._7.desc)).distinctOn(_._1)
  }

  /**
   * Returns all the submitted labels with their severities included. If provided, filter for only given regions.
   */
  def getLabelsForLabelMap(
      regionIds: Seq[Int],
      routeIds: Seq[Int],
      aiValOptions: Seq[String]
  ): DBIO[Seq[LabelForLabelMap]] = {
    val _labels = for {
      (_l, _at, _us) <- labelsWithAuditTasksAndUserStats
      _lt            <- labelTypes if _l.labelTypeId === _lt.labelTypeId
      _lp            <- labelPoints if _l.labelId === _lp.labelId
      _gsv           <- gsvData if _l.gsvPanoramaId === _gsv.gsvPanoramaId
      _ser           <- streetEdgeRegions if _l.streetEdgeId === _ser.streetEdgeId
      if (_ser.regionId inSetBind regionIds) || regionIds.isEmpty
      if _lp.lat.isDefined && _lp.lng.isDefined // Make sure they are NOT NULL so we can safely use .get later.
    } yield (_l, _us, _lt, _lp, _gsv, _ser)

    // Get AI validations.
    val _labelInfoWithAIValidation = _labels
      .joinLeft(aiValidations)
      .on(_._1.labelId === _.labelId)
      .map { case ((_l, _us, _lt, _lp, _gsv, _ser), _aiv) => (_l, _us, _lt, _lp, _gsv, _ser, _aiv) }

    // Filter labels based on how the AI validated them. If no filters provided, do no filtering here.
    val _labelsFilteredByAiValidation = {
      var query = _labelInfoWithAIValidation
      if (aiValOptions.nonEmpty) {
        if (!aiValOptions.contains("correct"))
          query = query.filter(l => l._7.isEmpty || l._7.map(_.validationResult) =!= 1.asColumnOf[Option[Int]])
        if (!aiValOptions.contains("incorrect"))
          query = query.filter(l => l._7.isEmpty || l._7.map(_.validationResult) =!= 2.asColumnOf[Option[Int]])
        if (!aiValOptions.contains("unsure"))
          query = query.filter(l => l._7.isEmpty || l._7.map(_.validationResult) =!= 3.asColumnOf[Option[Int]])
        if (!aiValOptions.contains("unvalidated")) query = query.filter(l => l._7.isDefined)
      }

      // Grab the columns that we need for the LabelForLabelMap case class.
      query.map { case (_l, _us, _lt, _lp, _gsv, _ser, _aiv) =>
        val hasValidations = _l.agreeCount > 0 || _l.disagreeCount > 0 || _l.unsureCount > 0
        (_l.labelId, _l.auditTaskId, _lt.labelType, _lp.lat, _lp.lng, _l.correct, hasValidations,
          _aiv.map(_.validationResult), _gsv.expired, _us.highQuality, _l.severity, _ser.streetEdgeId)
      }
    }

    // Filter for labels along the given route. Distance experimentally set to 0.0005 degrees. Would like to switch to
    // different SRID and use meters: https://github.com/ProjectSidewalk/SidewalkWebpage/issues/3655.
    val _labelsNearRoute = if (routeIds.nonEmpty) {
      (for {
        _rs <- routeStreets if _rs.routeId inSetBind routeIds
        _se <- streets if _rs.streetEdgeId === _se.streetEdgeId
        _l  <- _labelsFilteredByAiValidation if _se.streetEdgeId === _l._1 ||
          _se.geom.distance(makePoint(_l._5.asColumnOf[Double], _l._4.asColumnOf[Double]).setSRID(4326)) < 0.0005f
      } yield _l).distinct
    } else {
      _labelsFilteredByAiValidation
    }

    // For some reason we couldn't use both `_l.agreeCount > 0` and `_lPoint.lat.get` in the yield without a runtime
    // error, which is why we couldn't use `.tupled` here. This was the error message:
    // SlickException: Expected an option type, found Float/REAL
    _labelsNearRoute.result.map(
      _.map(l => LabelForLabelMap(l._1, l._2, l._3, l._4.get, l._5.get, l._6, l._7, l._8, l._9, l._10, l._11))
    )
  }

  /**
   * Returns all tags with a count of their usage.
   */
  def getTagCounts: DBIO[Seq[TagCount]] = {
    val _tags = for {
      _l      <- labels
      _lType  <- labelTypes if _l.labelTypeId === _lType.labelTypeId
      _lPoint <- labelPoints if _l.labelId === _lPoint.labelId
    } yield (_lType.labelType, _l.tags.unnest)

    // Count usage of tags by grouping by (labelType, tag).
    _tags
      .groupBy(l => (l._1, l._2))
      .map { case ((labelType, tag), group) => (labelType, tag, group.length) }
      .result
      .map(_.map(TagCount.tupled))
  }

  /**
   * Returns a list of labels submitted by the given user, either everywhere or just in the given region.
   */
  def getLabelLocations(userId: String, regionId: Option[Int] = None): DBIO[Seq[LabelLocation]] = {
    val _labels = for {
      _l   <- labelsWithExcludedUsers
      _lt  <- labelTypes if _l.labelTypeId === _lt.labelTypeId
      _lp  <- labelPoints if _l.labelId === _lp.labelId
      _at  <- auditTasks if _l.auditTaskId === _at.auditTaskId
      _ser <- streetEdgeRegions if _at.streetEdgeId === _ser.streetEdgeId
      if _l.userId === userId
      if regionId.isEmpty.asColumnOf[Boolean] || _ser.regionId === regionId.getOrElse(-1)
      if _lp.lat.isDefined && _lp.lng.isDefined
    } yield (
      _l.labelId,
      _l.auditTaskId,
      _l.gsvPanoramaId,
      _lt.labelType,
      _lp.lat,
      _lp.lng,
      _l.correct,
      _l.agreeCount > 0 || _l.disagreeCount > 0 || _l.unsureCount > 0
    )

    // For some reason we couldn't use both `_l.agreeCount > 0` and `_lPoint.lat.get` in the yield without a runtime
    // error, which is why we couldn't use `.tupled` here. This was the error message:
    // SlickException: Expected an option type, found Float/REAL
    _labels.result.map(_.map(l => LabelLocation(l._1, l._2, l._3, l._4, l._5.get, l._6.get, l._7, l._8)))
  }

  /**
   * Returns a count of the number of labels placed on each day there were labels placed.
   */
  def getLabelCountsByDate: DBIO[Seq[(OffsetDateTime, Int)]] = {
    labelsWithTutorialAndExcludedUsers
      .map(_.timeCreated.trunc("day"))
      .groupBy(x => x)
      .map(x => (x._1, x._2.length))
      .sortBy(_._1)
      .result
  }

  /**
   * Select label counts by user.
   * @return DBIO[Seq[(user_id, role, label_count)]]
   */
  def getLabelCountsByUser: DBIO[Seq[(String, String, Int)]] = {
    val labs = for {
      _user     <- usersUnfiltered
      _userRole <- userRoles if _user.userId === _userRole.userId
      _role     <- roleTable if _userRole.roleId === _role.roleId
      _label    <- labelsWithTutorial if _user.userId === _label.userId
    } yield (_user.userId, _role.role, _label.labelId)

    // Counts the number of labels for each user by grouping by user_id and role.
    labs.groupBy(l => (l._1, l._2)).map { case ((uId, role), group) => (uId, role, group.length) }.result
  }

  /**
   * Select street_edge_id of street closest to lat/lng position.
   */
  def getStreetEdgeIdClosestToLatLng(lat: Float, lng: Float): DBIO[Int] = {
    streets
      .filterNot(_.deleted)
      .map(s =>
        (s.streetEdgeId, s.geom.distance(makePoint(lng.asColumnOf[Double], lat.asColumnOf[Double]).setSRID(4326)))
      )
      .sortBy(_._2)
      .map(_._1)
      .take(1)
      .result
      .head
  }

  /**
   * Select street_edge_id of the street closest to the lat/lng position for every lat/lng.
   *
   * Note that an attempt to take copy the Slick code from the function above and take a union between all the lat/lngs
   * to turn it into one query was unsuccessful, resulting in a stack overflow error. Maybe there is some other way to
   * use Slick syntax that more closely mirrors what we're doing in raw SQL below. Ultimately resorted to batching.
   * @param latLngs Seq of lat/lng pairs to find the closest street for.
   * @return Seq of street_edge_ids that are the closest street to the corresponding lat/lng in the input Seq.
   */
  def getStreetEdgeIdClosestToLatLngs(latLngs: Seq[(Double, Double)]): DBIO[Seq[Int]] = {
    if (latLngs.isEmpty) {
      DBIO.successful(Seq.empty)
    } else {
      // Build a VALUES clause with all points.
      val pointDataSql = latLngs.zipWithIndex
        .map { case ((lat, lng), idx) =>
          s"($idx, ST_SetSRID(ST_MakePoint($lng, $lat), 4326))"
        }
        .mkString(", ")

      sql"""
        SELECT closest_street.street_edge_id
        FROM (VALUES #$pointDataSql) AS point_data(idx, geom)
        CROSS JOIN LATERAL (
          SELECT street_edge_id
          FROM street_edge
          WHERE deleted = FALSE
          ORDER BY geom <-> point_data.geom
          LIMIT 1
        ) closest_street
        ORDER BY point_data.idx;
      """.as[Int]
    }
  }

  /**
   * Gets the labels placed by a user in a region.
   * @param regionId Region ID to get labels from
   * @param userId User ID of user to find labels for
   * @return list of labels placed by user in region
   */
  def getLabelsFromUserInRegion(regionId: Int, userId: String): DBIO[Seq[ResumeLabelMetadata]] = {
    (for {
      _mission    <- missions
      _label      <- labels if _mission.missionId === _label.missionId
      _labelPoint <- labelPoints if _label.labelId === _labelPoint.labelId
      _labelType  <- labelTypes if _label.labelTypeId === _labelType.labelTypeId
      _gsvData    <- gsvData if _label.gsvPanoramaId === _gsvData.gsvPanoramaId
      if _mission.regionId === regionId && _mission.userId === userId
      if _labelPoint.lat.isDefined && _labelPoint.lng.isDefined
    } yield (_label, _labelType.labelType, _labelPoint, _gsvData.lat, _gsvData.lng, _gsvData.cameraHeading,
      _gsvData.cameraPitch, _gsvData.width, _gsvData.height)).result.map(_.map(ResumeLabelMetadata.tupled))
  }

  /**
   * Get the raw label data with filters applied.
   * This includes filters for bounding box, label types, tags, severity,
   * validation status, date ranges, and region information.
   *
   * @param filters The filters to apply to the label data
   * @return A query for label data that matches the filters
   */
  def getLabelDataWithFilters(
      filters: RawLabelFiltersForApi
  ): SqlStreamingAction[Vector[LabelDataForApi], LabelDataForApi, Effect] = {
    // TODO convert to Slick syntax now that we can use .makeEnvelope, .within, and array aggregation.
    // Build the base query conditions.
    var whereConditions = Seq(
      "label.deleted = FALSE", "label.tutorial = FALSE", "user_stat.excluded = FALSE",
      "label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)",
      "audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)"
    )

    // Apply filter precedence logic for location filters:
    // - If bbox is defined, it takes precedence over region filters
    // - If regionId is defined, it takes precedence over regionName

    if (filters.bbox.isDefined) {
      // BBox filter takes precedence over region filters.
      val bbox = filters.bbox.get
      whereConditions :+= s"label_point.lat > ${bbox.minLat}"
      whereConditions :+= s"label_point.lat < ${bbox.maxLat}"
      whereConditions :+= s"label_point.lng > ${bbox.minLng}"
      whereConditions :+= s"label_point.lng < ${bbox.maxLng}"
    } else if (filters.regionId.isDefined) {
      // Region ID filter takes precedence over region name.
      whereConditions :+= s"street_edge_region.region_id = ${filters.regionId.get}"
    } else if (filters.regionName.isDefined) {
      // Use region name if no bbox or region ID is provided.
      whereConditions :+= s"region.name = '${filters.regionName.get.replace("'", "''")}'"
    }

    // Apply the rest of the existing filters.
    if (filters.labelTypes.isDefined && filters.labelTypes.get.nonEmpty) {
      val labelTypeList = filters.labelTypes.get.map(lt => s"'$lt'").mkString(", ")
      whereConditions :+= s"label_type.label_type IN ($labelTypeList)"
    }

    if (filters.tags.isDefined && filters.tags.get.nonEmpty) {
      val tagConditions = filters.tags.get.map(tag => s"'$tag' = ANY(label.tags)").mkString(" OR ")
      whereConditions :+= s"($tagConditions)"
    }

    if (filters.minSeverity.isDefined) {
      whereConditions :+= s"label.severity >= ${filters.minSeverity.get}"
    }

    if (filters.maxSeverity.isDefined) {
      whereConditions :+= s"label.severity <= ${filters.maxSeverity.get}"
    }

    if (filters.validationStatus.isDefined) {
      filters.validationStatus.get match {
        case "Agreed"      => whereConditions :+= "label.correct = TRUE"
        case "Disagreed"   => whereConditions :+= "label.correct = FALSE"
        case "Unvalidated" => whereConditions :+= "label.correct IS NULL"
        case _             => // No additional filter
      }
    }

    if (filters.highQualityUserOnly) {
      whereConditions :+= "user_stat.high_quality = TRUE"
    }

    if (filters.startDate.isDefined) {
      whereConditions :+= s"label.time_created >= '${filters.startDate.get.toString}'"
    }

    if (filters.endDate.isDefined) {
      whereConditions :+= s"label.time_created <= '${filters.endDate.get.toString}'"
    }

    // Combine all conditions.
    val whereClause = whereConditions.mkString(" AND ")

    // Create a plain SQL query as a string and execute it.
    sql"""
      SELECT label.label_id,
             label.user_id,
             label.gsv_panorama_id,
             label_type.label_type,
             label.severity,
             array_to_string(label.tags, ','),
             label.description,
             label.time_created,
             label.street_edge_id,
             osm_way_street_edge.osm_way_id,
             region.name,
             label.correct,
             label.agree_count,
             label.disagree_count,
             label.unsure_count,
             vals.validations,
             audit_task.audit_task_id,
             label.mission_id,
             gsv_data.capture_date,
             label_point.heading,
             label_point.pitch,
             label_point.zoom,
             label_point.canvas_x,
             label_point.canvas_y,
             label_point.pano_x,
             label_point.pano_y,
             gsv_data.width AS pano_width,
             gsv_data.height AS pano_height,
             gsv_data.camera_heading,
             gsv_data.camera_pitch,
             label_point.lat,
             label_point.lng
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
          array_to_string(array_agg(CONCAT(label_validation.user_id, ':', validation_options.text)), ',') AS validations
          FROM label
          INNER JOIN label_validation ON label.label_id = label_validation.label_id
          INNER JOIN validation_options ON label_validation.validation_result = validation_options.validation_option_id
          GROUP BY label.label_id
      ) AS "vals" ON label.label_id = vals.label_id
      WHERE #$whereClause
      ORDER BY label.label_id;
    """.as[LabelDataForApi]
  }

  def recentLabelsAvgLabelDate(n: Int): DBIO[Option[OffsetDateTime]] = {
    labels.sortBy(_.timeCreated.desc).take(n).map(_.timeCreated).result.map { dates =>
      if (dates.nonEmpty) {
        val avgDate: Long = dates.map(_.toInstant.toEpochMilli).sum / dates.length
        Some(Instant.ofEpochMilli(avgDate).atOffset(ZoneOffset.UTC))
      } else {
        None
      }
    }
  }

  def getOverallStatsForApi(
      filterLowQuality: Boolean,
      launchDate: String,
      avgRecentLabels: Option[OffsetDateTime]
  ): DBIO[ProjectSidewalkStats] = {
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
             label_counts_and_severity.n_with_sev,
             label_counts_and_severity.avg_label_timestamp,
             label_counts_and_severity.avg_age_when_labeled,
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
             NULL AS nosidewalk_with_sev,
             NULL AS nosidewalk_sev_mean,
             NULL AS nosidewalk_sev_sd,
             label_counts_and_severity.n_crswlk,
             label_counts_and_severity.n_crswlk_with_sev,
             label_counts_and_severity.crswlk_sev_mean,
             label_counts_and_severity.crswlk_sev_sd,
             label_counts_and_severity.n_signal,
             NULL AS signal_with_sev,
             NULL AS signal_sev_mean,
             NULL AS signal_sev_sd,
             label_counts_and_severity.n_occlusion,
             NULL AS occlusion_with_sev,
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
             n_with_validation,
             val_counts.n_ramp_total,
             val_counts.n_ramp_agree,
             val_counts.n_ramp_disagree,
             1.0 * val_counts.n_ramp_agree / NULLIF(val_counts.n_ramp_total, 0) AS ramp_accuracy,
             n_ramp_with_validation,
             val_counts.n_noramp_total,
             val_counts.n_noramp_agree,
             val_counts.n_noramp_disagree,
             1.0 * val_counts.n_noramp_agree / NULLIF(val_counts.n_noramp_total, 0) AS noramp_accuracy,
             n_noramp_with_validation,
             val_counts.n_obs_total,
             val_counts.n_obs_agree,
             val_counts.n_obs_disagree,
             1.0 * val_counts.n_obs_agree / NULLIF(val_counts.n_obs_total, 0) AS obs_accuracy,
             n_obs_with_validation,
             val_counts.n_surf_total,
             val_counts.n_surf_agree,
             val_counts.n_surf_disagree,
             1.0 * val_counts.n_surf_agree / NULLIF(val_counts.n_surf_total, 0) AS surf_accuracy,
             n_surf_with_validation,
             val_counts.n_nosidewalk_total,
             val_counts.n_nosidewalk_agree,
             val_counts.n_nosidewalk_disagree,
             1.0 * val_counts.n_nosidewalk_agree / NULLIF(val_counts.n_nosidewalk_total, 0) AS nosidewalk_accuracy,
             n_nosidewalk_with_validation,
             val_counts.n_crswlk_total,
             val_counts.n_crswlk_agree,
             val_counts.n_crswlk_disagree,
             1.0 * val_counts.n_crswlk_agree / NULLIF(val_counts.n_crswlk_total, 0) AS crswlk_accuracy,
             n_crswlk_with_validation,
             val_counts.n_signal_total,
             val_counts.n_signal_agree,
             val_counts.n_signal_disagree,
             1.0 * val_counts.n_signal_agree / NULLIF(val_counts.n_signal_total, 0) AS signal_accuracy,
             n_signal_with_validation,
             val_counts.n_occlusion_total,
             val_counts.n_occlusion_agree,
             val_counts.n_occlusion_disagree,
             1.0 * val_counts.n_occlusion_agree / NULLIF(val_counts.n_occlusion_total, 0) AS occlusion_accuracy,
             n_occlusion_with_validation,
             val_counts.n_other_total,
             val_counts.n_other_agree,
             val_counts.n_other_disagree,
             1.0 * val_counts.n_other_agree / NULLIF(val_counts.n_other_total, 0) AS other_accuracy,
             n_other_with_validation,
             ai_stats.ai_yes_mv_yes,
             ai_stats.ai_yes_mv_no,
             ai_stats.ai_no_mv_yes,
             ai_stats.ai_no_mv_no,
             ai_stats.ai_yes_admin_yes,
             ai_stats.ai_yes_admin_no,
             ai_stats.ai_no_admin_yes,
             ai_stats.ai_no_admin_no,
             ai_stats.ramp_ai_yes_mv_yes,
             ai_stats.ramp_ai_yes_mv_no,
             ai_stats.ramp_ai_no_mv_yes,
             ai_stats.ramp_ai_no_mv_no,
             ai_stats.ramp_ai_yes_admin_yes,
             ai_stats.ramp_ai_yes_admin_no,
             ai_stats.ramp_ai_no_admin_yes,
             ai_stats.ramp_ai_no_admin_no,
             ai_stats.noramp_ai_yes_mv_yes,
             ai_stats.noramp_ai_yes_mv_no,
             ai_stats.noramp_ai_no_mv_yes,
             ai_stats.noramp_ai_no_mv_no,
             ai_stats.noramp_ai_yes_admin_yes,
             ai_stats.noramp_ai_yes_admin_no,
             ai_stats.noramp_ai_no_admin_yes,
             ai_stats.noramp_ai_no_admin_no,
             ai_stats.obs_ai_yes_mv_yes,
             ai_stats.obs_ai_yes_mv_no,
             ai_stats.obs_ai_no_mv_yes,
             ai_stats.obs_ai_no_mv_no,
             ai_stats.obs_ai_yes_admin_yes,
             ai_stats.obs_ai_yes_admin_no,
             ai_stats.obs_ai_no_admin_yes,
             ai_stats.obs_ai_no_admin_no,
             ai_stats.surf_ai_yes_mv_yes,
             ai_stats.surf_ai_yes_mv_no,
             ai_stats.surf_ai_no_mv_yes,
             ai_stats.surf_ai_no_mv_no,
             ai_stats.surf_ai_yes_admin_yes,
             ai_stats.surf_ai_yes_admin_no,
             ai_stats.surf_ai_no_admin_yes,
             ai_stats.surf_ai_no_admin_no,
             ai_stats.crswlk_ai_yes_mv_yes,
             ai_stats.crswlk_ai_yes_mv_no,
             ai_stats.crswlk_ai_no_mv_yes,
             ai_stats.crswlk_ai_no_mv_no,
             ai_stats.crswlk_ai_yes_admin_yes,
             ai_stats.crswlk_ai_yes_admin_no,
             ai_stats.crswlk_ai_no_admin_yes,
             ai_stats.crswlk_ai_no_admin_no
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
              INNER JOIN user_role ON users_with_type.user_id = user_role.user_id
              INNER JOIN role ON user_role.role_id = role.role_id
              WHERE #$userFilter
          ) users
      ) AS users, (
          SELECT COUNT(*) AS label_count,
                 COUNT(CASE WHEN severity IS NOT NULL THEN 1 END) AS n_with_sev,
                 to_timestamp(AVG(EXTRACT(EPOCH FROM time_created))) AS avg_label_timestamp,
                 AVG(
                     CASE
                         WHEN gsv_data.capture_date IS NOT NULL AND gsv_data.capture_date <> ''
                         THEN time_created - TO_TIMESTAMP(EXTRACT(epoch from CAST(gsv_data.capture_date || '-01' AS DATE)))
                     END
                 ) AS avg_age_when_labeled,
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
          LEFT JOIN gsv_data ON label.gsv_panorama_id = gsv_data.gsv_panorama_id
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
                 COUNT(CASE WHEN agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_with_validation,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND correct THEN 1 END) AS n_ramp_agree,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND NOT correct THEN 1 END) AS n_ramp_disagree,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND correct IS NOT NULL THEN 1 END) AS n_ramp_total,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_ramp_with_validation,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct THEN 1 END) AS n_noramp_agree,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND NOT correct THEN 1 END) AS n_noramp_disagree,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND correct IS NOT NULL THEN 1 END) AS n_noramp_total,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_noramp_with_validation,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND correct THEN 1 END) AS n_obs_agree,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND NOT correct THEN 1 END) AS n_obs_disagree,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND correct IS NOT NULL THEN 1 END) AS n_obs_total,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_obs_with_validation,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct THEN 1 END) AS n_surf_agree,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND NOT correct THEN 1 END) AS n_surf_disagree,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND correct IS NOT NULL THEN 1 END) AS n_surf_total,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_surf_with_validation,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct THEN 1 END) AS n_nosidewalk_agree,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND NOT correct THEN 1 END) AS n_nosidewalk_disagree,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND correct IS NOT NULL THEN 1 END) AS n_nosidewalk_total,
                 COUNT(CASE WHEN label_type = 'NoSidewalk' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_nosidewalk_with_validation,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND correct THEN 1 END) AS n_crswlk_agree,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND NOT correct THEN 1 END) AS n_crswlk_disagree,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND correct IS NOT NULL THEN 1 END) AS n_crswlk_total,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_crswlk_with_validation,
                 COUNT(CASE WHEN label_type = 'Signal' AND correct THEN 1 END) AS n_signal_agree,
                 COUNT(CASE WHEN label_type = 'Signal' AND NOT correct THEN 1 END) AS n_signal_disagree,
                 COUNT(CASE WHEN label_type = 'Signal' AND correct IS NOT NULL THEN 1 END) AS n_signal_total,
                 COUNT(CASE WHEN label_type = 'Signal' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_signal_with_validation,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND correct THEN 1 END) AS n_occlusion_agree,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND NOT correct THEN 1 END) AS n_occlusion_disagree,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND correct IS NOT NULL THEN 1 END) AS n_occlusion_total,
                 COUNT(CASE WHEN label_type = 'Occlusion' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_occlusion_with_validation,
                 COUNT(CASE WHEN label_type = 'Other' AND correct THEN 1 END) AS n_other_agree,
                 COUNT(CASE WHEN label_type = 'Other' AND NOT correct THEN 1 END) AS n_other_disagree,
                 COUNT(CASE WHEN label_type = 'Other' AND correct IS NOT NULL THEN 1 END) AS n_other_total,
                 COUNT(CASE WHEN label_type = 'Other' AND agree_count + disagree_count + unsure_count > 0 THEN 1 END) AS n_other_with_validation
          FROM label
          INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
          INNER JOIN user_stat ON label.user_id = user_stat.user_id
          INNER JOIN audit_task ON label.audit_task_id = audit_task.audit_task_id
          WHERE #$userFilter
              AND deleted = FALSE
              AND tutorial = FALSE
              AND label.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
              AND audit_task.street_edge_id <> (SELECT tutorial_street_edge_id FROM config)
      ) AS val_counts, (
          SELECT COUNT(CASE WHEN ai_mv = 1 AND human_mv = 1 THEN 1 END) AS ai_yes_mv_yes,
                 COUNT(CASE WHEN ai_mv = 1 AND human_mv = 2 THEN 1 END) AS ai_yes_mv_no,
                 COUNT(CASE WHEN ai_mv = 2 AND human_mv = 1 THEN 1 END) AS ai_no_mv_yes,
                 COUNT(CASE WHEN ai_mv = 2 AND human_mv = 2 THEN 1 END) AS ai_no_mv_no,
                 COUNT(CASE WHEN ai_mv = 1 AND admin_mv = 1 THEN 1 END) AS ai_yes_admin_yes,
                 COUNT(CASE WHEN ai_mv = 1 AND admin_mv = 2 THEN 1 END) AS ai_yes_admin_no,
                 COUNT(CASE WHEN ai_mv = 2 AND admin_mv = 1 THEN 1 END) AS ai_no_admin_yes,
                 COUNT(CASE WHEN ai_mv = 2 AND admin_mv = 2 THEN 1 END) AS ai_no_admin_no,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND ai_mv = 1 AND human_mv = 1 THEN 1 END) AS ramp_ai_yes_mv_yes,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND ai_mv = 1 AND human_mv = 2 THEN 1 END) AS ramp_ai_yes_mv_no,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND ai_mv = 2 AND human_mv = 1 THEN 1 END) AS ramp_ai_no_mv_yes,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND ai_mv = 2 AND human_mv = 2 THEN 1 END) AS ramp_ai_no_mv_no,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND ai_mv = 1 AND admin_mv = 1 THEN 1 END) AS ramp_ai_yes_admin_yes,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND ai_mv = 1 AND admin_mv = 2 THEN 1 END) AS ramp_ai_yes_admin_no,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND ai_mv = 2 AND admin_mv = 1 THEN 1 END) AS ramp_ai_no_admin_yes,
                 COUNT(CASE WHEN label_type = 'CurbRamp' AND ai_mv = 2 AND admin_mv = 2 THEN 1 END) AS ramp_ai_no_admin_no,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND ai_mv = 1 AND human_mv = 1 THEN 1 END) AS noramp_ai_yes_mv_yes,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND ai_mv = 1 AND human_mv = 2 THEN 1 END) AS noramp_ai_yes_mv_no,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND ai_mv = 2 AND human_mv = 1 THEN 1 END) AS noramp_ai_no_mv_yes,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND ai_mv = 2 AND human_mv = 2 THEN 1 END) AS noramp_ai_no_mv_no,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND ai_mv = 1 AND admin_mv = 1 THEN 1 END) AS noramp_ai_yes_admin_yes,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND ai_mv = 1 AND admin_mv = 2 THEN 1 END) AS noramp_ai_yes_admin_no,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND ai_mv = 2 AND admin_mv = 1 THEN 1 END) AS noramp_ai_no_admin_yes,
                 COUNT(CASE WHEN label_type = 'NoCurbRamp' AND ai_mv = 2 AND admin_mv = 2 THEN 1 END) AS noramp_ai_no_admin_no,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND ai_mv = 1 AND human_mv = 1 THEN 1 END) AS obs_ai_yes_mv_yes,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND ai_mv = 1 AND human_mv = 2 THEN 1 END) AS obs_ai_yes_mv_no,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND ai_mv = 2 AND human_mv = 1 THEN 1 END) AS obs_ai_no_mv_yes,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND ai_mv = 2 AND human_mv = 2 THEN 1 END) AS obs_ai_no_mv_no,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND ai_mv = 1 AND admin_mv = 1 THEN 1 END) AS obs_ai_yes_admin_yes,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND ai_mv = 1 AND admin_mv = 2 THEN 1 END) AS obs_ai_yes_admin_no,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND ai_mv = 2 AND admin_mv = 1 THEN 1 END) AS obs_ai_no_admin_yes,
                 COUNT(CASE WHEN label_type = 'Obstacle' AND ai_mv = 2 AND admin_mv = 2 THEN 1 END) AS obs_ai_no_admin_no,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND ai_mv = 1 AND human_mv = 1 THEN 1 END) AS surf_ai_yes_mv_yes,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND ai_mv = 1 AND human_mv = 2 THEN 1 END) AS surf_ai_yes_mv_no,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND ai_mv = 2 AND human_mv = 1 THEN 1 END) AS surf_ai_no_mv_yes,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND ai_mv = 2 AND human_mv = 2 THEN 1 END) AS surf_ai_no_mv_no,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND ai_mv = 1 AND admin_mv = 1 THEN 1 END) AS surf_ai_yes_admin_yes,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND ai_mv = 1 AND admin_mv = 2 THEN 1 END) AS surf_ai_yes_admin_no,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND ai_mv = 2 AND admin_mv = 1 THEN 1 END) AS surf_ai_no_admin_yes,
                 COUNT(CASE WHEN label_type = 'SurfaceProblem' AND ai_mv = 2 AND admin_mv = 2 THEN 1 END) AS surf_ai_no_admin_no,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND ai_mv = 1 AND human_mv = 1 THEN 1 END) AS crswlk_ai_yes_mv_yes,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND ai_mv = 1 AND human_mv = 2 THEN 1 END) AS crswlk_ai_yes_mv_no,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND ai_mv = 2 AND human_mv = 1 THEN 1 END) AS crswlk_ai_no_mv_yes,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND ai_mv = 2 AND human_mv = 2 THEN 1 END) AS crswlk_ai_no_mv_no,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND ai_mv = 1 AND admin_mv = 1 THEN 1 END) AS crswlk_ai_yes_admin_yes,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND ai_mv = 1 AND admin_mv = 2 THEN 1 END) AS crswlk_ai_yes_admin_no,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND ai_mv = 2 AND admin_mv = 1 THEN 1 END) AS crswlk_ai_no_admin_yes,
                 COUNT(CASE WHEN label_type = 'Crosswalk' AND ai_mv = 2 AND admin_mv = 2 THEN 1 END) AS crswlk_ai_no_admin_no
          FROM (
              SELECT label.label_id, label_type.label_type,
                     -- Note that we're doing majority vote with AI for simplicity. Should only be one vote from AI.
                     CASE
                         WHEN COUNT(CASE WHEN role = 'AI' AND validation_result = 1 THEN 1 END)
                             > COUNT(CASE WHEN role = 'AI' AND validation_result = 2 THEN 1 END) THEN 1
                         WHEN COUNT(CASE WHEN role = 'AI' AND validation_result = 2 THEN 1 END)
                             > COUNT(CASE WHEN role = 'AI' AND validation_result = 1 THEN 1 END) THEN 2
                         ELSE 3
                         END AS ai_mv,
                     CASE
                         WHEN COUNT(CASE WHEN role <> 'AI' AND validation_result = 1 THEN 1 END)
                             > COUNT(CASE WHEN role <> 'AI' AND validation_result = 2 THEN 1 END) THEN 1
                         WHEN COUNT(CASE WHEN role <> 'AI' AND validation_result = 2 THEN 1 END)
                             > COUNT(CASE WHEN role <> 'AI' AND validation_result = 1 THEN 1 END) THEN 2
                         ELSE 3
                         END AS human_mv,
                     CASE
                         WHEN COUNT(CASE WHEN role IN ('Administrator', 'Owner') AND validation_result = 1 THEN 1 END)
                             > COUNT(CASE WHEN role IN ('Administrator', 'Owner') AND validation_result = 2 THEN 1 END) THEN 1
                         WHEN COUNT(CASE WHEN role IN ('Administrator', 'Owner') AND validation_result = 2 THEN 1 END)
                             > COUNT(CASE WHEN role IN ('Administrator', 'Owner') AND validation_result = 1 THEN 1 END) THEN 2
                         ELSE 3
                         END AS admin_mv
              FROM label
              INNER JOIN label_type ON label.label_type_id = label_type.label_type_id
              INNER JOIN label_validation ON label.label_id = label_validation.label_id
              INNER JOIN user_stat ON label_validation.user_id = user_stat.user_id
              INNER JOIN user_role ON user_stat.user_id = user_role.user_id
              INNER JOIN role ON user_role.role_id = role.role_id
              WHERE user_stat.excluded = FALSE
                  AND label.user_id <> label_validation.user_id -- Excluding times when user validated their own label.
              GROUP BY label.label_id, label_type.label_type
              HAVING COUNT(CASE WHEN role = 'AI' THEN 1 END) > 0
          ) AS majority_votes
      ) AS ai_stats;""".as[ProjectSidewalkStats].head
  }

  /**
   * Get label data necessary for AI validation and tag prediction.
   * @param labelId The ID of the label to get data for
   * @return A LabelDataForAi object containing label, label_point, and gsv_data information if they exist
   */
  def getLabelDataForAi(labelId: Int): DBIO[Option[LabelDataForAi]] = {
    labelsUnfiltered
      .join(labelPoints)
      .on(_.labelId === _.labelId)
      .join(gsvData)
      .on { case ((label, point), gsv) => label.gsvPanoramaId === gsv.gsvPanoramaId }
      .filter { case ((label, point), gsv) => label.labelId === labelId && gsv.width.isDefined && gsv.height.isDefined }
      .result
      .headOption
      .map(_.map { case ((label, point), gsv) => LabelDataForAi(label.labelId, label.labelTypeId, point, gsv) })
  }

  /**
   * Get a list of labels for AI to validate, prioritizing unvalidated labels on older images.
   * @param n The number of labels to retrieve
   * @return A sequence of LabelDataForAi objects to feed to the SidewalkAI API for validation
   */
  def getLabelsToValidateWithAi(n: Int): DBIO[Seq[LabelDataForAi]] = {
    val possibleLabels = labels
      .filter(_.labelTypeId inSet LabelTypeEnum.aiLabelTypeIds)
      .join(userRoles)
      .on(_.userId === _.userId)
      .join(roleTable)
      .on(_._2.roleId === _.roleId)
      .filter { case ((l, ur), r) => r.role =!= "AI" } // No labels created by AI
      .joinLeft(labelAiAssessments)
      .on(_._1._1.labelId === _.labelId)
      .filter { case (((l, ur), r), laa) => laa.map(_.labelId).isEmpty } // No labels that AI's already validated
      .map(_._1._1._1)

    possibleLabels
      .join(labelPoints)
      .on(_.labelId === _.labelId)
      .join(gsvData)
      .on { case ((label, point), gsv) => label.gsvPanoramaId === gsv.gsvPanoramaId }
      .filter { case ((label, point), gsv) => !gsv.expired && gsv.width.isDefined && gsv.height.isDefined }
      .sortBy { case ((label, point), gsv) =>
        (
          label.correct.isDefined.asc,                                      // Unsure/unvalidated first
          gsv.captureDate.asc.nullsLast,                                    // Older images first
          (label.agreeCount + label.disagreeCount + label.unsureCount).asc, // Fewer validations first
          label.timeCreated.desc                                            // More recently added labels first
        )
      }
      .take(n)
      .result
      .map(_.map { case ((label, point), gsv) => LabelDataForAi(label.labelId, label.labelTypeId, point, gsv) })
  }

  /**
   * Get next temp label id to be used. That would be the max used + 1, or just 1 if no labels in this task.
   */
  def nextTempLabelId(userId: String): DBIO[Int] = {
    labelsUnfiltered.filter(_.userId === userId).map(_.temporaryLabelId).max.result.map(_.map(x => x + 1).getOrElse(1))
  }

  /**
   * Get metadata used for 2022 CV project for all labels.
   */
  def getLabelCVMetadata: StreamingDBIO[Seq[LabelCVMetadataTuple], LabelCVMetadataTuple] = {
    (for {
      _l   <- labels
      _lp  <- labelPoints if _l.labelId === _lp.labelId
      _gsv <- gsvData if _l.gsvPanoramaId === _gsv.gsvPanoramaId
      if _gsv.cameraHeading.isDefined && _gsv.cameraPitch.isDefined
    } yield (
      _l.labelId,
      _gsv.gsvPanoramaId,
      _l.labelTypeId,
      _l.agreeCount,
      _l.disagreeCount,
      _l.unsureCount,
      _gsv.width,
      _gsv.height,
      _lp.panoX,
      _lp.panoY,
      LabelPointTable.canvasWidth,
      LabelPointTable.canvasHeight,
      _lp.canvasX,
      _lp.canvasY,
      _lp.zoom,
      _lp.heading,
      _lp.pitch,
      _gsv.cameraHeading.asColumnOf[Float],
      _gsv.cameraPitch.asColumnOf[Float]
    )).sortBy(_._1).result
  }
}
