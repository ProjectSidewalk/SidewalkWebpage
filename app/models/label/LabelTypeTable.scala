package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import models.api.LabelTypeDetails

/**
 * Represents a label type entity in the system.
 *
 * @param labelTypeId The unique identifier for this label type
 * @param labelType The string name of the label type
 * @param description A human-readable description of what this label type represents
 */
case class LabelType(labelTypeId: Int, labelType: String, description: String)

/**
 * Database table definition for the label_type table.
 * Maps between database columns and the LabelType case class.
 *
 * @param tag The Slick tag for table query building
 */
class LabelTypeTableDef(tag: slick.lifted.Tag) extends Table[LabelType](tag, "label_type") {
  /** Primary key column, auto-incremented */
  def labelTypeId = column[Int]("label_type_id", O.PrimaryKey, O.AutoInc)
  
  /** String identifier for the label type */
  def labelType = column[String]("label_type")
  
  /** Human-readable description of the label type */
  def description = column[String]("description")

  /** Projection between the table and the case class */
  def * = (labelTypeId, labelType, description) <> ((LabelType.apply _).tupled, LabelType.unapply)
}

/**
 * Companion object for LabelType that centralizes all label type definitions
 * and their relationships.
 *
 * This object provides a single source of truth for all label types and
 * derived collections used throughout the application.
 */
object LabelTypeTable {
 
  /**
   * Enumeration of all label types with their associated properties.
   */
  object LabelTypeEnum {
    /** Base path for all icon images */
    private val IconBasePath = "/assets/images/icons/label_type_icons"

    /**
     * Base class for all label types in the system.
     * 
     * This sealed abstract class represents the base type for all label types
     * in the system, providing type safety and centralized definition.
     *
     * @param id The unique numeric identifier for this label type
     * @param name The string representation of this label type
     * @param description Human-readable description of this label type
     * @param color Hex color code associated with this label type
     */
    sealed abstract class Base(
      val id: Int, 
      val name: String, 
      val description: String,
      val color: String
    ) {
      /** Returns the string name of this label type */
      override def toString: String = name

      /** Path to the icon image for this label type */
      val iconPath: String = s"$IconBasePath/${name}.png"
      
      /** Path to the small icon image for this label type */
      val smallIconPath: String = s"$IconBasePath/${name}_small.png"
      
      /** Path to the tiny/minimap icon image for this label type */
      val tinyIconPath: String = s"$IconBasePath/${name}_tiny.png"
    }

    /** Represents a curb ramp, which provides wheelchair access to sidewalks */
    case object CurbRamp extends Base(
      1, 
      "CurbRamp", 
      "Curb ramp connecting sidewalk to street", 
      "#90C31F"
    )
    
    /** Represents a missing curb ramp where one should exist */
    case object NoCurbRamp extends Base(
      2, 
      "NoCurbRamp", 
      "Missing curb ramp", 
      "#E679B6"
    )
    
    /** Represents an obstacle blocking the path */
    case object Obstacle extends Base(
      3, 
      "Obstacle", 
      "Obstacle in the path", 
      "#78B0EA"
    )
    
    /** Represents a problem with the surface of a sidewalk */
    case object SurfaceProblem extends Base(
      4, 
      "SurfaceProblem", 
      "Problem with sidewalk surface", 
      "#F68D3E"
    )
    
    /** Represents an issue that doesn't fit into other categories */
    case object Other extends Base(
      5, 
      "Other", 
      "Other accessibility issue", 
      "#B3B3B3"
    )
    
    /** Represents an area that is occluded or not visible */
    case object Occlusion extends Base(
      6, 
      "Occlusion", 
      "View obscured", 
      "#B3B3B3"
    )
    
    /** Represents a location where a sidewalk is missing */
    case object NoSidewalk extends Base(
      7, 
      "NoSidewalk", 
      "No sidewalk present", 
      "#BE87D8"
    )
    
    /** Represents a general problem */
    case object Problem extends Base(
      8, 
      "Problem", 
      "General problem", 
      "#B3B3B3"
    )
    
    /** Represents a crosswalk */
    case object Crosswalk extends Base(
      9, 
      "Crosswalk", 
      "Pedestrian crossing", 
      "#FABF1C"
    )
    
    /** Represents a traffic or pedestrian signal */
    case object Signal extends Base(
      10, 
      "Signal", 
      "Traffic or pedestrian signal", 
      "#63C0AB"
    )

    /**
     * Complete set of all label type enum values.
     * Used as the source for generating other collections.
     */
    val values: Set[Base] = Set(
      CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, Other, 
      Occlusion, NoSidewalk, Problem, Crosswalk, Signal
    )

    /**
     * Lookup map for finding a label type by its string name.
     * Provides O(1) access to label types by name.
     *
     * @example
     * {{{
     * val labelType = LabelTypeEnum.byName.get("CurbRamp") // Returns Some(CurbRamp)
     * }}}
     */
    val byName: Map[String, Base] = values.map(lt => lt.name -> lt).toMap
    
    /**
     * Lookup map for finding a label type by its ID.
     * Provides O(1) access to label types by ID.
     *
     * @example
     * {{{
     * val labelType = LabelTypeEnum.byId.get(1) // Returns Some(CurbRamp)
     * }}}
     */
    val byId: Map[Int, Base] = values.map(lt => lt.id -> lt).toMap

