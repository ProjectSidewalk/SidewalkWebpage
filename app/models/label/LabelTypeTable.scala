package models.label

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

case class LabelType(labelTypeId: Int, labelType: String, description: String)

/**
 *
 */
class LabelTypeTable(tag: slick.lifted.Tag) extends Table[LabelType](tag, Some("sidewalk"), "label_type") {
  def labelTypeId = column[Int]("label_type_id", O.PrimaryKey, O.AutoInc)
  def labelType = column[String]("label_type")
  def description = column[String]("description")

  def * = (labelTypeId, labelType, description) <> ((LabelType.apply _).tupled, LabelType.unapply)
}

/**
 * Data access object for the label_type table
 */
object LabelTypeTable {
  val db = play.api.db.slick.DB
  val labelTypes = TableQuery[LabelTypeTable]

  /**
    * Gets the label type id from the label type name
    *
    * @param labelType
    * @return
    */
  def labelTypeToId(labelType: String): Int = db.withTransaction { implicit session =>
    val typeId: Option[Int] = labelTypes.filter(_.labelType === labelType).map(_.labelTypeId).list.headOption
    typeId.getOrElse(LabelTypeTable.save(LabelType(0, labelType, "")))
  }

  /**
    * Gets the label type name from the label type id
    *
    * @param labelTypeId
    * @return
    */
  def labelTypeIdToLabelType(labelTypeId: Int): String = db.withTransaction { implicit session =>
    labelTypes.filter(_.labelTypeId === labelTypeId).map(_.labelType).list.head
  }

  /**
   * Saves a new label type in the table
   * @param lt
   * @return
   */
  def save(lt: LabelType): Int = db.withTransaction { implicit session =>
    val labelTypeId: Int =
      (labelTypes returning labelTypes.map(_.labelTypeId)) += lt
    labelTypeId
  }
}

