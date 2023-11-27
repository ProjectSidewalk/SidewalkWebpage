package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class LabelType(labelTypeId: Int, labelType: String, description: String)

class LabelTypeTable(tag: slick.lifted.Tag) extends Table[LabelType](tag, "label_type") {
  def labelTypeId = column[Int]("label_type_id", O.PrimaryKey, O.AutoInc)
  def labelType = column[String]("label_type", O.NotNull)
  def description = column[String]("description")

  def * = (labelTypeId, labelType, description) <> ((LabelType.apply _).tupled, LabelType.unapply)
}

/**
 * Data access object for the label_type table.
 */
object LabelTypeTable {
  val db = play.api.db.slick.DB
  val labelTypes = TableQuery[LabelTypeTable]

  // Set of valid/primary label types.
  def validLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Other", "Occlusion", "NoSidewalk", "Crosswalk", "Signal")
  def primaryLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk")

  /**
   * Set of valid label type ids for the above valid label types.
   */
  def validLabelTypeIds: Set[Int] = db.withTransaction { implicit session =>
    labelTypes.filter(_.labelType inSet validLabelTypes).map(_.labelTypeId).list.toSet
  }

  /**
   * Set of primary label type ids for the above valid label types.
   */
  def primaryLabelTypeIds: Set[Int] = db.withTransaction { implicit session =>
    labelTypes.filter(_.labelType inSet primaryLabelTypes).map(_.labelTypeId).list.toSet
  }

  /**
    * Gets the label type id from the label type name.
    */
  def labelTypeToId(labelType: String): Int = db.withTransaction { implicit session =>
    labelTypes.filter(_.labelType === labelType).map(_.labelTypeId).first
  }

  /**
    * Gets the label type name from the label type id.
    */
  def labelTypeIdToLabelType(labelTypeId: Int): String = db.withTransaction { implicit session =>
    labelTypes.filter(_.labelTypeId === labelTypeId).map(_.labelType).first
  }
}
