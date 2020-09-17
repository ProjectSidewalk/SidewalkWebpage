package models.utils

object DataFormatter {
  def nanToZero(num: Double): Double = {
    if (num.isNaN) {
      0d
    } else {
      num
    }
  }
}
