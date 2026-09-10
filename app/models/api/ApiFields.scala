/**
 * The one field list each record-shaped API endpoint declares, from which its JSON and its CSV are both built.
 */
package models.api

import models.api.ApiModelUtils.{csvCell, nestJson}
import play.api.libs.json.{JsObject, JsValue, Writes}

/**
 * One output field: its name, and how to read its value off a record.
 *
 * A dotted name (`stats_by_label_type.CurbRamp.labels`) is a CSV column of exactly that name and a nested key in the
 * JSON, so a field lives at the same address in both formats.
 *
 * @param name  The field's canonical snake_case name, dotted for a value the JSON nests.
 * @param value Reads the field off a record.
 */
case class ApiField[T](name: String, value: T => JsValue) {

  /** Re-points this field at a larger record containing a `T`, so one field list can serve both. */
  def on[U](get: U => T): ApiField[U] = ApiField(name, record => value(get(record)))
}

/**
 * A record type's fields, in output order.
 *
 * The list is the single source for the JSON keys, the CSV header, and the CSV cells, so a field cannot be named one
 * thing in one format and something else in the other (#3871, #4320); renaming it here renames it everywhere.
 * Endpoints that serve GeoJSON put this list in the Feature's `properties` and pass the geometry separately.
 */
trait ApiFields[T] {

  /** The fields carried by both formats. */
  def fields: Seq[ApiField[T]]

  /**
   * Fields only the CSV carries, appended after [[fields]] — for values the JSON already expresses another way, such
   * as a geometry the CSV can only summarize as endpoints.
   */
  def csvOnlyFields: Seq[ApiField[T]] = Seq.empty

  /** Override only where the CSV needs an order the JSON doesn't have. */
  def csvFields: Seq[ApiField[T]] = fields ++ csvOnlyFields

  /** The CSV header line, without a trailing newline. */
  final lazy val csvHeader: String = csvFields.map(_.name).mkString(",")

  /** @return The record as JSON, with dotted field names expanded back into nested objects. */
  final def toJson(record: T): JsObject = nestJson(fields.map(f => f.name -> f.value(record)))

  /** @return One CSV line whose cells line up with [[csvHeader]]. */
  final def toCsvRow(record: T): String = csvFields.map(f => csvCell(f.value(record))).mkString(",")
}

object ApiFields {

  /** Declares a field, taking its JSON value from the record through the type's existing `Writes`. */
  def field[T, V](name: String)(get: T => V)(implicit writes: Writes[V]): ApiField[T] =
    ApiField(name, record => writes.writes(get(record)))
}
