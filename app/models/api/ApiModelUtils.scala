/**
 * Utility functions for API models.
 */
package models.api

import models.label.LabelTypeEnum
import play.api.libs.json.{JsObject, Json}

object ApiModelUtils {

  /**
   * Sorts (label type name, _) pairs by label_type_id, with "Overall" first, so API output order stays consistent.
   */
  val labelTypeOrdering: Ordering[(String, Any)] = Ordering.by { case (labelType, _) =>
    (labelType != "Overall", LabelTypeEnum.labelTypeToId.getOrElse(labelType, Int.MaxValue))
  }

  /**
   * Converts a human-readable or camelCase/PascalCase label into a snake_case CSV key (#3871), e.g. "KM Explored" or
   * "CurbRamp Count" into "km_explored" or "curb_ramp_count".
   */
  def toSnakeKey(label: String): String =
    label.trim
      .replaceAll("([a-z\\d])([A-Z])", "$1_$2") // split camelCase/PascalCase boundaries
      .replaceAll("\\s+", "_")                  // spaces to underscores
      .toLowerCase

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

  /**
   * Creates a GeoJSON Point geometry object.
   *
   * @param longitude The longitude of the point.
   * @param latitude The latitude of the point.
   * @return A JsObject representing the GeoJSON Point geometry.
   */
  def createGeoJsonPointGeometry(longitude: Double, latitude: Double): JsObject = {
    Json.obj(
      "type"        -> "Point",
      "coordinates" -> Json.arr(longitude, latitude)
    )
  }

  /**
   * Creates a GeoJSON Point feature with properties the given properties.
   *
   * @param longitude The longitude of the point.
   * @param latitude The latitude of the point.
   * @param properties The properties to include in the GeoJSON feature.
   * @return A JsObject representing the GeoJSON Point feature.
   */
  def createGeoJsonPoint(longitude: Double, latitude: Double, properties: JsObject): JsObject = {
    Json.obj(
      "type"       -> "Feature",
      "geometry"   -> createGeoJsonPointGeometry(longitude, latitude),
      "properties" -> properties
    )
  }
}
