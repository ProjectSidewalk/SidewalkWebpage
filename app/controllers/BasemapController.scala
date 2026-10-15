package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent, RangeResult}
import service.BasemapService

import javax.inject.{Inject, Singleton}

/**
 * Serves the Explore minimap's basemap: the city's archive of OpenStreetMap vector tiles (#5716).
 *
 * The archive is one file that MapLibre reads in pieces, asking for byte ranges as it needs tiles, so all this has
 * to do is answer range requests. The font files the map draws its text with are static assets on their own route
 * (`conf/routes`, `/basemap/glyphs/`), since MapLibre asks for them by a URL pattern no fingerprinted name can match.
 */
@Singleton
class BasemapController @Inject() (cc: CustomControllerComponents, basemapService: BasemapService)
    extends CustomBaseController(cc) {

  /**
   * One archive, by the file name the page was given. Each cut gets a new name, so the bytes behind a name never
   * change and a browser may keep them for good.
   *
   * @param name The archive's file name, from [[BasemapController.pageData]].
   */
  def archive(name: String): Action[AnyContent] = Action { request =>
    basemapService.archiveFile(name) match {
      case Some(file) =>
        RangeResult
          .ofPath(file.toPath, request.headers.get(RANGE), Some("application/vnd.pmtiles"))
          .withHeaders(CACHE_CONTROL -> "public, max-age=31536000, immutable")
      case None => NotFound
    }
  }
}

object BasemapController {

  /** Where MapLibre asks for glyphs: the folder `/basemap/glyphs/` serves, plus the parts MapLibre fills in. */
  val GlyphsUrl: String = s"${routes.Assets.at("").url}{fontstack}/{range}.pbf"

  /**
   * What the minimap needs to draw its basemap, for the Explore page to hand it.
   *
   * @param archive The current archive's file name, or None before the city's first build (the minimap then draws
   *                its streets over a plain background).
   * @return        `{tilesUrl, glyphsUrl}`, with `tilesUrl` null when there is no archive.
   */
  def pageData(archive: Option[String]): JsObject =
    Json.obj("tilesUrl" -> archive.map(routes.BasemapController.archive(_).url), "glyphsUrl" -> GlyphsUrl)
}
