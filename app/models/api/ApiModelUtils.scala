/**
 * Utility functions for API models.
 */
package models.api

import models.label.LabelTypeEnum
import play.api.libs.json.{JsBoolean, JsNull, JsNumber, JsObject, JsString, JsValue, Json}

object ApiModelUtils {

  /**
   * Sorts (label type name, _) pairs in canonical label type order, with "Overall" first, so API output order stays
   * consistent.
   */
  val labelTypeOrdering: Ordering[(String, Any)] = Ordering.by { case (labelType, _) =>
    (
      labelType != "Overall",
      LabelTypeEnum.orderedNames.indexOf(labelType) match {
        case -1 => Int.MaxValue
        case i  => i
      }
    )
  }

  /** The two columns of the CSVs [[toCsvKeyValueRows]] produces. */
  val keyValueCsvHeader: String = "metric,value"

  /**
   * Flattens a nested JSON object into the "key,value" lines used by the endpoints whose response is a single object.
   *
   * Deriving the rows from the JSON is what keeps the two formats naming every field identically (#3871, #4320).
   *
   * @param json The JSON object to flatten.
   * @return One "key,value" line per value, keyed by its dotted path (`labels.CurbRamp.count`), in JSON field order.
   */
  def toCsvKeyValueRows(json: JsObject): Seq[String] = {
    def flatten(path: String, value: JsValue): Seq[(String, JsValue)] = value match {
      case obj: JsObject => obj.fields.toSeq.flatMap { case (key, v) => flatten(s"$path.$key", v) }
      case leaf          => Seq(path -> leaf)
    }

    json.fields.toSeq
      .flatMap { case (key, value) => flatten(key, value) }
      .map { case (key, value) => s"${escapeCsvField(key)},${csvCell(value)}" }
  }

  /** @return The escaped cell text for one JSON value; empty for a null, compact JSON for an array or object. */
  def csvCell(value: JsValue): String = escapeCsvField(value match {
    case JsNull        => ""
    case JsString(str) => str
    // Plain notation, so a very large or very small number never lands in the CSV as scientific notation.
    case JsNumber(num)   => num.bigDecimal.toPlainString
    case JsBoolean(bool) => bool.toString
    case other           => Json.stringify(other)
  })

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
