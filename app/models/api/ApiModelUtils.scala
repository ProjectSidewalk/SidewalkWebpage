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

  /**
   * Flattens a nested JSON object into the "key,value" lines used by the endpoints whose response is a single object.
   *
   * Deriving the rows from the JSON is what keeps the two formats naming every field identically (#3871, #4320). Path
   * pieces are copied exactly as the JSON spells them, since a second spelling of a name is a second name to keep in
   * sync. Missing values become empty cells, as in every v3 CSV.
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
   * Rebuilds the nested JSON an [[ApiFields]] field list describes, splitting each dotted name back into its path.
   *
   * @param fields Name/value pairs whose names may be dotted paths, in output order.
   * @return The nested object, sibling keys in the order their paths first appear.
   */
  def nestJson(fields: Seq[(String, JsValue)]): JsObject = {
    val (leaves, nested) = fields.partition(!_._1.contains('.'))
    val leafByName       = leaves.toMap
    // groupBy loses order, so walk the original list to decide which prefix each key belongs to and where it sits.
    val prefixOrder = nested.map(_._1.takeWhile(_ != '.')).distinct
    val subtrees    = prefixOrder.map { prefix =>
      prefix -> nestJson(nested.collect {
        case (name, value) if name.startsWith(s"$prefix.") => name.drop(prefix.length + 1) -> value
      })
    }.toMap

    JsObject(
      fields.map(f => f._1.takeWhile(_ != '.')).distinct.map { key => key -> leafByName.getOrElse(key, subtrees(key)) }
    )
  }

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
