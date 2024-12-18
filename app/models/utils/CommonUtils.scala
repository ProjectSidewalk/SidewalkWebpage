package models.utils

import java.sql.Timestamp

object CommonUtils {
  val METERS_TO_MILES: Float = 0.000621371F

  // Defining ordered method for Timestamp so they can be used in sortBy.
  // https://stackoverflow.com/questions/29985911/sort-scala-arraybuffer-of-timestamp
  implicit def ordered: Ordering[Timestamp] = new Ordering[Timestamp] {
    def compare(x: Timestamp, y: Timestamp): Int = x compareTo y
  }
}
