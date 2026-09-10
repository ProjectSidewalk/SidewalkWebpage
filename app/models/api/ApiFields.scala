/**
 * The one field list each record-shaped API endpoint declares, from which its JSON and its CSV are both built.
 */
package models.api

import models.api.ApiModelUtils.csvCell
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

  /**
   * The shape the dotted field names describe, resolved once: the nesting depends only on the names, which never
   * change, so a streaming endpoint shouldn't re-derive it for every record it writes.
   */
  private lazy val jsonShape: Seq[(String, ApiFields.Node[T])] = ApiFields.shapeOf(fields)

  /** @return The record as JSON, with dotted field names expanded back into nested objects. */
  final def toJson(record: T): JsObject = ApiFields.buildJson(jsonShape, record)

  /** @return One CSV line whose cells line up with [[csvHeader]]. */
  final def toCsvRow(record: T): String = csvFields.map(f => csvCell(f.value(record))).mkString(",")
}

object ApiFields {

  /** Declares a field, taking its JSON value from the record through the type's existing `Writes`. */
  def field[T, V](name: String)(get: T => V)(implicit writes: Writes[V]): ApiField[T] =
    ApiField(name, record => writes.writes(get(record)))

  /** One position in a field list's JSON shape: either a value to read, or an object with its own shape. */
  sealed private[api] trait Node[T]
  private[api] case class Leaf[T](read: T => JsValue)                 extends Node[T]
  private[api] case class Branch[T](children: Seq[(String, Node[T])]) extends Node[T]

  /**
   * Resolves dotted field names into the tree of objects they describe.
   *
   * @param fields The fields, in output order.
   * @return Each top-level key with its node, keys in the order their names first appear.
   * @throws IllegalArgumentException if a name is used twice, or is both a value and an object — either would drop
   *         a field from the JSON while the CSV still carried its column, the drift this whole design prevents.
   */
  private[api] def shapeOf[T](fields: Seq[ApiField[T]]): Seq[(String, Node[T])] = {
    val (leaves, nested) = fields.partition(!_.name.contains('.'))
    val leafNames        = leaves.map(_.name)
    val prefixes         = nested.map(_.name.takeWhile(_ != '.')).distinct

    require(leafNames.distinct.size == leafNames.size, s"duplicate field name in ${leafNames.diff(leafNames.distinct)}")
    require(
      leafNames.intersect(prefixes).isEmpty,
      s"field is both a value and an object: ${leafNames.intersect(prefixes)}"
    )

    val leafByName = leaves.map(f => f.name -> f.value).toMap
    val branches   = prefixes.map { prefix =>
      prefix -> Branch(shapeOf(nested.collect {
        case f if f.name.startsWith(s"$prefix.") => f.copy(name = f.name.drop(prefix.length + 1))
      }))
    }.toMap

    fields.map(_.name.takeWhile(_ != '.')).distinct.map { key =>
      key -> leafByName.get(key).map(Leaf(_)).getOrElse(branches(key))
    }
  }

  /**
   * @param shape  A resolved field-name shape.
   * @param record The record to read values from.
   * @return The record as a JSON object of that shape.
   */
  private[api] def buildJson[T](shape: Seq[(String, Node[T])], record: T): JsObject = JsObject(shape.map {
    case (key, Leaf(read))     => key -> read(record)
    case (key, Branch(nested)) => key -> buildJson(nested, record)
  })
}
