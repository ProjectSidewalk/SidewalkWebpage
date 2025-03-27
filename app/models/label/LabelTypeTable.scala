package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class LabelType(labelTypeId: Int, labelType: String, description: String)

class LabelTypeTableDef(tag: slick.lifted.Tag) extends Table[LabelType](tag, "label_type") {
  def labelTypeId = column[Int]("label_type_id", O.PrimaryKey, O.AutoInc)
  def labelType = column[String]("label_type")
  def description = column[String]("description")

  def * = (labelTypeId, labelType, description) <> ((LabelType.apply _).tupled, LabelType.unapply)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object LabelTypeTable {
  val labelTypeToId: Map[String, Int] = Map("CurbRamp" -> 1, "NoCurbRamp" -> 2, "Obstacle" -> 3, "SurfaceProblem" -> 4, "Other" -> 5, "Occlusion" -> 6, "NoSidewalk" -> 7, "Problem" -> 8, "Crosswalk" -> 9, "Signal" -> 10)
  val labelTypeIdToLabelType: Map[Int, String] = labelTypeToId.map(_.swap)
  val validLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Other", "Occlusion", "NoSidewalk", "Crosswalk", "Signal")
  val primaryLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk", "Crosswalk", "Signal")
  val primaryLabelTypeIds: Set[Int] = primaryLabelTypes.map(labelTypeToId)
  val primaryValidationLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Crosswalk", "Signal")
  val primaryValidationLabelTypeIds: Set[Int] = primaryValidationLabelTypes.map(labelTypeToId)
}

@ImplementedBy(classOf[LabelTypeTable])
trait LabelTypeTableRepository {
}

@Singleton
class LabelTypeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends LabelTypeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
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
