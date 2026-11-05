package models.utils

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Locale

/**
 * Builds the Mapbox Static Images URL that renders a route's path on the project basemap, for saved-route cards.
 *
 * The recipe lives here rather than in each consumer so the dashboard's cards, the /routes page, and RouteBuilder's
 * "Your saved routes" panel can't drift apart: all read a ready `thumbnail_url` off the route.
 */
object RouteThumbnail {

  /**
   * Where a route begins and ends, as (lng, lat), so the thumbnail can mark them the way the RouteBuilder map does
   * with its start and end flags. Both are the ends of the path in walking order, so a reversed street is already
   * accounted for.
   */
  case class Endpoints(start: (Double, Double), end: (Double, Double))

  /** The style the map tools render, so thumbnails match the maps they link to. */
  private val StyleId: String = "projectsidewalk/cloov4big002801rc0qw75w5g"

  /** Path stroke: width 4, the --color-link-100 token's hex (CSS variables can't reach a server-built URL), 90% opaque. */
  private val PathStyle: String = "path-4+3E8BD9-0.9"

  // Mapbox's built-in small pins in the colors of RouteBuilder's flag-start.svg and flag-end.svg. A custom marker
  // image (`url-…`) would be the flags themselves, but Mapbox fetches it from a public URL, which a dev checkout
  // and a private city don't have, so the pins are what every stage can render.
  private val StartPin: String = "pin-s+11C961"
  private val EndPin: String   = "pin-s+ED1C24"

  /** Retina card size, with padding so the path isn't flush against the edges. */
  private val Viewport: String = "auto/400x200@2x?padding=30"

  /**
   * @param encodedPolyline The route geometry, Google-encoded (see PolylineEncoder).
   * @param endpoints       Where the route starts and ends, marked on the thumbnail; None draws the path alone.
   * @param mapboxApiKey    The Mapbox access token.
   * @return                The static-map URL, or "" for a route with no geometry (callers render no thumbnail).
   */
  def url(encodedPolyline: String, endpoints: Option[Endpoints], mapboxApiKey: String): String = {
    if (encodedPolyline.isEmpty) ""
    else {
      val path: String = URLEncoder.encode(encodedPolyline, StandardCharsets.UTF_8)
      // Overlays draw in order, so the pins go after the path to sit on top of it.
      val overlays: Seq[String] = s"$PathStyle($path)" +: endpoints.toSeq.flatMap { e =>
        Seq(s"$StartPin(${pinCoords(e.start)})", s"$EndPin(${pinCoords(e.end)})")
      }
      val overlay: String = overlays.mkString(",")
      s"https://api.mapbox.com/styles/v1/$StyleId/static/$overlay/$Viewport&access_token=$mapboxApiKey"
    }
  }

  /**
   * Formats a (lng, lat) pair for a pin overlay. Locale.ROOT keeps the decimal point a point whatever the JVM's
   * locale; six places is finer than the thumbnail can show.
   */
  private def pinCoords(lngLat: (Double, Double)): String =
    String.format(Locale.ROOT, "%.6f,%.6f", Double.box(lngLat._1), Double.box(lngLat._2))
}
