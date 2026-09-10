/**
 * The one field list each record-shaped API endpoint declares, from which its JSON and its CSV are both built.
 */
package models.api

import models.api.ApiModelUtils.csvCell
import play.api.libs.json.{JsObject, JsValue, Writes}

/**
 * One output field.
 *
 * @param name  Canonical snake_case name. A dotted name (`stats_by_label_type.CurbRamp.labels`) is a nested key in
 *              the JSON and a CSV column of exactly that name, so the field sits at the same address in both.
 * @param value Reads the field off a record.
 */
case class ApiField[T](name: String, value: T => JsValue) {

  /** Re-points this field at a larger record containing a `T`, so one field list can serve both. */
  def on[U](get: U => T): ApiField[U] = ApiField(name, record => value(get(record)))
}

/**
 * A record type's fields, in output order: the single source for its JSON keys, CSV header, and CSV cells, so a
 * field cannot be named one thing in one format and something else in the other (#3871, #4320). A GeoJSON endpoint
 * puts [[toJson]] in the Feature's `properties` and passes the geometry separately.
 */
trait ApiFields[T] {

  /** The fields carried by both formats. */
  def fields: Seq[ApiField[T]]

  /** Fields only the CSV carries, for values the JSON expresses another way — a geometry it can only summarize. */
  def csvOnlyFields: Seq[ApiField[T]] = Seq.empty

  /** Override only where the CSV needs an order the JSON doesn't have. */
  def csvFields: Seq[ApiField[T]] = fields ++ csvOnlyFields

  /** The CSV header line, without a trailing newline. */
  final lazy val csvHeader: String = csvFields.map(_.name).mkString(",")

  // Resolved once: the nesting depends only on the names, so a streaming endpoint needn't redo it per record.
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

  /** A position in a field list's JSON shape: a value to read, or an object with its own shape. */
  sealed private[api] trait Node[T]
  private[api] case class Leaf[T](read: T => JsValue)                 extends Node[T]
  private[api] case class Branch[T](children: Seq[(String, Node[T])]) extends Node[T]

  /**
   * Resolves dotted field names into the tree of objects they describe.
   *
   * @param fields The fields, in output order.
   * @return Each top-level key with its node, keys in the order their names first appear.
   * @throws IllegalArgumentException if a name is used twice, or is both a value and an object — either would drop a
   *         field from the JSON while the CSV kept its column.
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

  /** @return `record` as a JSON object of the given shape. */
  private[api] def buildJson[T](shape: Seq[(String, Node[T])], record: T): JsObject = JsObject(shape.map {
    case (key, Leaf(read))     => key -> read(record)
    case (key, Branch(nested)) => key -> buildJson(nested, record)
  })
}
