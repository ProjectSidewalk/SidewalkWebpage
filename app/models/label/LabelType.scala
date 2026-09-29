package models.label

import play.api.libs.json.{JsError, JsString, JsSuccess, Json, Reads, Writes}

/**
 * What a label type says about accessibility: how we frame it in copy, not how its rating reads. Anything writing
 * copy about a label branches on this rather than on the label type itself; how to read a label's 1-3 rating is a
 * separate question, answered by [[RatingScale]].
 *
 * @param name The value published to clients (the API's `access_impact`, and our own JSON payloads)
 */
enum AccessImpact(val name: String) {

  /** The thing labeled is a barrier: finding one is bad news. */
  case Problem extends AccessImpact("problem")

  /** The thing labeled helps people get around: finding one is good news. */
  case Feature extends AccessImpact("feature")

  /** Says nothing either way — a meta note about the imagery or a catch-all. */
  case Neutral extends AccessImpact("neutral")
}

/**
 * Which 1-3 rating a label of this type carries, if any. Independent of [[AccessImpact]] in both directions — Other
 * is Neutral but rated, NoSidewalk is a Problem but unrated — so it can't be derived from it.
 *
 * @param name The value published to clients (the API's `rating_scale`, and our own JSON payloads)
 */
enum RatingScale(val name: String) {

  /** Rated good (1) to bad (3): how well the thing labeled does its job. */
  case Quality extends RatingScale("quality")

  /** Rated low (1) to high (3): how much the thing labeled gets in the way. */
  case Severity extends RatingScale("severity")

  /** Carries no rating, so asking for its severity is a question with no answer. */
  case Unrated extends RatingScale("unrated")
}

/**
 * Every label type with its properties, backing the `label_type` Postgres enum type.
 *
 * NOTE: if changing the cases, update the `label_type` Postgres enum type as well (see 373.sql). Each case's name is
 * the enum label, and it is emitted verbatim in every API response and internal JSON payload.
 *
 * The cases are declared in the one canonical order, by prominence: the six primary validate types, then NoSidewalk,
 * then the meta types. API output, CSV columns and error messages follow it, and LabelTypeDbSpec pins it to the
 * Postgres enum's declaration order, since reordering a deployed enum means rewriting `label`.
 *
 * @param descriptionKey Messages key for this type's human-readable description
 * @param color This type's hex color
 * @param accessImpact What this type says about accessibility; see [[AccessImpact]]
 * @param ratingScale Which 1-3 rating its labels carry, if any; see [[RatingScale]]
 */
enum LabelType(
    val descriptionKey: String,
    val color: String,
    val accessImpact: AccessImpact,
    val ratingScale: RatingScale
) {
  // TODO These colors should probably match the colors in our Design System Tokens in main.css.
  case CurbRamp   extends LabelType("curb.ramp.description", "#90C31F", AccessImpact.Feature, RatingScale.Quality)
  case NoCurbRamp extends LabelType("missing.ramp.description", "#E679B6", AccessImpact.Problem, RatingScale.Severity)
  case Obstacle   extends LabelType("obstacle.description", "#78B0EA", AccessImpact.Problem, RatingScale.Severity)
  case SurfaceProblem
      extends LabelType("surface.problem.description", "#F68D3E", AccessImpact.Problem, RatingScale.Severity)
  case Crosswalk  extends LabelType("crosswalk.description", "#FABF1C", AccessImpact.Feature, RatingScale.Quality)
  case Signal     extends LabelType("signal.description", "#63C0AB", AccessImpact.Feature, RatingScale.Unrated)
  case NoSidewalk extends LabelType("no.sidewalk.description", "#BE87D8", AccessImpact.Problem, RatingScale.Unrated)
  case Occlusion  extends LabelType("occlusion.description", "#B3B3B3", AccessImpact.Neutral, RatingScale.Unrated)
  case Other      extends LabelType("other.description", "#B3B3B3", AccessImpact.Neutral, RatingScale.Severity)

  /** This type's name as the database and the API spell it, e.g. "CurbRamp". */
  def name: String = toString

  // Messages key for the short name (e.g. "curb.ramp"), derived from descriptionKey so the two can't drift.
  val nameKey: String = descriptionKey.stripSuffix(".description")

  // Logical paths (under public/) to this type's icons. The scalable marker is what our own pages render; the
  // rasters are for consumers that can't take vector art — share-image compositing (ShareController) and the icon
  // URLs the public API publishes. Render each through whichever resolver the caller needs; see iconBasePath.
  def smallIconSvgPath: String = s"${LabelType.iconBasePath}/${name}_small.svg"
  def iconPath: String         = s"${LabelType.iconBasePath}/$name.png"
  def smallIconPath: String    = s"${LabelType.iconBasePath}/${name}_small.png"
  def tinyIconPath: String     = s"${LabelType.iconBasePath}/${name}_tiny.png"

  /** This type's icons as the plain, un-fingerprinted URLs the public API publishes. */
  def iconUrl: String      = LabelType.assetUrlPrefix + iconPath
  def smallIconUrl: String = LabelType.assetUrlPrefix + smallIconPath
  def tinyIconUrl: String  = LabelType.assetUrlPrefix + tinyIconPath
}

