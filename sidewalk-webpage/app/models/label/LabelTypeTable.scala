package models.label

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.Logger

case class LabelType(labelTypeId: Int, labelType: String, description: String)

/**
 *
 */
class LabelTypeTable(tag: Tag) extends Table[LabelType](tag, Some("sidewalk"), "label_type") {
  def labelTypeId = column[Int]("label_type_id", O.PrimaryKey, O.AutoInc)
  def labelType = column[String]("label_type", O.NotNull)
  def description = column[String]("description")

  def * = (labelTypeId, labelType, description) <> ((LabelType.apply _).tupled, LabelType.unapply)
}

/**
 * Data access object for the label table
 */
object LabelTypeTable {
  val db = play.api.db.slick.DB
  val labelTypes = TableQuery[LabelTypeTable]

  /**
   * Return the label id
   * @param labelType
   * @return
   */
  def labelTypeToId(labelType: String): Int = db.withTransaction { implicit session =>
    try {
      labelTypes.filter(_.labelType === labelType).map(_.labelTypeId).list.head
    } catch {
      case e: java.util.NoSuchElementException => {
        LabelTypeTable.save(LabelType(0, labelType, ""))
      }
    }
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

