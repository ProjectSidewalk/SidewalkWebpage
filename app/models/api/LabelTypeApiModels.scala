/**
 * Models for the Project Sidewalk Label Types API.
 */
package models.api

import play.api.libs.json.{Json, JsonConfiguration, JsonNaming, OFormat}

/**
 * Represents complete information about a label type for API responses.
 *
 * @param name Machine name of the label type (e.g., "CurbRamp")
 * @param displayName Localized short human-readable name (e.g., "Curb Ramp")
 * @param description Localized human-readable description
 * @param iconUrl URL to the standard icon image
 * @param smallIconUrl URL to the small icon image
 * @param tinyIconUrl URL to the tiny icon image
 * @param color Hex color code associated with this label type
 * @param accessImpact What this type says about accessibility: "problem", "feature", or "neutral". Severity means the
 *                     opposite thing on a problem than on a feature, so read this rather than hardcode type names.
 * @param ratingScale Which 1-3 rating this type's labels carry: "quality" (1 good, 3 bad), "severity" (1 low, 3 high),
 *                    or "unrated" for a type whose labels never carry one
 * @param isPrimary Whether this is a primary label type
 * @param isPrimaryValidate Whether this type is included in primary validation
 */
case class LabelTypeForApi(
    name: String,
    displayName: String,
    description: String,
    iconUrl: String,
    smallIconUrl: String,
    tinyIconUrl: String,
    color: String,
    accessImpact: String,
    ratingScale: String,
    isPrimary: Boolean,
    isPrimaryValidate: Boolean
)

/**
 * Companion object for LabelTypeDetails containing JSON formatter.
 */
object LabelTypeForApi {
  // snake_case JSON output per the v3 API convention (#3871).
  implicit private val config: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)
  implicit val format: OFormat[LabelTypeForApi]  = Json.format[LabelTypeForApi]
}