object LabelType {
  // Icon directory as a logical path under public/ — the one form assets.path (Twirl), util.assetPath (JS) and
  // environment.getFile (server-side compositing) all take. A rendered "/assets/..." URL would suit only one of the
  // three, leaving the others to rebuild the convention by hand.
  private inline val iconBasePath = "images/icons/label_type_icons"

  // The un-fingerprinted URL prefix for a logical path, for the icon URLs the public API publishes. Deliberately not
  // the fingerprinted one: a consumer that stores an icon_url wants it to survive our next deploy.
  private inline val assetUrlPrefix = "/assets/"

  // Every label type in canonical order. A Seq because `values` hands out a fresh array on every call.
  val ordered: Seq[LabelType]   = values.toSeq
  val orderedNames: Seq[String] = ordered.map(_.name)

  // Names of every label type, for allowlisting a caller-supplied label type.
  val labelTypeNames: Set[String] = orderedNames.toSet

  // Finds a label type by name when the name might not be one; `valueOf` is the version that throws.
  val byName: Map[String, LabelType] = ordered.map(lt => lt.name -> lt).toMap

  // Types whose labels carry a 1-3 rating. The denominator for any "% rated" stat, in SQL as well as on the page.
  val ratedTypeNames: Seq[String] = ordered.filter(_.ratingScale != RatingScale.Unrated).map(_.name)

  // Types whose labels never carry a severity; the *_unrated_no_severity_check constraints (395.sql) list these names.
  val unratedTypeNames: Seq[String] = ordered.filter(_.ratingScale == RatingScale.Unrated).map(_.name)

  val primaryLabelTypes: Set[LabelType] =
    Set(CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, NoSidewalk, Crosswalk, Signal)
  val primaryLabelTypeNames: Seq[String] = ordered.filter(primaryLabelTypes.contains).map(_.name)

  // Label types that can be judged from a single static image. Signal is excluded: labelers place it at the base of
  // the signal pole, so confirming a real pedestrian signal means panning up — impossible without a pano viewer.
  val staticValidatableLabelTypes: Set[LabelType] = primaryLabelTypes - Signal

  // Label types Validate serves in its primary missions. Every primary type qualifies since #5285 brought NoSidewalk
  // back as a per-block-face queue; the val stays so the API's `is_primary_validate` keeps its meaning.
  val primaryValidateLabelTypes: Set[LabelType] = primaryLabelTypes

  // The types the Sidewalk AI API can validate.
  val aiLabelTypes: Set[LabelType] = Set(CurbRamp, NoCurbRamp, Obstacle, SurfaceProblem, Crosswalk)

  given Writes[LabelType] = Writes(lt => JsString(lt.name))

  given Reads[LabelType] = Reads {
    case JsString(value) =>
      byName.get(value) match {
        case Some(labelType) => JsSuccess(labelType)
        case None => JsError(s"Invalid LabelType name: $value. Valid types are: ${orderedNames.mkString(", ")}.")
      }
    case _ => JsError(s"Expected a label type name. Valid types are: ${orderedNames.mkString(", ")}.")
  }

  /**
   * The label-type table as `main.scala.html` stamps it onto every page (`window.labelTypes`), in canonical order.
   *
   * This is the only copy the frontend gets: `utilitiesSidewalk.js` builds its lookups from it rather than keeping a
   * parallel set of literals. Everything here is fixed at build time — no city, no language, no DB — so it serializes
   * once at class-load and each render only interpolates the string. Localized names are absent by design; the
   * frontend already has those in its locale files, and including them would make this per-language.
   */
  val pageStampJson: String = Json.stringify(Json.toJson(ordered.map { lt =>
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
