/**
 * The one field list each record-shaped API endpoint declares, from which its JSON, CSV, and GeoPackage are all built.
 */
package models.api

import models.api.ApiModelUtils.csvCell
import play.api.libs.json.{JsNull, JsObject, JsString, JsValue, Json, Writes}

/**
 * One output field.
 *
 * @param name   Canonical snake_case name. A dotted name (`stats_by_label_type.CurbRamp.labels`) is a nested key in
 *               the JSON and a CSV column of exactly that name, so the field sits at the same address in both.
 * @param value  Reads the field off a record.
 * @param column The type of the field's GeoPackage column.
 */
case class ApiField[T](name: String, value: T => JsValue, column: GeoColumn) {

  /** Re-points this field at a larger record containing a `T`, so one field list can serve both. */
  def on[U](get: U => T): ApiField[U] = ApiField(name, record => value(get(record)), column)

  /** The field's GeoPackage column name: dots become underscores, since ArcGIS won't take a dot in a column name. */
  def geoPackageName: String = name.replace('.', '_')

  /** @return The field's value on `record`, as its GeoPackage column stores it. */
  def geoPackageValue(record: T): AnyRef = column.fromJson(value(record))
}

/**
 * A record type's fields, in output order: the single source for its JSON keys, CSV header, CSV cells, and GeoPackage
 * columns, so a field cannot be named one thing in one format and something else in another (#3871, #4320, #5273). A
 * GeoJSON endpoint puts [[toJson]] in the Feature's `properties` and passes the geometry separately.
 */
trait ApiFields[T] {

  /** The fields carried by the JSON, the CSV, and the GeoPackage. */
  def fields: Seq[ApiField[T]]

  /**
   * Fields only the CSV carries, for values the JSON expresses another way — a geometry it can only summarize. The
   * GeoPackage leaves them out too, since it stores the geometry itself.
   */
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

  /**
   * Declares a field, taking its JSON value from the record through the type's existing `Writes`, and its GeoPackage
   * column type from the value's Scala type.
   */
  def field[T, V](name: String)(get: T => V)(implicit writes: Writes[V], column: GeoColumnFor[V]): ApiField[T] =
    ApiField(name, record => writes.writes(get(record)), column.column)

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

/**
 * The type of a field's GeoPackage column, and how the field's JSON value is stored in it. Storing the JSON value,
 * rather than reading the record a second time, means a GeoPackage cell always holds what the JSON says.
 *
 * @param binding The Java class GeoTools builds the column from.
 */
sealed abstract class GeoColumn(val binding: Class[_ <: AnyRef]) {

  /** @return The value to store, or null where the JSON has null. */
  final def fromJson(json: JsValue): AnyRef = json match {
    case JsNull => null
    case other  => convert(other)
  }

  /** Converts a non-null JSON value to the column's type. */
  protected def convert(json: JsValue): AnyRef
}

object GeoColumn {

  case object Integer extends GeoColumn(classOf[java.lang.Integer]) {
    override protected def convert(json: JsValue): AnyRef = java.lang.Integer.valueOf(json.as[Int])
  }

  case object Real extends GeoColumn(classOf[java.lang.Double]) {
    override protected def convert(json: JsValue): AnyRef = java.lang.Double.valueOf(json.as[Double])
  }

  case object Boolean extends GeoColumn(classOf[java.lang.Boolean]) {
    override protected def convert(json: JsValue): AnyRef = java.lang.Boolean.valueOf(json.as[scala.Boolean])
  }

  /** A string as itself; anything else (an array, an object, a number too big for Integer) as its JSON text. */
  case object Text extends GeoColumn(classOf[String]) {
    override protected def convert(json: JsValue): AnyRef = json match {
      case JsString(s) => s
      case other       => Json.stringify(other)
    }
  }
}

/** Picks a field's GeoPackage column type from its Scala type, so no field declaration has to name one. */
final case class GeoColumnFor[V](column: GeoColumn)

object GeoColumnFor extends LowPriorityGeoColumns {
  implicit val int: GeoColumnFor[Int]         = GeoColumnFor(GeoColumn.Integer)
  implicit val double: GeoColumnFor[Double]   = GeoColumnFor(GeoColumn.Real)
  implicit val boolean: GeoColumnFor[Boolean] = GeoColumnFor(GeoColumn.Boolean)

  /** An optional value uses the column of the value inside it; None is stored as null. */
  implicit def option[V](implicit inner: GeoColumnFor[V]): GeoColumnFor[Option[V]] = GeoColumnFor(inner.column)
}

/** The fallback, kept a level below [[GeoColumnFor]]'s own instances so it only applies when none of them fits. */
trait LowPriorityGeoColumns {

  /**
   * Everything else is text: strings, dates, arrays and objects (as JSON), and Longs (OSM way ids), since GeoTools
   * maps a Long to SQL BIGINT, which isn't one of GeoPackage's column types.
   */
  implicit def text[V]: GeoColumnFor[V] = GeoColumnFor(GeoColumn.Text)
}
