package models.user

import models.utils.{NamedEnum, PgEnumCompanion}

/**
 * The two systems the site shows distances in. A user's saved choice is stored as the `measurement_system` enum in
 * `user_settings`, whose labels match these values.
 */
enum MeasurementSystem(val name: String) extends NamedEnum {
  case Metric   extends MeasurementSystem("metric")
  case Imperial extends MeasurementSystem("imperial")
}

object MeasurementSystem extends PgEnumCompanion[MeasurementSystem]("measurement_system") {

  /** What the Settings page's units select submits for "follow the site language", which is saved as no choice. */
  val FollowLanguage: String = "auto"

  /** A saved choice as the Settings select (and the ChangeUnits log event) names it: "auto" when there is none. */
  def choiceName(saved: Option[MeasurementSystem]): String = saved.map(_.name).getOrElse(FollowLanguage)
}
