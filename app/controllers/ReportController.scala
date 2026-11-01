package controllers

import controllers.base.{CustomBaseController, CustomControllerComponents}
import models.report.ReportPreset
import play.api.Configuration
import service.{ConfigService, ReportService}

import javax.inject.*
import scala.concurrent.{ExecutionContext, Future}

/**
 * Serves generated reports (#3889). Public and user-aware, like the API they are built from: a report is meant to be
 * forwarded, so it must open for someone with no account and no session.
 */
@Singleton
class ReportController @Inject() (
    cc: CustomControllerComponents,
    val config: Configuration,
    configService: ConfigService,
    reportService: ReportService
)(using assets: AssetsFinder, ec: ExecutionContext)
    extends CustomBaseController(cc) {
  given Configuration = config

  /**
   * One neighborhood's report (#5876), rendered on the server so that printing and saving as PDF need no JavaScript.
   * Served as-is on mobile rather than redirected, since the page is responsive and builds no pano or map.
   *
   * @param regionId The region to report on.
   * @param preset   A [[ReportPreset]] name; a missing or unknown one gets the default rather than an error.
   * @return `Ok` with the page, or `NotFound` if no such region exists.
   */
  def neighborhood(regionId: Int, preset: Option[String]) = cc.securityService.UserAwareAction { implicit request =>
    val reportPreset: ReportPreset = ReportPreset.fromParam(preset)
    reportService.neighborhoodReport(regionId).flatMap {
      case None         => Future.successful(NotFound(s"No region found with ID: $regionId"))
      case Some(report) =>
        configService.getCommonPageData(request2Messages.lang).map { commonData =>
          cc.loggingService.insert(
            request.identity.map(_.userId),
            request.ipAddress,
            s"Visit_Report_Neighborhood_Region=${regionId}_Preset=${reportPreset.name}"
          )
          val cityName = commonData.allCityInfo.find(_.cityId == commonData.cityId).map(_.cityNameFormatted)
          Ok(views.html.apps.report.neighborhood(commonData, request.identity, report, reportPreset, cityName))
        }
    }
  }
}
