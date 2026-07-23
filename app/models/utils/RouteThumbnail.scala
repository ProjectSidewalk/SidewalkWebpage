package models.utils

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Builds the Mapbox Static Images URL that renders a route's path on the project basemap, for saved-route cards.
 *
 * The recipe lives here rather than in each consumer so the dashboard's cards and RouteBuilder's "Your saved
 * routes" panel can't drift apart: both read a ready `thumbnail_url` off the route.
 */
object RouteThumbnail {

  /** The style the map tools render, so thumbnails match the maps they link to. */
  private val StyleId: String = "projectsidewalk/cloov4big002801rc0qw75w5g"

  /** Path stroke: width 4, the --color-link-100 token's hex (CSS variables can't reach a server-built URL), 90% opaque. */
  private val PathStyle: String = "path-4+3E8BD9-0.9"

  /** Retina card size, with padding so the path isn't flush against the edges. */
  private val Viewport: String = "auto/400x200@2x?padding=30"

  /**
   * @param encodedPolyline The route geometry, Google-encoded (see PolylineEncoder).
   * @param mapboxApiKey    The Mapbox access token.
   * @return                The static-map URL, or "" for a route with no geometry (callers render no thumbnail).
   */
  def url(encodedPolyline: String, mapboxApiKey: String): String = {
    if (encodedPolyline.isEmpty) ""
    else {
      val path: String = URLEncoder.encode(encodedPolyline, StandardCharsets.UTF_8)
      s"https://api.mapbox.com/styles/v1/$StyleId/static/$PathStyle($path)/$Viewport&access_token=$mapboxApiKey"
    }
  }
}
