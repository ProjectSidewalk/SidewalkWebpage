package models.utils

object CommonUtils {
  val METERS_TO_MILES: Double = 0.000621371d

  // NOTE need to update ui_source enum in postgres as well if changing this Enumeration.
  object UiSource extends Enumeration {
    type UiSource = Value
    val Explore                         = Value("Explore")
    val Validate                        = Value("Validate")
    val ExpertValidate                  = Value("ExpertValidate")
    val ValidateMobile                  = Value("ValidateMobile")
    val AdminValidate                   = Value("AdminValidate")
    val LabelMap                        = Value("LabelMap")
    val GalleryImage                    = Value("GalleryImage")
    val GalleryExpandedImage            = Value("GalleryExpandedImage")
    val GalleryThumbs                   = Value("GalleryThumbs")
    val GalleryExpandedThumbs           = Value("GalleryExpandedThumbs")
    val UserMap                         = Value("UserMap")
    val LabelSearchPage                 = Value("LabelSearchPage")
    val AdminUserDashboard              = Value("AdminUserDashboard")
    val AdminMapTab                     = Value("AdminMapTab")
    val AdminContributionsTab           = Value("AdminContributionsTab")
    val AdminLabelSearchTab             = Value("AdminLabelSearchTab")
    val SidewalkAI                      = Value("SidewalkAI")
    val ExternalTagValidationASSETS2024 = Value("ExternalTagValidationASSETS2024")
    val SharedLabel                     = Value("SharedLabel")
    val SharedLabelImage                = Value("SharedLabelImage")
    val SharedLabelThumbs               = Value("SharedLabelThumbs")
    val OldDataUnknownSource            = Value("Old data, unknown source")
  }

  // NOTE: if adding values here, also update the viewer_type PostgreSQL enum (add via ALTER TYPE).
  object ViewerType extends Enumeration {
    type ViewerType = Value
    val Default    = Value("Default")    // Live primary viewer (GSV/Mapillary/Infra3d).
    val Pannellum  = Value("Pannellum")  // Self-hosted Pannellum fallback for expired panos.
    val StaticApi  = Value("StaticApi")  // Static image fetched from the imagery provider's API.
    val StaticCrop = Value("StaticCrop") // Locally-saved crop image.
  }

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
