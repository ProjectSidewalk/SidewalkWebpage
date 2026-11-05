package models.label

import models.utils.{NamedEnum, PgEnumCompanion}

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
enum ComputationMethod(val name: String) extends NamedEnum {
  case Depth          extends ComputationMethod("depth")
  case Approximation2 extends ComputationMethod("approximation2")
  case Approximation3 extends ComputationMethod("approximation3")
}

object ComputationMethod extends PgEnumCompanion[ComputationMethod]("computation_method")
