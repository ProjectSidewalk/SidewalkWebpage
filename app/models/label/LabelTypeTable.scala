package models.label

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

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
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val labelTypes = TableQuery[LabelTypeTable]

  /**
    * Gets the label type id from the label type name
    *
    * @param labelType
    * @return
    */
  def labelTypeToId(labelType: String): Future[Int] = db.run {
    labelTypes.filter(_.labelType === labelType).map(_.labelTypeId).result.head
  }

  /**
    * Gets the label type name from the label type id
    *
    * @param labelTypeId
    * @return
    */
  def labelTypeIdToLabelType(labelTypeId: Int): Future[String] = db.run {
    labelTypes.filter(_.labelTypeId === labelTypeId).map(_.labelType).result.head
  }

  /**
   * Saves a new label type in the table
   * @param lt
   * @return
   */
  def save(lt: LabelType): Future[Int] = db.run {
    (labelTypes returning labelTypes.map(_.labelTypeId)) += lt
  }
}

