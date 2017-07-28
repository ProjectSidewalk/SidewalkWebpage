package models.clustering_session

/**
  * Created by hmaddali on 7/26/17.
  */
import models.route.{Route, RouteTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class ClusteringSession(clusteringSessionId: Int, routeId: Int, clustering_threshold: Double, time_created: java.sql.Timestamp,
                             deleted: Boolean)
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

  def getClusteringSession(clusteringSessionId: Option[Int]): Option[ClusteringSession] = db.withSession { implicit session =>
    val clustering_session = clustering_sessions.filter(_.clusteringSessionId === clusteringSessionId).list
    clustering_session.headOption
  }

  def all: List[ClusteringSession] = db.withSession { implicit session =>
    clustering_sessions.list
  }

  def selectExistingSessions: List[ClusteringSession] = db.withSession { implicit session =>
    clustering_sessions.filter(_.deleted === false).list
  }

  def save(clustering_session: ClusteringSession): Int = db.withTransaction { implicit session =>
    val sId: Int =
      (clustering_sessions returning clustering_sessions.map(_.clusteringSessionId)) += clustering_session
    sId
  }

  def updateDeleted(clustering_session_id: Int, deleted: Boolean)= db.withTransaction { implicit session =>
    val q = for {clustering_session <- clustering_sessions if clustering_session.clusteringSessionId === clustering_session_id } yield clustering_session.deleted
    q.update(deleted)
  }

}