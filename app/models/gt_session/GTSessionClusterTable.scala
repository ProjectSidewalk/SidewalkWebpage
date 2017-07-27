package models.gt_session

/**
  * Created by hmaddali on 7/26/17.
  */

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class GTSessionCluster(gtSessionClusterId: Int, gtSessionId: Int)

/**
  *
  */
class GTSessionClusterTable(tag: Tag) extends Table[GTSessionCluster](tag, Some("sidewalk"), "gt_session_cluster") {
  def gtSessionClusterId = column[Int]("gt_session_cluster_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def gtSessionId = column[Int]("gt_session_id", O.NotNull)

  def * = (gtSessionClusterId, gtSessionId) <> ((GTSessionCluster.apply _).tupled, GTSessionCluster.unapply)

  def gt_session: ForeignKeyQuery[GTSessionTable, GTSession] =
    foreignKey("gt_session_cluster_gt_session_id_fkey", gtSessionId, TableQuery[GTSessionTable])(_.gtSessionId)

}

/**
  * Data access object for the Route table
  */
object GTSessionClusterTable{
  val db = play.api.db.slick.DB
  val gt_session_clusters = TableQuery[GTSessionClusterTable]

  def getGTSessionCluster(gtSessionClusterId: Option[Int]): Option[GTSessionCluster] = db.withSession { implicit session =>
    val gt_session_cluster = gt_session_clusters.filter(_.gtSessionClusterId === gtSessionClusterId).list
    gt_session_cluster.headOption
  }

  def all: List[GTSessionCluster] = db.withSession { implicit session =>
    gt_session_clusters.list
  }

  def getSpecificGTSessionClusters(gtSessionId: Int): List[GTSessionCluster] = db.withSession { implicit session =>
    gt_session_clusters.filter(_.gtSessionId === gtSessionId).list
  }

  def save(gt_session_cluster: GTSessionCluster): Int = db.withTransaction { implicit session =>
    val scId: Int =
      (gt_session_clusters returning gt_session_clusters.map(_.gtSessionClusterId)) += gt_session_cluster
    scId
  }

}