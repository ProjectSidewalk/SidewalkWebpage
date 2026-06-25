package models.validation

/**
 * Enumeration of the possible results of a validation, backing the `validation_option` Postgres enum type.
 *
 * NOTE: if changing these values, update the `validation_option` Postgres enum type as well (see 322.sql). The string
 * values are emitted directly in API responses and consumed by the frontend.
 */
object ValidationOption extends Enumeration {
  type ValidationOption = Value
  val Agree: Value    = Value("Agree")
  val Disagree: Value = Value("Disagree")
  val Unsure: Value   = Value("Unsure")

  /** Parses a string into a validation option, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
