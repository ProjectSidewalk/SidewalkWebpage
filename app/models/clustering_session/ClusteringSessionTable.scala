package models.clustering_session

/**
  * Created by hmaddali on 7/26/17.
  */
import models.amt.AMTAssignmentTable
import models.audit.AuditTaskTable
import models.label.{LabelTable, ProblemTemporarinessTable}
import models.route.{Route, RouteTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class ClusteringSession(clusteringSessionId: Int, routeId: Int, clustering_threshold: Double,
                             time_created: java.sql.Timestamp, deleted: Boolean)

case class LabelToCluster(labelId: Int, labelType: String, lat: Option[Float], lng: Option[Float],
                          severity: Option[Int], temp: Boolean, turkerId: String)
/**
  *
  */
class ClusteringSessionTable(tag: Tag) extends Table[ClusteringSession](tag, Some("sidewalk"), "clustering_session") {
  def clusteringSessionId = column[Int]("clustering_session_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def routeId = column[Int]("route_id", O.NotNull)
  def clustering_threshold = column[Double]("clustering_threshold", O.NotNull)
  def deleted = column[Boolean]("deleted", O.NotNull)
  def time_created = column[java.sql.Timestamp]("time_created",O.NotNull)
  def * = (clusteringSessionId, routeId, clustering_threshold, time_created, deleted) <> ((ClusteringSession.apply _).tupled, ClusteringSession.unapply)

  def route: ForeignKeyQuery[RouteTable, Route] =
    foreignKey("clustering_session_route_id_fkey", routeId, TableQuery[RouteTable])(_.routeId)

}

/**
  * Data access object for the Clustering Session table
  */
object ClusteringSessionTable{
  val db = play.api.db.slick.DB
  val clustering_sessions = TableQuery[ClusteringSessionTable]

  def getClusteringSession(clusteringSessionId: Int): Option[ClusteringSession] = db.withSession { implicit session =>
    val clustering_session = clustering_sessions.filter(_.clusteringSessionId === clusteringSessionId).list
    clustering_session.headOption
  }

  def all: List[ClusteringSession] = db.withSession { implicit session =>
    clustering_sessions.list
  }

  def selectSessionsWithoutDeleted: List[ClusteringSession] = db.withSession { implicit session =>
    clustering_sessions.filter(_.deleted === false).list
  }

  def getLabelsToCluser(routeId: Int, hitId: String): List[LabelToCluster] = db.withSession {implicit session =>
    val asmts = AMTAssignmentTable.amtAssignments.filter(asmt => asmt.routeId === routeId && asmt.hitId === hitId)

    val tasks = for {
      (_asmts, _tasks) <- asmts.innerJoin(AuditTaskTable.auditTasks).on(_.amtAssignmentId === _.amtAssignmentId)
      if _tasks.completed
    } yield (_asmts.turkerId, _tasks.auditTaskId)

    val labels = for {
      (_tasks, _labs) <- tasks.innerJoin(LabelTable.labelsWithoutDeleted).on(_._2 === _.auditTaskId)
    } yield (_tasks._1, _labs.labelId, _labs.labelTypeId)

    val labelsWithType = for {
      (_labels, _types) <- labels.innerJoin(LabelTable.labelTypes).on(_._3 === _.labelTypeId)
    } yield (_labels._1, _labels._2, _types.labelType)

    val labelsWithLatLng = for {
      (_labs, _labPoints) <- labelsWithType.innerJoin(LabelTable.labelPoints).on(_._2 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labPoints.lat, _labPoints.lng)

    val labelsWithSeverity = for {
      (_labs, _severity) <- labelsWithLatLng.leftJoin(LabelTable.severities).on(_._2 === _.labelId)
    } yield (_labs._1, _labs._2, _labs._3, _labs._4, _labs._5,  _severity.severity.?)

    val labelsWithTemporariness = for {
      (_labs, _temporariness) <- labelsWithSeverity.leftJoin(ProblemTemporarinessTable.problemTemporarinesses).on(_._2 === _.labelId)
    } yield (_labs._2, _labs._3, _labs._4, _labs._5, _labs._6, _temporariness.temporaryProblem.?, _labs._1)

    labelsWithTemporariness.list.map(x => LabelToCluster.tupled((x._1, x._2, x._3, x._4, x._5, x._6.getOrElse(false), x._7)))
  }

  def save(clustering_session: ClusteringSession): Int = db.withTransaction { implicit session =>
    val sId: Int =
      (clustering_sessions returning clustering_sessions.map(_.clusteringSessionId)) += clustering_session
    sId
  }

  def updateDeleted(clustering_session_id: Int, deleted: Boolean)= db.withTransaction { implicit session =>
    val q = for {
      clustering_session <- clustering_sessions
      if clustering_session.clusteringSessionId === clustering_session_id
    } yield clustering_session.deleted
    q.update(deleted)
  }

}