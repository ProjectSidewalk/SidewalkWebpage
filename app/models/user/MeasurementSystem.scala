package models.user

/**
 * The two systems the site shows distances in. A user's saved choice is stored as the `measurement_system` enum in
 * `user_settings`, whose labels match these values.
 */
object MeasurementSystem extends Enumeration {
  val Metric: Value   = Value("metric")
  val Imperial: Value = Value("imperial")

  /** What the Settings page's units select submits for "follow the site language", which is saved as no choice. */
  val FollowLanguage: String = "auto"

  /** Parses a name like "metric". None for anything else, since form posts come from the visitor. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)

  /** A saved choice as the Settings select (and the ChangeUnits log event) names it: "auto" when there is none. */
  def choiceName(saved: Option[Value]): String = saved.map(_.toString).getOrElse(FollowLanguage)
}
