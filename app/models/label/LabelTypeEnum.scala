package models.label

import play.api.libs.json.Json

/**
 * Enumeration of all label types with their associated properties, backing the `label_type` Postgres enum type.
 *
 * NOTE: if changing these values, update the `label_type` Postgres enum type as well (see 373.sql). The `name` of
 * each type is the enum label, and it is emitted verbatim in every API response and internal JSON payload.
 */
object LabelTypeEnum {
  // Icon directory as a logical path under public/ — the one form assets.path (Twirl), util.assetPath (JS) and
  // environment.getFile (server-side compositing) all take. A rendered "/assets/..." URL would suit only one of the
  // three, leaving the others to rebuild the convention by hand.
  private val iconBasePath = "images/icons/label_type_icons"

  // The un-fingerprinted URL prefix for a logical path, for the icon URLs the public API publishes. Deliberately not
  // the fingerprinted one: a consumer that stores an icon_url wants it to survive our next deploy.
  private val assetUrlPrefix = "/assets/"

  /**
   * What a label type says about accessibility. Anything that interprets a label's severity, or writes copy about it,
   * has to branch on this rather than on the label type itself.
   *
   * @param name The value published to clients (the API's `access_impact`, and our own JSON payloads)
   */
  sealed abstract class AccessImpact(val name: String) {
    override def toString: String = name
  }

  object AccessImpact {

    /** The thing labeled is a barrier; severity says how bad it is. */
    case object Problem extends AccessImpact("problem")

    /** The thing labeled helps people get around; severity says how good it is. */
    case object Feature extends AccessImpact("feature")

    /** Not a statement about accessibility at all, so severity says nothing about quality. */
    case object Neutral extends AccessImpact("neutral")
  }

  /**
   * Which 1-3 rating a label of this type carries, if any. Independent of [[AccessImpact]] in both directions — Other
   * is Neutral but rated, NoSidewalk is a Problem but unrated — so it can't be derived from it.
   *
   * @param name The value published to clients (the API's `rating_scale`, and our own JSON payloads)
   */
  sealed abstract class RatingScale(val name: String) {
    override def toString: String = name
  }

  object RatingScale {

    /** Rated good (1) to bad (3): how well the thing labeled does its job. */
    case object Quality extends RatingScale("quality")

    /** Rated low (1) to high (3): how much the thing labeled gets in the way. */
    case object Severity extends RatingScale("severity")

    /** Carries no rating, so asking for its severity is a question with no answer. */
    case object Unrated extends RatingScale("unrated")
  }

  /**
   * Base class for all label types in the system.
   *
   * This sealed abstract class represents the base type for all label types in the system, providing type safety and
   * centralized definition.
   *
   * @param name The string representation of this label type, matching the Postgres enum label
   * @param descriptionKey A key to get a human-readable description of this label type from the Messages API
   * @param color Hex color code associated with this label type
   * @param accessImpact What this type says about accessibility; see [[AccessImpact]]
   * @param ratingScale Which 1-3 rating its labels carry, if any; see [[RatingScale]]
   */
  sealed abstract class Base(
      val name: String,
      val descriptionKey: String,
      val color: String,
      val accessImpact: AccessImpact,
      val ratingScale: RatingScale
  ) {
    override def toString: String = name

    // Messages key for this label type's short human-readable name (e.g. "curb.ramp"), derived from descriptionKey so
    // the two can't drift.
    val nameKey: String = descriptionKey.stripSuffix(".description")

    // Logical paths (under public/) to this type's icons. The scalable marker is what our own pages render; the
    // rasters are for consumers that can't take vector art — share-image compositing (ShareController) and the icon
    // URLs the public API publishes. Render each through whichever resolver the caller needs; see iconBasePath.
    val smallIconSvgPath: String = s"$iconBasePath/${name}_small.svg"
    val iconPath: String         = s"$iconBasePath/${name}.png"
    val smallIconPath: String    = s"$iconBasePath/${name}_small.png"
    val tinyIconPath: String     = s"$iconBasePath/${name}_tiny.png"

    /** This type's icons as the plain, un-fingerprinted URLs the public API publishes. */
    def iconUrl: String      = assetUrlPrefix + iconPath
    def smallIconUrl: String = assetUrlPrefix + smallIconPath
    def tinyIconUrl: String  = assetUrlPrefix + tinyIconPath
  }

  // Representations for the full set of label types in the system.
  // TODO These colors should probably match the colors in our Design System Tokens in main.css.
  case object CurbRamp
      extends Base("CurbRamp", "curb.ramp.description", "#90C31F", AccessImpact.Feature, RatingScale.Quality)
  case object NoCurbRamp
      extends Base("NoCurbRamp", "missing.ramp.description", "#E679B6", AccessImpact.Problem, RatingScale.Severity)
  case object Obstacle
      extends Base("Obstacle", "obstacle.description", "#78B0EA", AccessImpact.Problem, RatingScale.Severity)
  case object SurfaceProblem
      extends Base(
        "SurfaceProblem", "surface.problem.description", "#F68D3E", AccessImpact.Problem, RatingScale.Severity
      )
  case object Crosswalk
      extends Base("Crosswalk", "crosswalk.description", "#FABF1C", AccessImpact.Feature, RatingScale.Quality)
  case object Signal extends Base("Signal", "signal.description", "#63C0AB", AccessImpact.Feature, RatingScale.Unrated)
  case object NoSidewalk
      extends Base("NoSidewalk", "no.sidewalk.description", "#BE87D8", AccessImpact.Problem, RatingScale.Unrated)
  case object Occlusion
      extends Base("Occlusion", "occlusion.description", "#B3B3B3", AccessImpact.Neutral, RatingScale.Unrated)
  case object Other extends Base("Other", "other.description", "#B3B3B3", AccessImpact.Neutral, RatingScale.Severity)

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

  lazy val byAccessImpact: Map[AccessImpact, Set[Base]] = values.groupBy(_.accessImpact)

  // Types whose labels carry a 1-3 rating. The denominator for any "% rated" stat, in SQL as well as on the page.
  lazy val ratedTypes: Seq[Base]                      = ordered.filter(_.ratingScale != RatingScale.Unrated)
  lazy val ratedTypeNames: Seq[String]                = ratedTypes.map(_.name)
  lazy val byRatingScale: Map[RatingScale, Set[Base]] = values.groupBy(_.ratingScale)

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

  /**
   * The label-type table as `main.scala.html` stamps it onto every page (`window.labelTypes`), in canonical order.
   *
   * This is the only copy the frontend gets: `utilitiesSidewalk.js` builds its lookups from it rather than keeping a
   * parallel set of literals. Everything here is fixed at build time — no city, no language, no DB — so it serializes
   * once at class-load and each render only interpolates the string. Localized names are absent by design; the
   * frontend already has those in its locale files, and including them would make this per-language.
   */
  lazy val pageStampJson: String = Json.stringify(Json.toJson(ordered.map { lt =>
    Json.obj(
      "name"              -> lt.name,
      "color"             -> lt.color,
      "accessImpact"      -> lt.accessImpact.name,
      "ratingScale"       -> lt.ratingScale.name,
      "isPrimary"         -> primaryLabelTypes.contains(lt),
      "isPrimaryValidate" -> primaryValidateLabelTypes.contains(lt)
    )
  }))
}
