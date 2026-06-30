/**
 * Models for the Project Sidewalk Label Tag API.
 */
package models.api

import play.api.libs.json.{Json, JsonConfiguration, JsonNaming, OFormat}

/**
 * Represents complete information about a label tag for API responses.
 *
 * @param id Unique identifier for the tag
 * @param labelType Associated label type (e.g., "CurbRamp", "SurfaceProblem")
 * @param tag Name of the tag (e.g., "narrow", "cracked")
 * @param mutuallyExclusiveWith List of tag names that cannot be used with this tag
 */
case class LabelTagForApi(
    id: Int,
    labelType: String,
    tag: String,
    description: String,
    mutuallyExclusiveWith: Seq[String]
)

/**
 * Companion object for LabelTagDetails containing JSON formatter
 */
object LabelTagForApi {
  // snake_case JSON output per the v3 API convention (#3871).
  implicit private val config: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)
  implicit val format: OFormat[LabelTagForApi]   = Json.format[LabelTagForApi]
}
