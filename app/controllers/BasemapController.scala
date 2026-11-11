package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent, RangeResult}
import service.BasemapService

import javax.inject.{Inject, Singleton}

/** Serves the minimap's tile archive (#5716), which MapLibre reads in pieces by byte-range requests. */
@Singleton
class BasemapController @Inject() (cc: CustomControllerComponents, basemapService: BasemapService)
    extends CustomBaseController(cc) {

  /**
   * Each cut gets a new name, so a browser may cache an archive for good.
   *
   * @param name The archive's file name, from [[BasemapController.pageData]].
   * @return     The requested bytes, or 404.
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

  /** The glyph URL pattern; its own route, since no fingerprinted asset name can match a pattern. */
  val GlyphsUrl: String = s"${routes.Assets.at("").url}{fontstack}/{range}.pbf"

  /**
   * @param archive The current archive's file name, or None before the city's first build.
   * @return        The minimap's `{tilesUrl, glyphsUrl}`, with `tilesUrl` null when there's no archive.
   */
  def pageData(archive: Option[String]): JsObject =
    Json.obj("tilesUrl" -> archive.map(routes.BasemapController.archive(_).url), "glyphsUrl" -> GlyphsUrl)
}
