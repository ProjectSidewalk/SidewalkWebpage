package models.clustering_session

/**
  * Created by hmaddali on 7/26/17.
  */

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class ClusteringSessionCluster(clusteringSessionClusterId: Int, clusteringSessionId: Int)

/**
  *
  */
class ClusteringSessionClusterTable(tag: Tag) extends Table[ClusteringSessionCluster](tag, Some("sidewalk"), "clustering_session_cluster") {
  def clusteringSessionClusterId = column[Int]("clustering_session_cluster_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def clusteringSessionId = column[Int]("clustering_session_id", O.NotNull)

  def * = (clusteringSessionClusterId, clusteringSessionId) <> ((ClusteringSessionCluster.apply _).tupled, ClusteringSessionCluster.unapply)

  def clustering_session: ForeignKeyQuery[ClusteringSessionTable, ClusteringSession] =
    foreignKey("clustering_session_cluster_cluster_session_id_fkey", clusteringSessionId, TableQuery[ClusteringSessionTable])(_.clusteringSessionId)

}

/**
  * Data access object for the Route table
  */
object ClusteringSessionClusterTable{
  val db = play.api.db.slick.DB
  val clustering_session_clusters = TableQuery[ClusteringSessionClusterTable]

  def getClusteringSessionCluster(clusteringSessionClusterId: Option[Int]): Option[ClusteringSessionCluster] = db.withSession { implicit session =>
    val clustering_session_cluster = clustering_session_clusters.filter(_.clusteringSessionClusterId === clusteringSessionClusterId).list
    clustering_session_cluster.headOption
  }

  def all: List[ClusteringSessionCluster] = db.withSession { implicit session =>
    clustering_session_clusters.list
  }

  def getSpecificClusteringSessionClusters(clusteringSessionId: Int): List[ClusteringSessionCluster] = db.withSession { implicit session =>
    clustering_session_clusters.filter(_.clusteringSessionId === clusteringSessionId).list
  }

  def save(clustering_session_cluster: ClusteringSessionCluster): Int = db.withTransaction { implicit session =>
    val scId: Int =
      (clustering_session_clusters returning clustering_session_clusters.map(_.clusteringSessionClusterId)) += clustering_session_cluster
    scId
  }

}