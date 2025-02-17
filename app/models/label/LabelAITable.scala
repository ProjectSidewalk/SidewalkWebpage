package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class LabelAI(labelAiId: Int, labelId: Int, aiTags: Option[String], aiValidationAccuracy: Option[Float], aiValidationResult: Option[String])

class LabelAITable(tag: slick.lifted.Tag) extends Table[LabelAI](tag, "label_ai") {
  def labelAiId = column[Int]("label_ai_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def aiTags = column[Option[String]]("ai_tags", O.Nullable)
  def aiValidationAccuracy = column[Option[Float]]("ai_validation_accuracy", O.Nullable)
  def aiValidationResult = column[Option[String]]("ai_validation_result", O.Nullable)

  def * = (labelAiId, labelId, aiTags, aiValidationAccuracy, aiValidationResult) <> ((LabelAI.apply _).tupled, LabelAI.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_ai_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

/**
  * Data access object for the label_ai table.
  */
object LabelAITable {
  val db = play.api.db.slick.DB
  val labelAIs = TableQuery[LabelAITable]

  /**
    * Find a label AI information by label id.
    */
  def findByLabelId(labelId: Int): Option[LabelAI] = db.withSession { implicit session =>
    val labelAIList: List[LabelAI] = labelAIs.filter(_.labelId === labelId).list
    labelAIList.headOption
  }

  /**
    * Stores label AI information into the label_ai table.
    */
  def save(labelAI: LabelAI): Int = db.withSession { implicit session =>
    (labelAIs returning labelAIs.map(_.labelAiId)) += labelAI
  }
}