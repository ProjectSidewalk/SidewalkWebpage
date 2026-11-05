package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.auth.DefaultEnv
import models.report.{ReportClientData, ReportLinks}
import play.api.Configuration
import play.api.mvc.{AnyContent, Result}
import play.silhouette.api.actions.UserAwareRequest
import service.{AccessScoreWeights, BasemapService, ConfigService, ReportOutcome, ReportService}

import javax.inject.*
import scala.concurrent.{ExecutionContext, Future}

object ReportController {

  /** How long to wait before retrying a report whose scores are still being computed; a large city takes over a minute. */
  val StillComputingRetryAfterSeconds: Int = 60
}

/**
 * Serves generated reports (#3889). Public and user-aware, like the API they are built from: a report is meant to be
 * forwarded, so it must open for someone with no account and no session.
 */
@Singleton
class ReportController @Inject() (
    cc: CustomControllerComponents,
    val config: Configuration,
    configService: ConfigService,
    reportService: ReportService,
    basemapService: BasemapService
)(using assets: AssetsFinder, ec: ExecutionContext)
    extends CustomBaseController(cc) {
  given Configuration = config

  /**
   * One neighborhood's report (#5876). Served as-is on mobile rather than redirected, since the page is responsive and
   * builds no pano; its maps run on the city's own tile archive, so a view costs no billable Google or Mapbox call.
   *
   * A link's `w` and `gs` (the AccessScore tool's weights) score the whole report. Read from the query string, not the
   * route, so a malformed one opens the engine's report rather than a 400.
   *
   * @param key The region's slug ([[models.report.ReportSlug]]), or its id, which redirects to the slug so a link made
   *            either way ends at one address.
   * @return `Ok` with the page, `Found` for an id, `MovedPermanently` for a slug in other case, `NotFound` if no such region exists, or
   *         `ServiceUnavailable` with a `Retry-After` and a page saying so while the city's AccessScores are being
   *         computed for the first time since a deploy.
   */
  def neighborhood(key: String) = cc.securityService.UserAwareAction { implicit request =>
    reportService.regionSlugs.flatMap { slugs =>
      val query                       = if (request.rawQueryString.isEmpty) "" else s"?${request.rawQueryString}"
      def moved(slug: String): Result = MovedPermanently(ReportLinks.report(slug) + query)
      // An id's slug changes if the region is renamed, and browsers keep a 301 indefinitely, so the id redirect is a
      // 302; a case-folded slug always lands on the same address, so that one can be permanent.
      def found(slug: String): Result = Found(ReportLinks.report(slug) + query)
      key.toIntOption match {
        case Some(id) => Future.successful(slugs.get(id).fold(NotFound(s"No region found with ID: $id"))(found))
        case None     =>
          slugs.collectFirst { case (id, slug) if slug == key.toLowerCase(java.util.Locale.ROOT) => id -> slug } match {
            case Some((_, slug)) if slug != key => Future.successful(moved(slug))
            case Some((regionId, slug))         => renderNeighborhood(regionId, slug)
            case None                           => Future.successful(NotFound(s"No neighborhood found named: $key"))
          }
      }
    }
  }

  /** The report itself, once the address has named a region. */
  private def renderNeighborhood(regionId: Int, slug: String)(using
      request: UserAwareRequest[DefaultEnv, AnyContent]
  ): Future[Result] = {
    val weights = AccessScoreWeights.fromParams(request.getQueryString("w"), request.getQueryString("gs"))
    reportService.neighborhoodReport(regionId, weights).flatMap {
      case ReportOutcome.RegionNotFound => Future.successful(NotFound(s"No region found with ID: $regionId"))
      case ReportOutcome.StillComputing =>
        configService.getCommonPageData(request2Messages.lang).map { commonData =>
          ServiceUnavailable(views.html.apps.report.computing(commonData, request.identity))
            .withHeaders(RETRY_AFTER -> ReportController.StillComputingRetryAfterSeconds.toString)
        }
      case ReportOutcome.Ready(report) =>
        configService.getCommonPageData(request2Messages.lang).map { commonData =>
          cc.loggingService.insert(
            request.identity.map(_.userId),
            request.ipAddress,
            s"Visit_Report_Neighborhood_Region=${regionId}_CustomWeights=${!weights.isDefault}"
          )
          val cityName   = commonData.allCityInfo.find(_.cityId == commonData.cityId).map(_.cityNameFormatted)
          val clientData =
            ReportClientData.toJson(
              report,
              BasemapController.pageData(basemapService.currentArchive),
              commonData.cityId
            )
          Ok(
            views.html.apps.report.neighborhood(commonData, request.identity, report, slug, cityName, clientData)
          )
        }
    }
  }
}
