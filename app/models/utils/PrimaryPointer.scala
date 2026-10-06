package models.utils

/**
 * The browser's primary pointing device, as the `primary_pointer` environment columns store it (#5664).
 *
 * The client reports it from the `(pointer: coarse)` / `(pointer: fine)` media queries. The column carries a CHECK
 * constraint, so an unexpected value has to be dropped before insert, or the whole environment row would fail.
 */
object PrimaryPointer {
  val Values: Set[String] = Set("fine", "coarse", "none")

  /**
   * Keeps a client-reported pointer value only if it is one the column accepts.
   *
   * @param reported The value from the submission, if any.
   * @return The same value when it is valid, otherwise None.
   */
  def sanitize(reported: Option[String]): Option[String] = reported.filter(Values.contains)
}