    /**
     * Mapping from label type name to its unique ID.
     * Used for converting between string names and database IDs.
     */
    val labelTypeToId: Map[String, Int] = values.map(lt => lt.name -> lt.id).toMap
    
    /**
     * Mapping from label type ID to its string name.
     * Used for converting between database IDs and string names.
     */
    val labelTypeIdToLabelType: Map[Int, String] = values.map(lt => lt.id -> lt.name).toMap
    
    /**
    * Maps label type names to their associated icon paths.
    * Used for retrieving icon paths by label type name.
    */
    val labelTypeToIcons: Map[String, (String, String, String)] = values.map { lt =>
      lt.name -> (lt.iconPath, lt.smallIconPath, lt.tinyIconPath)
    }.toMap

    /**
     * Maps label type names to their associated colors.
     * Used for retrieving colors by label type name.
     */
    val labelTypeToColor: Map[String, String] = values.map { lt =>
      lt.name -> lt.color
    }.toMap

    /**
     * Set of all valid label types that can be used in the application,
     * excluding internal-only types like "Problem".
     */
    val validLabelTypes: Set[String] = values.map(_.name) - Problem.name
    
    /**
     * Set of all valid label type IDs corresponding to validLabelTypes.
     */
    val validLabelTypeIds: Set[Int] = validLabelTypes.map(labelTypeToId)
    
    /**
     * Set of primary label types used for main categorization.
     * These are the core label types representing the main features
     * that can be identified in the system.
     */
    val primaryLabelTypes: Set[String] = Set(
      CurbRamp.name, NoCurbRamp.name, Obstacle.name, SurfaceProblem.name, 
      NoSidewalk.name, Crosswalk.name, Signal.name
    )
    
    /**
     * Set of primary label type IDs corresponding to primaryLabelTypes.
     */
    val primaryLabelTypeIds: Set[Int] = primaryLabelTypes.map(labelTypeToId)
    
    /**
     * Set of label types that require primary validation.
     * These are label types that undergo stricter validation rules.
     */
    val primaryValidateLabelTypes: Set[String] = primaryLabelTypes - NoSidewalk.name
    
    /**
     * Set of label type IDs that require primary validation.
     */
    val primaryValidateLabelTypeIds: Set[Int] = primaryValidateLabelTypes.map(labelTypeToId)
  }

 
  /** The following aliases are provided for convenience and backward compatibility */
  val labelTypeIdToLabelType = LabelTypeEnum.labelTypeIdToLabelType
  val labelTypeToId = LabelTypeEnum.labelTypeToId
  val validLabelTypes = LabelTypeEnum.validLabelTypes
  val validLabelTypeIds = LabelTypeEnum.validLabelTypeIds
  val primaryLabelTypes = LabelTypeEnum.primaryLabelTypes
  val primaryLabelTypeIds = LabelTypeEnum.primaryLabelTypeIds
  val primaryValidateLabelTypes = LabelTypeEnum.primaryValidateLabelTypes
  val primaryValidateLabelTypeIds = LabelTypeEnum.primaryValidateLabelTypeIds
  val labelTypeToIcons = LabelTypeEnum.labelTypeToIcons
  val labelTypeToColor = LabelTypeEnum.labelTypeToColor
}

@ImplementedBy(classOf[LabelTypeTable])
trait LabelTypeTableRepository {
  /**
   * Retrieves all label types from the database.
   *
   * @return A database action that returns a set of all label types
   */
  def getAllLabelTypes: DBIO[Set[LabelType]]
  
  /**
   * Gets all label types with their associated metadata for the API.
   *
   * @return A database action that returns a set of label types with metadata for API responses
   */
  def getLabelTypesForApi: DBIO[Set[LabelTypeDetails]]
}

@Singleton
class LabelTypeTable @Inject()(
  protected val dbConfigProvider: DatabaseConfigProvider
)(implicit ec: ExecutionContext)
  extends LabelTypeTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  
  import LabelTypeTable.LabelTypeEnum._
  
  /** Query builder for the label_type table */
  val labelTypes = TableQuery[LabelTypeTableDef]

  /**
   * Retrieves all label types from the database.
   *
   * @return A database action that returns a set of all label types when executed
   */
  override def getAllLabelTypes: DBIO[Set[LabelType]] = {
    labelTypes.result.map(_.toSet)
  }
  
  /**
   * Gets all label types and transforms them into LabelTypeDetails objects
   * for API responses, enriching them with icon paths and colors.
   *
   * @return A database action that returns a set of label type details
   */
  def getLabelTypesForApi: DBIO[Set[LabelTypeDetails]] = {
    labelTypes.result.map { types =>
      types.map { labelType =>
        val labelTypeEnum = byName.getOrElse(labelType.labelType, Other)
        
        LabelTypeDetails(
          id = labelType.labelTypeId,
          name = labelType.labelType,
          description = labelType.description,
          iconUrl = labelTypeEnum.iconPath,
          smallIconUrl = labelTypeEnum.smallIconPath,
          tinyIconUrl = labelTypeEnum.tinyIconPath,
          color = labelTypeEnum.color,
          isPrimary = LabelTypeTable.LabelTypeEnum.primaryLabelTypes.contains(labelType.labelType),
          isPrimaryValidate = LabelTypeTable.LabelTypeEnum.primaryValidateLabelTypes.contains(labelType.labelType)
        )
      }.toSet
    }
  }
}