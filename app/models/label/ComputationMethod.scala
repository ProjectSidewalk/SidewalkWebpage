package models.label

/**
 * Enumeration of the ways a label's lat/lng can be computed, backing the `computation_method` Postgres enum type.
 *
 * `Depth` means the position came from GSV depth data. `Approximation3` is the estimator new labels use — a
 * saturating-cotangent blend on the label's exact depression angle (see `PanoDataService.toLatLng`). `Approximation2`
 * is the linear-regression estimator that rows stored before the blend carry. The column is nullable in the db because
 * labels predating the column have no value.
 *
 * NOTE: if changing these values, update the `computation_method` Postgres enum type as well (see 342.sql, 349.sql).
 * The string values are sent by the Explore frontend in label submissions.
 */
object ComputationMethod extends Enumeration {
  type ComputationMethod = Value
  val Depth: Value          = Value("depth")
  val Approximation2: Value = Value("approximation2")
  val Approximation3: Value = Value("approximation3")

  /** Parses a string into a computation method, returning None if it doesn't match a known value. */
  def fromString(name: String): Option[Value] = values.find(_.toString == name)
}
