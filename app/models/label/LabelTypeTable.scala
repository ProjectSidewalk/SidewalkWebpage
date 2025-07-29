package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

/**
 * Enumeration of all label types with their associated properties.
 */
object LabelTypeEnum {
  // Base path for all icon images.
  private val iconBasePath = "/assets/images/icons/label_type_icons"

  /**
   * Base class for all label types in the system.
   *
   * This sealed abstract class represents the base type for all label types in the system, providing type safety and
   * centralized definition.
   *
   * @param id The unique numeric identifier for this label type
   * @param name The string representation of this label type
   * @param descriptionKey A key to get a human-readable description of this label type from the Messages API
   * @param color Hex color code associated with this label type
   */
  sealed abstract class Base(val id: Int, val name: String, val descriptionKey: String, val color: String) {
    override def toString: String = name

    // Paths to the icon images for this label type.
    val iconPath: String      = s"$iconBasePath/${name}.png"
    val smallIconPath: String = s"$iconBasePath/${name}_small.png"
    val tinyIconPath: String  = s"$iconBasePath/${name}_tiny.png"
  }

  // Representations for the full set of label types in the system.
  case object CurbRamp       extends Base(1, "CurbRamp", "curb.ramp.description", "#90C31F")
  case object NoCurbRamp     extends Base(2, "NoCurbRamp", "missing.ramp.description", "#E679B6")
  case object Obstacle       extends Base(3, "Obstacle", "obstacle.description", "#78B0EA")
  case object SurfaceProblem extends Base(4, "SurfaceProblem", "surface.problem.description", "#F68D3E")
  case object Other          extends Base(5, "Other", "other.description", "#B3B3B3")
  case object Occlusion      extends Base(6, "Occlusion", "occlusion.description", "#B3B3B3")
  case object NoSidewalk     extends Base(7, "NoSidewalk", "no.sidewalk.description", "#BE87D8")
  case object Problem        extends Base(8, "Problem", "problem.description", "#B3B3B3")
  case object Crosswalk      extends Base(9, "Crosswalk", "crosswalk.description", "#FABF1C")
  case object Signal         extends Base(10, "Signal", "signal.description", "#63C0AB")

  // Complete set of all label type enum values. Used as the source for generating other collections.
  lazy val values: Set[Base] = Set(
    CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, Other, Occlusion, NoSidewalk, Problem, Crosswalk, Signal
  )

  // Lookup map for finding a label type by its string name.
  lazy val byName: Map[String, Base] = values.map(lt => lt.name -> lt).toMap

  // Lookup map for finding a label type by its ID.
  lazy val byId: Map[Int, Base] = values.map(lt => lt.id -> lt).toMap

  // Mapping from label type name to its unique ID. Used for converting between string names and database IDs.
  lazy val labelTypeToId: Map[String, Int] = values.map(lt => lt.name -> lt.id).toMap

  // Mapping from label type ID to its string name. Used for converting between database IDs and string names.
  lazy val labelTypeIdToLabelType: Map[Int, String] = values.map(lt => lt.id -> lt.name).toMap

  // Maps label type names to their associated icon paths. Used for retrieving icon paths by label type name.
  lazy val labelTypeToIcons: Map[String, (String, String, String)] = values.map { lt =>
    lt.name -> (lt.iconPath, lt.smallIconPath, lt.tinyIconPath)
  }.toMap

  // Maps label type names to their associated colors. Used for retrieving colors by label type name.
  lazy val labelTypeToColor: Map[String, String] = values.map(lt => lt.name -> lt.color).toMap

  // Set of all valid label types that can be used in the application, excluding internal-only types like "Problem".
  lazy val validLabelTypes: Set[String] = values.map(_.name) - Problem.name
  lazy val validLabelTypeIds: Set[Int]  = validLabelTypes.map(labelTypeToId)

  // Set of primary label types used for main categorization.
  lazy val primaryLabelTypes: Set[String] = Set(
    CurbRamp.name, NoCurbRamp.name, Obstacle.name, SurfaceProblem.name, NoSidewalk.name, Crosswalk.name, Signal.name
  )
  lazy val primaryLabelTypeIds: Set[Int] = primaryLabelTypes.map(labelTypeToId)

  // Set of label types that require primary validation. NoSidewalk is only validated once all others have been.
  lazy val primaryValidateLabelTypes: Set[String] = primaryLabelTypes - NoSidewalk.name
  lazy val primaryValidateLabelTypeIds: Set[Int]  = primaryValidateLabelTypes.map(labelTypeToId)

  // Set of label types are accepted for validation using the Sidewalk AI API.
  lazy val aiLabelTypes: Set[String] = Set(
    CurbRamp.name, NoCurbRamp.name, Obstacle.name, SurfaceProblem.name, NoSidewalk.name, Crosswalk.name
  )
  lazy val aiLabelTypeIds: Set[Int] = aiLabelTypes.map(labelTypeToId)
}

/**
 * Represents a label type entity in the system.
 *
 * @param labelTypeId The unique identifier for this label type
 * @param labelType The string name of the label type
 */
case class LabelType(labelTypeId: Int, labelType: String)

/**
 * Database table definition for the label_type table. Maps between database columns and the LabelType case class.
 *
 * @param tag The Slick tag for table query building
 */
class LabelTypeTableDef(tag: slick.lifted.Tag) extends Table[LabelType](tag, "label_type") {
  def labelTypeId = column[Int]("label_type_id", O.PrimaryKey, O.AutoInc)
  def labelType   = column[String]("label_type")

  // Projection between the table and the case class.
  def * = (labelTypeId, labelType) <> ((LabelType.apply _).tupled, LabelType.unapply)
}

@ImplementedBy(classOf[LabelTypeTable])
trait LabelTypeTableRepository {}

@Singleton
class LabelTypeTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends LabelTypeTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  // Query builder for the label_type table.
  val labelTypes = TableQuery[LabelTypeTableDef]

  // Please use the companion object methods to access label types. The associated enum is a copy of the data in the db.
}
