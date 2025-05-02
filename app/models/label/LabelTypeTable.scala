package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

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
  val validLabelTypeIds: Set[Int] = validLabelTypes.map(labelTypeToId)
  val primaryLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "NoSidewalk", "Crosswalk", "Signal")
  val primaryLabelTypeIds: Set[Int] = primaryLabelTypes.map(labelTypeToId)
  val primaryValidateLabelTypes: Set[String] = Set("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Crosswalk", "Signal")
  val primaryValidateLabelTypeIds: Set[Int] = primaryValidateLabelTypes.map(labelTypeToId)
}

@ImplementedBy(classOf[LabelTypeTable])
trait LabelTypeTableRepository { }

@Singleton
class LabelTypeTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends LabelTypeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val labelTypes = TableQuery[LabelTypeTableDef]

  def getAllLabelTypes: DBIO[Set[LabelType]] = {
    labelTypes.result.map(_.toSet)
  }
}
