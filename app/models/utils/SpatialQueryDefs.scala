package models.utils

object SpatialQueryType extends Enumeration {
  type SpatialQueryType = Value
  val Region, Street, LabelCluster = Value
}

case class LatLngBBox(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
  require(minLat <= maxLat, "minLat must be less than or equal to maxLat")
  require(minLng <= maxLng, "minLng must be less than or equal to maxLng")
}

object LatLngBBox {

  /**
   * Parses a comma-separated "minLng,minLat,maxLng,maxLat" string (the v3 API bbox convention) into a bbox.
   *
   * Corners are min/max-normalized rather than trusted, so an inverted box parses instead of tripping the class's
   * `require`s, and non-finite values (NaN/Infinity would also slip past the ordering checks) are rejected.
   *
   * @param bbox The raw query-string value, e.g. "-122.35,47.60,-122.30,47.65".
   * @return     The parsed bbox, or None if the value isn't four comma-separated finite numbers.
   */
  def fromString(bbox: String): Option[LatLngBBox] = {
    val parts = bbox.split(",", -1).toSeq.map(part => scala.util.Try(part.trim.toDouble).toOption.filter(_.isFinite))
    parts match {
      case Seq(Some(lng1), Some(lat1), Some(lng2), Some(lat2)) =>
        Some(
          LatLngBBox(
            minLat = math.min(lat1, lat2),
            minLng = math.min(lng1, lng2),
            maxLat = math.max(lat1, lat2),
            maxLng = math.max(lng1, lng2)
          )
        )
      case _ => None
    }
  }
}
