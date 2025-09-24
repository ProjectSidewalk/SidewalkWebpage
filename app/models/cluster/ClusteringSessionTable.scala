package models.cluster

import com.google.inject.ImplementedBy
import models.audit.AuditTaskTableDef
import models.label.{LabelPointTableDef, LabelTableDef, LabelTypeTableDef}
import models.mission.MissionTableDef
import models.region.RegionTableDef
import models.street.StreetEdgeRegionTableDef
import models.user.UserStatTableDef
import models.utils.MyPostgresProfile.api._
import models.utils.{ClusteringThreshold, MyPostgresProfile}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class ClusteringSession(
    clusteringSessionId: Int,
    regionId: Int,
    thresholds: Seq[ClusteringThreshold],
    timestamp: OffsetDateTime
)

case class LabelToCluster(
    regionId: Int,
    userId: String,
    panoId: String,
    labelId: Int,
    labelType: String,
    lat: Float,
    lng: Float,
    severity: Option[Int]
)

class ClusteringSessionTableDef(tag: Tag) extends Table[ClusteringSession](tag, "clustering_session") {
  def clusteringSessionId: Rep[Int]             = column[Int]("clustering_session_id", O.PrimaryKey, O.AutoInc)
  def regionId: Rep[Int]                        = column[Int]("region_id")
  def thresholds: Rep[Seq[ClusteringThreshold]] = column[Seq[ClusteringThreshold]]("thresholds")
  def timestamp: Rep[OffsetDateTime]            = column[OffsetDateTime]("timestamp")

  def * = (clusteringSessionId, regionId, thresholds, timestamp) <>
    ((ClusteringSession.apply _).tupled, ClusteringSession.unapply)

//  def region: ForeignKeyQuery[RegionTable, Region] =
//    foreignKey("clustering_session_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
}

@ImplementedBy(classOf[ClusteringSessionTable])
trait ClusteringSessionTableRepository {

  /**
   * Get the list of regions where labels needs to be re-clustered.
   *
   * We find the list of regions by determining which labels _should_ show up in the API and compare that to which
   * labels _are_ present in the API. Any mismatches indicate that labels in that region should be re-clustered.
   *
   * @return A sequence of region_ids that need to be re-clustered, wrapped in a DBIO action
   */
  def getRegionsToCluster: DBIO[Seq[Int]]

  /**
   * Returns labels that were placed by the specified user in the format needed for clustering.
   * @param regionId The region whose labels should be retrieved
   * @return A sequence of LabelToCluster objects wrapped in a DBIO action
   */
  def getLabelsToClusterInRegion(regionId: Int): DBIO[Seq[LabelToCluster]]

  /**
   * Deletes the clustering_session for the selected region_ids, cascading to delete `cluster` and `cluster_label`.
   * @param regionIds The list of region_ids whose clustering_sessions (and clusters) should be deleted
   * @return The number of clustering_sessions deleted, wrapped in a DBIO action
   */
  def deleteClusteringSessions(regionIds: Seq[Int]): DBIO[Int]

  /**
   * Insert a new clustering session, returning the new clustering_session_id.
   * @param newSess The new clustering session to insert
   * @return The new clustering_session_id wrapped in a DBIO action
   */
  def insert(newSess: ClusteringSession): DBIO[Int]
}

@Singleton
class ClusteringSessionTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    ec: ExecutionContext
) extends ClusteringSessionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  private val clusteringSessions = TableQuery[ClusteringSessionTableDef]
  private val clusterLabels      = TableQuery[ClusterLabelTableDef]
  private val labelsUnfiltered   = TableQuery[LabelTableDef]
  private val missions           = TableQuery[MissionTableDef]
  private val regions            = TableQuery[RegionTableDef]
  private val auditTasks         = TableQuery[AuditTaskTableDef]
  private val userStats          = TableQuery[UserStatTableDef]
  private val labelTypes         = TableQuery[LabelTypeTableDef]
  private val labelPoints        = TableQuery[LabelPointTableDef]
  private val streetEdgeRegions  = TableQuery[StreetEdgeRegionTableDef]

  // Get labels that should be in the API. Labels from high quality users that haven't been explicitly marked as
  // incorrect should be included, plus labels from low quality users that have been explicitly marked as correct.
  def labelsForApiQuery: Query[
    (Rep[Int], Rep[String], Rep[String], Rep[Int], Rep[String], Rep[Float], Rep[Float], Rep[Option[Int]]),
    (Int, String, String, Int, String, Float, Float, Option[Int]),
    Seq
  ] = for {
    m   <- missions
    r   <- regions if m.regionId === r.regionId
    us  <- userStats if m.userId === us.userId
    l   <- labelsUnfiltered if l.missionId === m.missionId
    ser <- streetEdgeRegions if l.streetEdgeId === ser.streetEdgeId
    at  <- auditTasks if l.auditTaskId === at.auditTaskId
    lp  <- labelPoints if l.labelId === lp.labelId
    lt  <- labelTypes if l.labelTypeId === lt.labelTypeId
    if r.deleted === false
    if l.correct || (us.highQuality && l.correct.isEmpty && !at.lowQuality)
    if lp.lat.isDefined && lp.lng.isDefined
  } yield (ser.regionId, us.userId, l.gsvPanoramaId, l.labelId, lt.labelType, lp.lat.ifNull(-1f), lp.lng.ifNull(-1f),
    l.severity)

  def getRegionsToCluster: DBIO[Seq[Int]] = {
    // Get the labels that are currently present in the API.
    val labelsInApi = for {
      cl  <- clusterLabels
      l   <- labelsUnfiltered if cl.labelId === l.labelId
      ser <- streetEdgeRegions if l.streetEdgeId === ser.streetEdgeId
    } yield (ser.regionId, l.labelId)

    // Find all mismatches between the list of labels above using an outer join.
    labelsForApiQuery
      .joinFull(labelsInApi)
      .on(_._4 === _._2)                               // FULL OUTER JOIN on label_id.
      .filter(x => x._1.isEmpty || x._2.isEmpty)       // WHERE no_api.label_id IS NULL OR in_api.label_id IS NULL.
      .map(x => x._1.map(_._1).ifNull(x._2.map(_._1))) // COALESCE(no_api.region_id, in_api.region_id).
      .distinct                                        // SELECT DISTINCT and flatten.
      .result
      .map(_.flatten)
  }

  def getLabelsToClusterInRegion(regionId: Int): DBIO[Seq[LabelToCluster]] = {
    labelsForApiQuery.filter(_._1 === regionId).result.map(_.map(LabelToCluster.tupled))
  }

  def deleteClusteringSessions(regionIds: Seq[Int]): DBIO[Int] = {
    clusteringSessions.filter(_.regionId inSetBind regionIds).delete
  }

  def insert(newSess: ClusteringSession): DBIO[Int] = {
    (clusteringSessions returning clusteringSessions.map(_.clusteringSessionId)) += newSess
  }
}
