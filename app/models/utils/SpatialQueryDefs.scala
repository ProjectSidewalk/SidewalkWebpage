package models.utils

object SpatialQueryType extends Enumeration {
  type SpatialQueryType = Value
  val Region, Street, LabelCluster = Value
}

case class LatLngBBox(minLat: Double, minLng: Double, maxLat: Double, maxLng: Double) {
  require(minLat <= maxLat, "minLat must be less than or equal to maxLat")
  require(minLng <= maxLng, "minLng must be less than or equal to maxLng")
}
