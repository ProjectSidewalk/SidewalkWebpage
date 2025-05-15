/**
 * Models for the Project Sidewalk Label Types API.
 * 
 */
package models.api

import play.api.libs.json.{Json, OFormat}

/**
 * Represents complete information about a label type for API responses.
 *
 * @param id Unique identifier for the label type
 * @param name Name of the label type (e.g., "CurbRamp")
 * @param description Human-readable description
 * @param iconUrl URL to the standard icon image
 * @param smallIconUrl URL to the small icon image
 * @param tinyIconUrl URL to the tiny icon image
 * @param color Hex color code associated with this label type
 * @param isPrimary Whether this is a primary label type
 * @param isPrimaryValidate Whether this type is included in primary validation
 */
case class LabelTypeForApi(
  id: Int,
  name: String,
  description: String,
  iconUrl: String,
  smallIconUrl: String,
  tinyIconUrl: String,
  color: String,
  isPrimary: Boolean,
  isPrimaryValidate: Boolean
)

/**
 * Companion object for LabelTypeDetails containing JSON formatter
 */
object LabelTypeForApi {
  implicit val format: OFormat[LabelTypeForApi] = Json.format[LabelTypeForApi]
}