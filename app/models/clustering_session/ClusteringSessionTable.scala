package models.clustering_session

/**
  * Created by hmaddali on 7/26/17.
  */
import models.amt.AMTAssignmentTable
import models.audit.AuditTaskTable
import models.label.{LabelTable, ProblemDescriptionTable, ProblemTemporarinessTable}
import models.route.{Route, RouteTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class ClusteringSession(clusteringSessionId: Int, routeId: Int, clusteringThreshold: Double,
                             timeCreated: java.sql.Timestamp, deleted: Boolean)

case class LabelToCluster(labelId: Int, labelType: String, lat: Option[Float], lng: Option[Float],
                          severity: Option[Int], temp: Boolean, turkerId: String)

case class LabelsForResolution(labelId: Int, clusterId: Int, turkerId: String, gsvPanoramaId: String, labelType: String,
                               svImageX: Int, svImageY: Int, canvasX: Int, canvasY: Int, heading: Float, pitch: Float,
                               zoom: Int, canvasHeight: Int, canvasWidth: Int, alphaX: Float, alphaY: Float,
                               lat: Option[Float], lng: Option[Float], description: Option[String],
                               severity: Option[Int], temporaryProblem: Boolean)
/**
  *
  */
class ClusteringSessionTable(tag: Tag) extends Table[ClusteringSession](tag, Some("sidewalk"), "clustering_session") {
  def clusteringSessionId = column[Int]("clustering_session_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def routeId = column[Int]("route_id", O.NotNull)
  def clusteringThreshold = column[Double]("clustering_threshold", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)
  def timeCreated = column[java.sql.Timestamp]("time_created",O.NotNull)
  def * = (clusteringSessionId, routeId, clusteringThreshold, timeCreated, deleted) <> ((ClusteringSession.apply _).tupled, ClusteringSession.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("clustering_session_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

}

/**
  * Data access object for the Clustering Session table
  */
object ClusteringSessionTable{
  val db = play.api.db.slick.DB
  val clusteringSessions = TableQuery[ClusteringSessionTable]

  def getClusteringSession(clusteringSessionId: Int): Option[ClusteringSession] = db.withSession { implicit session =>
    val clusteringSession = clusteringSessions.filter(_.clusteringSessionId === clusteringSessionId).list
    clusteringSession.headOption
  }

  def all: List[ClusteringSession] = db.withSession { implicit session =>
    clusteringSessions.list
  }

  def selectSessionsWithoutDeleted: List[ClusteringSession] = db.withSession { implicit session =>
    clusteringSessions.filter(_.deleted === false).list
  }

  /**
    * Returns labels that were placed during the specified HIT on the specified route, in the form needed for clustering
    *
    * @param routeId
    * @param hitId
    * @return
    */
  def getLabelsToCluser(routeId: Int, hitId: String): List[LabelToCluster] = db.withSession {implicit session =>
    val asmts = AMTAssignmentTable.amtAssignments.filter(asmt => asmt.routeId === routeId && asmt.hitId === hitId)

    // does a bunch of inner joins
    val labels = for {
      _asmts <- asmts
      _tasks <- AuditTaskTable.auditTasks if _asmts.amtAssignmentId === _tasks.amtAssignmentId
      _labs <- LabelTable.labelsWithoutDeleted if _tasks.auditTaskId === _labs.auditTaskId
      _latlngs <- LabelTable.labelPoints if _labs.labelId === _latlngs.labelId
      _types <- LabelTable.labelTypes if _labs.labelTypeId === _types.labelTypeId
    } yield (_asmts.turkerId, _labs.labelId, _types.labelType, _latlngs.lat, _latlngs.lng)

    // left joins to get severity for any labels that have them
    val labelsWithSeverity = for {
      (_labs, _severity) <- labels.leftJoin(LabelTable.severities).on(_._2 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5,  _severity.severity.?)

    // left joins to get temporariness for any labels that have them (those that don't are marked as temporary=false)
    val labelsWithTemporariness = for {
      (_labs, _temporariness) <- labelsWithSeverity.leftJoin(ProblemTemporarinessTable.problemTemporarinesses).on(_._2 === _.labelId)
    } yield (_labs._2, _labs._3, _labs._4, _labs._5, _labs._6, _temporariness.temporaryProblem.?, _labs._1)

    labelsWithTemporariness.list.map(x => LabelToCluster.tupled((x._1, x._2, x._3, x._4, x._5, x._6.getOrElse(false), x._7)))
  }

  /**
    * Returns labels that were used in the specified clustering session, includes all data needed for gt_label table.
    *
    * @param clusteringSessionId
    * @return
    */
  def getLabelsForGtResolution(clusteringSessionId: Int): List[LabelsForResolution] = db.withTransaction { implicit session =>
    // does a bunch of inner joins to get most of the label data
    val labels = for {
      _session <- clusteringSessions if _session.clusteringSessionId === clusteringSessionId
      _clusters <- ClusteringSessionClusterTable.clusteringSessionClusters if _session.clusteringSessionId === _clusters.clusteringSessionId
      _clustLabs <- ClusteringSessionLabelTable.clusteringSessionLabels if _clusters.clusteringSessionClusterId === _clustLabs.clusteringSessionClusterId
      _labs <- LabelTable.labels if _clustLabs.labelId === _labs.labelId
      _tasks <- AuditTaskTable.auditTasks if _labs.auditTaskId === _tasks.auditTaskId
      _amtAsmt <- AMTAssignmentTable.amtAssignments if _tasks.amtAssignmentId === _amtAsmt.amtAssignmentId
      _labPoints <- LabelTable.labelPoints if _labs.labelId === _labPoints.labelId
      _types <- LabelTable.labelTypes if _labs.labelTypeId === _types.labelTypeId
    } yield (_labs.labelId, _clusters.clusteringSessionClusterId, _amtAsmt.turkerId, _labs.gsvPanoramaId, _types.labelType,
             _labPoints.svImageX, _labPoints.svImageY, _labPoints.canvasX, _labPoints.canvasY, _labPoints.heading,
             _labPoints.pitch, _labPoints.zoom, _labPoints.canvasHeight, _labPoints.canvasWidth, _labPoints.alphaX,
             _labPoints.alphaY, _labPoints.lat, _labPoints.lng)

    // left joins to get descriptions for any labels that have them
    val labelsWithDescription = for {
      (_labs, _descriptions) <- labels.leftJoin(ProblemDescriptionTable.problemDescriptions).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5, _labs._6, _labs._7, _labs._8, _labs._9, _labs._10,
             _labs._11, _labs._12, _labs._13, _labs._14, _labs._15, _labs._16, _labs._17, _labs._18, _descriptions.description.?)

    // left joins to get severity for any labels that have them
    val labelsWithSeverity = for {
      (_labs, _severity) <- labelsWithDescription.leftJoin(LabelTable.severities).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5, _labs._6, _labs._7, _labs._8, _labs._9, _labs._10,
             _labs._11, _labs._12, _labs._13, _labs._14, _labs._15, _labs._16, _labs._17, _labs._18, _labs._19, _severity.severity.?)

    // left joins to get temporariness for any labels that have them (those that don't are marked as temporary=false)
    val labelsWithTemporariness = for {
      (_labs, _temporariness) <- labelsWithSeverity.leftJoin(ProblemTemporarinessTable.problemTemporarinesses).on(_._1 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5, _labs._6, _labs._7, _labs._8, _labs._9, _labs._10,
             _labs._11, _labs._12, _labs._13, _labs._14, _labs._15, _labs._16, _labs._17, _labs._18, _labs._19, _labs._20,
             _temporariness.temporaryProblem.?)

    labelsWithTemporariness.list.map(x =>
      LabelsForResolution.tupled((x._1, x._2, x._3, x._4, x._5, x._6, x._7, x._8, x._9, x._10, x._11, x._12, x._13,
                                  x._14, x._15, x._16, x._17, x._18, x._19, x._20, x._21.getOrElse(false))))
  }


  def save(clusteringSession: ClusteringSession): Int = db.withTransaction { implicit session =>
    val sId: Int =
      (clusteringSessions returning clusteringSessions.map(_.clusteringSessionId)) += clusteringSession
    sId
  }

  def updateDeleted(clusteringSessionId: Int, deleted: Boolean)= db.withTransaction { implicit session =>
    val q = for {
      clusteringSession <- clusteringSessions
      if clusteringSession.clusteringSessionId === clusteringSessionId
    } yield clusteringSession.deleted
    q.update(deleted)
  }

}