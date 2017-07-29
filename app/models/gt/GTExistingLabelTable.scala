package models.gt

/**
  * Created by hmaddali on 7/26/17.
  */
import models.label.{Label, LabelTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class GTExistingLabel(gtExistingLabelId: Int, gtLabelId: Int, labelId: Int)

class GTExistingLabelTable(tag: Tag) extends Table[GTExistingLabel](tag, Some("sidewalk"), "gt_existing_label") {

  def gtExistingLabelId = column[Int]("gt_existing_label_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def gtLabelId = column[Int]("gt_label_id", O.NotNull)
  def labelId = column[Int]("label_id", O.NotNull)

  def * = (gtExistingLabelId, gtLabelId, labelId) <> ((GTExistingLabel.apply _).tupled, GTExistingLabel.unapply)

  def gtLabel: ForeignKeyQuery[GTLabelTable, GTLabel] =
    foreignKey("gt_existing_label_gt_label_id_fkey", gtLabelId, TableQuery[GTLabelTable])(_.gtLabelId)

  def labelType: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("gt_existing_label_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

}

object GTExistingLabelTable{
  val db = play.api.db.slick.DB
  val gt_existing_labels = TableQuery[GTExistingLabelTable]

  def getExistingGTLabel(gtExistingLabelId: Int): Option[GTExistingLabel] = db.withSession { implicit session =>
    val gt_existing_label = gt_existing_labels.filter(_.gtExistingLabelId === gtExistingLabelId).list
    gt_existing_label.headOption
  }

  def all: List[GTExistingLabel] = db.withSession { implicit session =>
    gt_existing_labels.list
  }

  def save(gt_existing_label: GTExistingLabel): Int = db.withTransaction { implicit session =>
    val gteId: Int =
      (gt_existing_labels returning gt_existing_labels.map(_.gtExistingLabelId)) += gt_existing_label
    gteId
  }

}

