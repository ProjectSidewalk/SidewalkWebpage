package models.utils

object CommonUtils {
  val METERS_TO_MILES: Float = 0.000621371f

  /**
   * Calculate a destination point given a starting point, distance, and bearing using the Haversine formula.
   *
   * @param lat Starting latitude in degrees
   * @param lng Starting longitude in degrees
   * @param distanceKm Distance in kilometers
   * @param bearingDegrees Bearing in degrees (0-360, where 0 is north)
   * @return Tuple of (latitude, longitude) for the destination point
   */
  def calculateDestination(lat: Double, lng: Double, distanceKm: Double, bearingDegrees: Double): (Double, Double) = {
    val earthRadiusKm = 6371.0
    val lat1Rad       = math.toRadians(lat)
    val lng1Rad       = math.toRadians(lng)
    val bearingRad    = math.toRadians(bearingDegrees)
    val angularDist   = distanceKm / earthRadiusKm

    val lat2Rad = math.asin(
      math.sin(lat1Rad) * math.cos(angularDist) + math.cos(lat1Rad) * math.sin(angularDist) * math.cos(bearingRad)
    )

    val lng2Rad = lng1Rad + math.atan2(
      math.sin(bearingRad) * math.sin(angularDist) * math.cos(lat1Rad),
      math.cos(angularDist) - math.sin(lat1Rad) * math.sin(lat2Rad)
    )

    (math.toDegrees(lat2Rad), math.toDegrees(lng2Rad))
  }
}
