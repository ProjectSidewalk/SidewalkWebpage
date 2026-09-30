package models.utils

object CommonUtils {
  val METERS_TO_MILES: Double = 0.000621371d
  val EARTH_RADIUS_KM: Double = 6371.0

  // NOTE: if adding values here, also update the ui_source PostgreSQL enum (add via ALTER TYPE).
  enum UiSource(val name: String) extends NamedEnum {
    case Explore                         extends UiSource("Explore")
    case Validate                        extends UiSource("Validate")
    case ExpertValidate                  extends UiSource("ExpertValidate")
    case ValidateMobile                  extends UiSource("ValidateMobile")
    case AdminValidate                   extends UiSource("AdminValidate")
    case LabelMap                        extends UiSource("LabelMap")
    case GalleryImage                    extends UiSource("GalleryImage")
    case GalleryExpandedImage            extends UiSource("GalleryExpandedImage")
    case GalleryThumbs                   extends UiSource("GalleryThumbs")
    case GalleryExpandedThumbs           extends UiSource("GalleryExpandedThumbs")
    case UserMap                         extends UiSource("UserMap")
    case LabelSearchPage                 extends UiSource("LabelSearchPage")
    case AdminUserDashboard              extends UiSource("AdminUserDashboard")
    case AdminMapTab                     extends UiSource("AdminMapTab")
    case AdminContributionsTab           extends UiSource("AdminContributionsTab")
    case AdminLabelSearchTab             extends UiSource("AdminLabelSearchTab")
    case SidewalkAI                      extends UiSource("SidewalkAI")
    case ExternalTagValidationASSETS2024 extends UiSource("ExternalTagValidationASSETS2024")
    case LandingPage                     extends UiSource("LandingPage")
    case SharedLabel                     extends UiSource("SharedLabel")
    case SharedLabelImage                extends UiSource("SharedLabelImage")
    case SharedLabelThumbs               extends UiSource("SharedLabelThumbs")
    case DashboardStories                extends UiSource("DashboardStories")
    case AdminStories                    extends UiSource("AdminStories")
    case GalleryExpanded                 extends UiSource("GalleryExpanded")
    case AdminLabelMap                   extends UiSource("AdminLabelMap")
    case AdminActivity                   extends UiSource("AdminActivity")
    case StoryListPage                   extends UiSource("StoryListPage")
    case UserDashboard                   extends UiSource("UserDashboard")
    case AccessScore                     extends UiSource("AccessScore")
    case OldDataUnknownSource            extends UiSource("Old data, unknown source")
  }

  object UiSource extends PgEnumCompanion[UiSource]("ui_source")

  // NOTE: if adding values here, also update the viewer_type PostgreSQL enum (add via ALTER TYPE).
  enum ViewerType(val name: String) extends NamedEnum {
    case Default    extends ViewerType("Default")    // Live primary viewer (GSV/Mapillary/Infra3d).
    case Pannellum  extends ViewerType("Pannellum")  // Self-hosted Pannellum fallback for expired panos.
    case StaticApi  extends ViewerType("StaticApi")  // Static image fetched from the imagery provider's API.
    case StaticCrop extends ViewerType("StaticCrop") // Locally-saved crop image.
  }

  object ViewerType extends PgEnumCompanion[ViewerType]("viewer_type")

  /**
   * Truncates a value to `decimals` decimal places rather than rounding it.
   *
   * @param value    The value to truncate.
   * @param decimals How many decimal places to keep.
   * @return         The value truncated at that precision.
   */
  def floorTo(value: Double, decimals: Int): Double =
    BigDecimal.decimal(value).setScale(decimals, BigDecimal.RoundingMode.FLOOR).toDouble

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
    val lat1Rad     = math.toRadians(lat)
    val lng1Rad     = math.toRadians(lng)
    val bearingRad  = math.toRadians(bearingDegrees)
    val angularDist = distanceKm / EARTH_RADIUS_KM

    val lat2Rad = math.asin(
      math.sin(lat1Rad) * math.cos(angularDist) + math.cos(lat1Rad) * math.sin(angularDist) * math.cos(bearingRad)
    )

    val lng2Rad = lng1Rad + math.atan2(
      math.sin(bearingRad) * math.sin(angularDist) * math.cos(lat1Rad),
      math.cos(angularDist) - math.sin(lat1Rad) * math.sin(lat2Rad)
    )

    (math.toDegrees(lat2Rad), math.toDegrees(lng2Rad))
  }

  /**
   * Great-circle distance between two points in meters, via the haversine formula.
   *
   * @param lat1 First point's latitude in degrees
   * @param lng1 First point's longitude in degrees
   * @param lat2 Second point's latitude in degrees
   * @param lng2 Second point's longitude in degrees
   * @return Distance in meters
   */
  def haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double = {
    val dLat = math.toRadians(lat2 - lat1)
    val dLng = math.toRadians(lng2 - lng1)
    val a    = math.pow(math.sin(dLat / 2), 2) +
      math.cos(math.toRadians(lat1)) * math.cos(math.toRadians(lat2)) * math.pow(math.sin(dLng / 2), 2)
    2 * EARTH_RADIUS_KM * 1000 * math.asin(math.sqrt(a))
  }
}
