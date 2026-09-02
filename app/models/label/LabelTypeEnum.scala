package models.label

/**
 * Enumeration of all label types with their associated properties, backing the `label_type` Postgres enum type.
 *
 * NOTE: if changing these values, update the `label_type` Postgres enum type as well (see 373.sql). The `name` of
 * each type is the enum label, and it is emitted verbatim in every API response and internal JSON payload.
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
   * @param name The string representation of this label type, matching the Postgres enum label
   * @param descriptionKey A key to get a human-readable description of this label type from the Messages API
   * @param color Hex color code associated with this label type
   * @param isAccessProblem Whether this label type marks an accessibility problem (severity means "how bad"), as opposed
   *                      to a positive access feature like a curb ramp or a neutral meta type like an occlusion. Copy
   *                      and severity interpretation flip direction on this, so it must come from here, not be
   *                      re-derived in feature code.
   */
  sealed abstract class Base(
      val name: String,
      val descriptionKey: String,
      val color: String,
      val isAccessProblem: Boolean
  ) {
    override def toString: String = name

    // Messages key for this label type's short human-readable name (e.g. "curb.ramp"), derived from descriptionKey so
    // the two can't drift.
    val nameKey: String = descriptionKey.stripSuffix(".description")

    // Paths to the icon images for this label type. The scalable marker is what our own pages render; the rasters are
    // for consumers that can't take vector art — share-image compositing (ShareController) and the icon URLs the
    // public API publishes.
    val smallIconSvgPath: String = s"$iconBasePath/${name}_small.svg"
    val iconPath: String         = s"$iconBasePath/${name}.png"
    val smallIconPath: String    = s"$iconBasePath/${name}_small.png"
    val tinyIconPath: String     = s"$iconBasePath/${name}_tiny.png"
  }

  // Representations for the full set of label types in the system.
  // TODO These colors should probably match the colors in our Design System Tokens in main.css.
  case object CurbRamp   extends Base("CurbRamp", "curb.ramp.description", "#90C31F", isAccessProblem = false)
  case object NoCurbRamp extends Base("NoCurbRamp", "missing.ramp.description", "#E679B6", isAccessProblem = true)
  case object Obstacle   extends Base("Obstacle", "obstacle.description", "#78B0EA", isAccessProblem = true)
  case object SurfaceProblem
      extends Base("SurfaceProblem", "surface.problem.description", "#F68D3E", isAccessProblem = true)
  case object Crosswalk  extends Base("Crosswalk", "crosswalk.description", "#FABF1C", isAccessProblem = false)
  case object Signal     extends Base("Signal", "signal.description", "#63C0AB", isAccessProblem = false)
  case object NoSidewalk extends Base("NoSidewalk", "no.sidewalk.description", "#BE87D8", isAccessProblem = true)
  case object Occlusion  extends Base("Occlusion", "occlusion.description", "#B3B3B3", isAccessProblem = false)
  case object Other      extends Base("Other", "other.description", "#B3B3B3", isAccessProblem = false)

  // The one canonical order, by prominence: the six primary validate types, then NoSidewalk, then the meta types.
  // API output, CSV columns and error messages sort by position here, never by the Postgres enum's declaration order
  // (pinned to this list by LabelTypeEnumDbSpec), since reordering a deployed enum means rewriting `label`.
  lazy val ordered: Seq[Base] =
    Seq(CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, Crosswalk, Signal, NoSidewalk, Occlusion, Other)
  lazy val orderedNames: Seq[String] = ordered.map(_.name)

  // Complete set of all label type enum values. Used as the source for generating other collections.
  lazy val values: Set[Base] = ordered.toSet

  // Lookup map for finding a label type by its string name.
  lazy val byName: Map[String, Base] = values.map(lt => lt.name -> lt).toMap

  // Maps label type names to their associated colors. Used for retrieving colors by label type name.
  lazy val labelTypeToColor: Map[String, String] = values.map(lt => lt.name -> lt.color).toMap

  // Names of every label type, for allowlisting a caller-supplied label type.
  lazy val labelTypeNames: Set[String] = values.map(_.name)

  // Set of primary label types used for main categorization.
  lazy val primaryLabelTypes: Set[Base] =
    Set(CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, NoSidewalk, Crosswalk, Signal)
  lazy val primaryLabelTypeNames: Set[String] = primaryLabelTypes.map(_.name)

  // Label types that can be judged from a single static image. Signal is excluded: labelers place it at the base of
  // the signal pole, so confirming a real pedestrian signal means panning up — impossible without a pano viewer.
  lazy val staticValidatableLabelTypes: Set[Base] = primaryLabelTypes - Signal

  // Set of label types that require primary validation. NoSidewalk is only validated once all others have been.
  lazy val primaryValidateLabelTypes: Set[Base] = primaryLabelTypes - NoSidewalk

  // Set of label types are accepted for validation using the Sidewalk AI API.
  lazy val aiLabelTypes: Set[Base] = Set(CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, Crosswalk)

  /** Parses a label type name, throwing on an unknown one (the shape the Slick enum mapper wants). */
  def withName(name: String): Base =
    byName.getOrElse(name, throw new NoSuchElementException(s"No label type named '$name'"))
}
