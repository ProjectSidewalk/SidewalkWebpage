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

  def clusteringSession: ForeignKeyQuery[ClusteringSessionTable, ClusteringSession] =
    foreignKey("clustering_session_cluster_cluster_session_id_fkey", clusteringSessionId, TableQuery[ClusteringSessionTable])(_.clusteringSessionId)

}

/**
  * Data access object for the Clustering Session Cluster table
  */
object ClusteringSessionClusterTable{
  val db = play.api.db.slick.DB
  val clusteringSessionClusters = TableQuery[ClusteringSessionClusterTable]

  def getClusteringSessionCluster(clusteringSessionClusterId: Int): Option[ClusteringSessionCluster] = db.withSession { implicit session =>
    val clusteringSessionCluster = clusteringSessionClusters.filter(_.clusteringSessionClusterId === clusteringSessionClusterId).list
    clusteringSessionCluster.headOption
  }

  def all: List[ClusteringSessionCluster] = db.withSession { implicit session =>
    clusteringSessionClusters.list
  }

  def getSpecificClusteringSessionClusters(clusteringSessionId: Int): List[ClusteringSessionCluster] = db.withSession { implicit session =>
    clusteringSessionClusters.filter(_.clusteringSessionId === clusteringSessionId).list
  }

  def save(clusteringSessionCluster: ClusteringSessionCluster): Int = db.withTransaction { implicit session =>
    val scId: Int =
      (clusteringSessionClusters returning clusteringSessionClusters.map(_.clusteringSessionClusterId)) += clusteringSessionCluster
    scId
  }

}