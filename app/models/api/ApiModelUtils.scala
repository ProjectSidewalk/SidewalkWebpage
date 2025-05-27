/**
 * Utility functions for API models.
 */
package models.api

import play.api.libs.json.{JsObject, Json}

object ApiModelUtils {

  /**
   * Helper to safely quote CSV fields containing commas, quotes, or newlines.
   *
   * @param field The field to escape for CSV.
   * @return The escaped field suitable for CSV output.
   */
  def escapeCsvField(field: String): String = {
    val needsQuotes: Boolean = field.contains(",") || field.contains("\"") || field.contains("\n")
    val escapedField: String = field.replace("\"", "\"\"")
    if (needsQuotes) s""""$escapedField"""" else escapedField
  }

  def createGeoJsonPointGeometry(longitude: Double, latitude: Double): JsObject = {
    Json.obj(
      "type" -> "Point",
      "coordinates" -> Json.arr(longitude, latitude)
    )
  }

  def createGeoJsonPoint(longitude: Double, latitude: Double, properties: JsObject): JsObject = {
    Json.obj(
      "type" -> "Feature",
      "geometry" -> createGeoJsonPointGeometry(longitude, latitude),
      "properties" -> properties
    )
  }
}
