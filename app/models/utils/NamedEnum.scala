package models.utils

import models.utils.MyPostgresProfile.api.BaseColumnType
import org.postgresql.util.PGobject
import play.api.libs.json.{JsError, JsString, JsSuccess, Reads, Writes}
import slick.jdbc.SetParameter

import java.sql.Types
import scala.reflect.ClassTag

/** An enum whose values each have one fixed spelling in the database, in JSON, and in the API. */
trait NamedEnum {

  /** This value as the database and JSON spell it, which is often not how Scala spells the case. */
  def name: String

  /** The name, so that printing a value by accident (in SQL, a page, a log line) still gives what is stored. */
  override def toString: String = name
}

/** What every [[NamedEnum]]'s companion object shares: looking a value up by name, and its JSON format. */
trait NamedEnumCompanion[E <: NamedEnum] {

  /** The compiler writes this for an enum. */
  def values: Array[E]

  private lazy val byName: Map[String, E] = values.map(v => v.name -> v).toMap

  lazy val names: Seq[String] = values.toSeq.map(_.name)

  def withNameOption(name: String): Option[E] = byName.get(name)

  /** For a name known to be valid, such as one read from the database; throws on any other name. */
  def withName(name: String): E =
    byName.getOrElse(name, throw new NoSuchElementException(s"No value named '$name' among ${names.mkString(", ")}"))

  given writes: Writes[E] = Writes(v => JsString(v.name))

  given reads: Reads[E] = readsAmong(readable)

  /** The values JSON may name. An enum with values only the server may set narrows this. */
  protected def readable: Seq[E] = values.toSeq

  /**
   * A JSON reader that takes only some of the values, for input that must not name the rest.
   *
   * @param allowed The values the reader accepts.
   * @return A reader that rejects every other name, listing the allowed ones.
   */
  protected def readsAmong(allowed: Seq[E]): Reads[E] = {
    val allowedNames = allowed.map(_.name).mkString(", ")
    Reads {
      case JsString(name) =>
        withNameOption(name).filter(allowed.contains) match {
          case Some(value) => JsSuccess(value)
          case None        => JsError(s"Invalid value: $name. Valid values are: $allowedNames.")
        }
      case _ => JsError(s"Expected a string. Valid values are: $allowedNames.")
    }
  }
}

/** The companion of an enum stored as the Postgres enum type `pgType`, whose labels are the enum's names. */
trait PgEnumCompanion[E <: NamedEnum: ClassTag](val pgType: String) extends NamedEnumCompanion[E] {
  given columnType: BaseColumnType[E] =
    MyPostgresProfile.createEnumJdbcType[E](pgType, _.name, withName, quoteName = false)

  // Lets raw SQL take a value as-is (`$status`), already typed, so the query needs no `::pg_type` cast.
  given setParameter: SetParameter[E] = SetParameter { (value, params) =>
    val typed = new PGobject()
    typed.setType(pgType)
    typed.setValue(value.name)
    params.setObject(typed, Types.OTHER)
  }

  given setOptionParameter: SetParameter[Option[E]] = SetParameter {
    case (Some(value), params) => setParameter(value, params)
    case (None, params)        =>
      // Typed like a value is, or Postgres can't tell what `$x IS NULL` is asking about.
      params.pos += 1
      params.ps.setNull(params.pos, Types.OTHER, pgType)
  }
}
