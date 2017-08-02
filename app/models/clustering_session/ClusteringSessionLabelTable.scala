package models.clustering_session

/**
  * Created by hmaddali on 7/26/17.
  */
import models.label.{Label, LabelTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery


case class ClusteringSessionLabel(clusteringSessionLabelId: Int, clusteringSessionClusterId: Int, labelId: Int)
/**
  *
  */
class ClusteringSessionLabelTable(tag: Tag) extends Table[ClusteringSessionLabel](tag, Some("sidewalk"), "clustering_session_label") {
  def clusteringSessionLabelId = column[Int]("clustering_session_label_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def clusteringSessionClusterId = column[Int]("clustering_session_cluster_id", O.NotNull)
  def labelId = column[Int]("label_id", O.NotNull)

  def * = (clusteringSessionLabelId, clusteringSessionClusterId, labelId) <> ((ClusteringSessionLabel.apply _).tupled, ClusteringSessionLabel.unapply)

  def clusteringSessionCluster: ForeignKeyQuery[ClusteringSessionClusterTable, ClusteringSessionCluster] =
    foreignKey("clustering_session_label_clustering_session_cluster_id_fkey", clusteringSessionClusterId, TableQuery[ClusteringSessionClusterTable])(_.clusteringSessionClusterId)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("clustering_session_label_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

}

/**
  * Data access object for the Clustering Session Label table
  */
object ClusteringSessionLabelTable{
  val db = play.api.db.slick.DB
  val clusteringSessionLabels = TableQuery[ClusteringSessionLabelTable]

  def getClusteringSessionLabel(clusteringSessionLabelId: Int): Option[ClusteringSessionLabel] = db.withSession { implicit session =>
    val clusteringSessionLabel = clusteringSessionLabels.filter(_.clusteringSessionLabelId === clusteringSessionLabelId).list
    clusteringSessionLabel.headOption
  }

  def all: List[ClusteringSessionLabel] = db.withSession { implicit session =>
    clusteringSessionLabels.list
  }

  def getSpecificClusteringSessionLabels(clusteringSessionClusterId: Int): List[ClusteringSessionLabel] = db.withSession { implicit session =>
    clusteringSessionLabels.filter(_.clusteringSessionClusterId === clusteringSessionClusterId).list
  }

  def save(clusteringSessionLabel: ClusteringSessionLabel): Int = db.withTransaction { implicit session =>
    val sclId: Int =
      (clusteringSessionLabels returning clusteringSessionLabels.map(_.clusteringSessionLabelId)) += clusteringSessionLabel
    sclId
  }

}