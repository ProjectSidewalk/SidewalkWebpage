package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}

case class LabelType(labelTypeId: Int, labelType: String, description: String)

class LabelTypeTableDef(tag: slick.lifted.Tag) extends Table[LabelType](tag, "label_type") {
  def labelTypeId = column[Int]("label_type_id", O.PrimaryKey, O.AutoInc)
  def labelType = column[String]("label_type")
  def description = column[String]("description")

  def * = (labelTypeId, labelType, description) <> ((LabelType.apply _).tupled, LabelType.unapply)
}

@ImplementedBy(classOf[LabelTypeTable])
trait LabelTypeTableRepository {
}

@Singleton
class LabelTypeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends LabelTypeTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val labelTypes = TableQuery[LabelTypeTableDef]

  // Set of valid/primary label types.
  def validLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Other", "Occlusion", "NoSidewalk", "Crosswalk", "Signal")
  def primaryLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk")

//  def getAllLabelTypes: Set[LabelType] = {
//    labelTypes.list.toSet
//  }
//
//  /**
//   * Set of valid label type ids for the above valid label types.
//   */
//  def validLabelTypeIds: Set[Int] = {
//    labelTypes.filter(_.labelType inSet validLabelTypes).map(_.labelTypeId).list.toSet
//  }
//
//  /**
//   * Set of primary label type ids for the above valid label types.
//   */
//  def primaryLabelTypeIds: Set[Int] = {
//    labelTypes.filter(_.labelType inSet primaryLabelTypes).map(_.labelTypeId).list.toSet
//  }
//
//  /**
//    * Gets the label type id from the label type name.
//    */
//  def labelTypeToId(labelType: String): Option[Int] = {
//    labelTypes.filter(_.labelType === labelType).map(_.labelTypeId).firstOption
//  }
//
//  /**
//    * Gets the label type name from the label type id.
//    */
//  def labelTypeIdToLabelType(labelTypeId: Int): Option[String] = {
//    labelTypes.filter(_.labelTypeId === labelTypeId).map(_.labelType).firstOption
//  }
}
