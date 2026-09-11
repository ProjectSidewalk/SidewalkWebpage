package models.user

/**
 * The two systems the site shows distances in. A user's saved choice is stored as the `measurement_system` enum in
 * `user_settings`, whose labels match these values.
 */
object MeasurementSystem extends Enumeration {
  val Metric: Value   = Value("metric")
  val Imperial: Value = Value("imperial")

  /** Parses a name like "metric". None for anything else, since cookies and form posts come from the visitor. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
