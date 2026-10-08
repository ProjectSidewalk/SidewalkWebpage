package models.validation

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * Enumeration of the possible results of a validation, backing the `validation_option` Postgres enum type.
 *
 * NOTE: if changing these values, update the `validation_option` Postgres enum type as well (see 322.sql). The string
 * values are emitted directly in API responses and consumed by the frontend.
 */
enum ValidationOption(val name: String) extends NamedEnum {
  case Agree    extends ValidationOption("Agree")
  case Disagree extends ValidationOption("Disagree")
  case Unsure   extends ValidationOption("Unsure")
}

object ValidationOption extends PgEnumCompanion[ValidationOption]("validation_option")
