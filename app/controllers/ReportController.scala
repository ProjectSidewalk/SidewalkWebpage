package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.report.ReportClientData
import play.api.Configuration
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
   * @param regionId The region to report on.
   * @return `Ok` with the page, `NotFound` if no such region exists, or `ServiceUnavailable` with a `Retry-After` and a
   *         page saying so while the city's AccessScores are being computed for the first time since a deploy.
   */
  def neighborhood(regionId: Int) = cc.securityService.UserAwareAction { implicit request =>
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
            views.html.apps.report.neighborhood(commonData, request.identity, report, cityName, clientData)
          )
        }
    }
  }
}
