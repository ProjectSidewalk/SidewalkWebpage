package models.cluster

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class ClusterLabel(clusterLabelId: Int, clusterId: Int, labelId: Int)

class ClusterLabelTableDef(tag: Tag) extends Table[ClusterLabel](tag, "cluster_label") {
  def clusterLabelId: Rep[Int] = column[Int]("cluster_label_id", O.PrimaryKey, O.AutoInc)
  def clusterId: Rep[Int]      = column[Int]("cluster_id")
  def labelId: Rep[Int]        = column[Int]("label_id")

  def * = (clusterLabelId, clusterId, labelId) <> ((ClusterLabel.apply _).tupled, ClusterLabel.unapply)

//  def cluster: ForeignKeyQuery[ClusterTable, Cluster] =
//    foreignKey("cluster_label_cluster_id_fkey", clusterId, TableQuery[ClusterTableDef])(_.clusterId)
//
//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("cluster_label_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
}

@ImplementedBy(classOf[ClusterLabelTable]) trait ClusterLabelTableRepository {
  def countClusterLabels: DBIO[Int]
  def insertMultiple(clusterLabels: Seq[ClusterLabel]): DBIO[Seq[Int]]
}

@Singleton
class ClusterLabelTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends ClusterLabelTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val clusterLabels = TableQuery[ClusterLabelTableDef]

  def countClusterLabels: DBIO[Int] = {
    clusterLabels.length.result
  }

  def insertMultiple(newClusterLabels: Seq[ClusterLabel]): DBIO[Seq[Int]] = {
    (clusterLabels returning clusterLabels.map(_.clusterLabelId)) ++= newClusterLabels
  }
}
