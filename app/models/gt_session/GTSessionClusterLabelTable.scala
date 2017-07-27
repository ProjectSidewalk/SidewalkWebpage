package models.gt_session

/**
  * Created by hmaddali on 7/26/17.
  */
import models.label.{Label, LabelTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery


case class GTSessionClusterLabel(gtSessionClusterLabelId: Int, gtSessionClusterId: Int, labelId: Int)
/**
  *
  */
class GTSessionClusterLabelTable(tag: Tag) extends Table[GTSessionClusterLabel](tag, Some("sidewalk"), "gt_session_cluster_label") {
  def gtSessionClusterLabelId = column[Int]("gt_session_cluster_label_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def gtSessionClusterId = column[Int]("gt_session_cluster_id", O.NotNull)
  def labelId = column[Int]("label_id", O.NotNull)

  def * = (gtSessionClusterLabelId, gtSessionClusterId, labelId) <> ((GTSessionClusterLabel.apply _).tupled, GTSessionClusterLabel.unapply)

  def gt_session_cluster: ForeignKeyQuery[GTSessionClusterTable, GTSessionCluster] =
    foreignKey("gt_session_cluster_label_gt_session_cluster_id_fkey", gtSessionClusterId, TableQuery[GTSessionClusterTable])(_.gtSessionClusterId)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("gt_session_cluster_label_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

}

/**
  * Data access object for the Route table
  */
object GTSessionClusterLabelTable{
  val db = play.api.db.slick.DB
  val gt_session_cluster_labels = TableQuery[GTSessionClusterLabelTable]

  def getGTSessionClusterLabel(gtSessionClusterLabelId: Option[Int]): Option[GTSessionClusterLabel] = db.withSession { implicit session =>
    val gt_session_cluster_label = gt_session_cluster_labels.filter(_.gtSessionClusterLabelId === gtSessionClusterLabelId).list
    gt_session_cluster_label.headOption
  }

  def all: List[GTSessionClusterLabel] = db.withSession { implicit session =>
    gt_session_cluster_labels.list
  }

  def getSpecificGTSessionClusterLabels(gtSessionClusterId: Int): List[GTSessionClusterLabel] = db.withSession { implicit session =>
    gt_session_cluster_labels.filter(_.gtSessionClusterId === gtSessionClusterId).list
  }

  def save(gt_session_cluster_label: GTSessionClusterLabel): Int = db.withTransaction { implicit session =>
    val sclId: Int =
      (gt_session_cluster_labels returning gt_session_cluster_labels.map(_.gtSessionClusterLabelId)) += gt_session_cluster_label
    sclId
  }

}