package controllers.api

import controllers.base.CustomControllerComponents
import formats.json.ApiFormats._
import models.label.ProjectSidewalkStats
import models.user.UserStatApi
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.ApiService

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext // Import JSON formatters.

@Singleton
class StatsApiController @Inject()(
  cc: CustomControllerComponents,
  val silhouette: Silhouette[models.auth.DefaultEnv],
  apiService: ApiService
)(implicit ec: ExecutionContext) extends BaseApiController(cc) {

  /**
   * Returns statistics for registered users in either JSON or CSV format with optional filtering.
   *
   * @param minLabels Optional minimum number of labels a user must have to be included
   * @param minMetersExplored Optional minimum meters explored a user must have to be included
   * @param highQualityOnly Optional filter to include only high quality users if true
   * @param minLabelAccuracy Optional minimum label accuracy a user must have to be included
   * @param filetype Optional file type (e.g., "csv" for CSV format, defaults to JSON if not specified)
   * @return User statistics in the requested format with applied filters
   */
  def getUserApiStats(
    minLabels: Option[Int],
    minMetersExplored: Option[Float],
    highQualityOnly: Option[Boolean],
    minLabelAccuracy: Option[Float],
    filetype: Option[String]
  ) = silhouette.UserAwareAction.async { implicit request =>
    // Use the updated service method that applies filters at the service level
    apiService.getUserStats(
      minLabels = minLabels,
      minMetersExplored = minMetersExplored,
      highQualityOnly = highQualityOnly,
      minLabelAccuracy = minLabelAccuracy
    ).map { filteredStats: Seq[UserStatApi] =>

      val baseFileName: String = s"userStats_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV or JSON (default).
      filetype match {
        case Some("csv") =>
          val userStatsFile = new java.io.File(s"$baseFileName.csv")
          val writer = new java.io.PrintStream(userStatsFile)
          writer.println(UserStatApi.csvHeader)
          filteredStats.foreach(userStat => writer.println(userStatToCSVRow(userStat)))
          writer.close()
          Ok.sendFile(content = userStatsFile, onClose = () => { userStatsFile.delete(); () })
        case _ =>
          Ok(Json.toJson(filteredStats.map(userStatToJson)))
      }
    }
  }

  /**
   * Retrieves user statistics in API version 2
   *
   * TODO: Mikey, at some point (soon), I think we should just remove the old API version
   *
   * @param filetype An optional parameter specifying the desired file type for the output (e.g., JSON, CSV).
   * @return A result containing the user statistics in the specified file type format.
   *         If no file type is specified, the default format is used.
   */
  def getUsersApiStatsV2(filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    apiService.getUserStats(
      minLabels = None,
      minMetersExplored = None,
      highQualityOnly = None,
      minLabelAccuracy = None
    ).map { filteredStats: Seq[UserStatApi] =>

      val baseFileName: String = s"userStats_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV or JSON (default).
      filetype match {
        case Some("csv") =>
          val userStatsFile = new java.io.File(s"$baseFileName.csv")
          val writer = new java.io.PrintStream(userStatsFile)
          writer.println(UserStatApi.csvHeader)
          filteredStats.foreach(userStat => writer.println(userStatToCSVRow(userStat)))
          writer.close()
          Ok.sendFile(content = userStatsFile, onClose = () => { userStatsFile.delete(); () })
        case _ =>
          Ok(Json.toJson(filteredStats.map(userStatToJson)))
      }
    }
  }

  /**
   * Returns overall statistics for Project Sidewalk.
   */
  def getOverallSidewalkStats(filterLowQuality: Boolean, filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    apiService.getOverallStats(filterLowQuality).map { stats: ProjectSidewalkStats =>
      val baseFileName: String = s"projectSidewalkStats_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV or JSON (default).
      filetype match {
        case Some("csv") =>
          val sidewalkStatsFile = new java.io.File(s"$baseFileName.csv")
          val writer = new java.io.PrintStream(sidewalkStatsFile)

          writer.println(s"Launch Date, ${stats.launchDate}")
          writer.println(s"Recent Labels Average Timestamp, ${stats.avgTimestampLast100Labels}")
          writer.println(s"KM Explored,${stats.kmExplored}")
          writer.println(s"KM Explored Without Overlap,${stats.kmExploreNoOverlap}")
          writer.println(s"Total User Count,${stats.nUsers}")
          writer.println(s"Explore User Count,${stats.nExplorers}")
          writer.println(s"Validate User Count,${stats.nValidators}")
          writer.println(s"Registered User Count,${stats.nRegistered}")
          writer.println(s"Anonymous User Count,${stats.nAnon}")
          writer.println(s"Turker User Count,${stats.nTurker}")
          writer.println(s"Researcher User Count,${stats.nResearcher}")
          writer.println(s"Total Label Count,${stats.nResearcher}")
          for ((labType, sevStats) <- stats.severityByLabelType) {
            writer.println(s"$labType Count,${sevStats.n}")
            writer.println(s"$labType Count With Severity,${sevStats.nWithSeverity}")
            writer.println(s"$labType Severity Mean,${sevStats.severityMean.map(_.toString).getOrElse("NA")}")
            writer.println(s"$labType Severity SD,${sevStats.severitySD.map(_.toString).getOrElse("NA")}")
          }
          writer.println(s"Total Validations,${stats.nValidations}")
          for ((labType, accStats) <- stats.accuracyByLabelType) {
            writer.println(s"$labType Labels Validated,${accStats.n}")
            writer.println(s"$labType Agreed Count,${accStats.nAgree}")
            writer.println(s"$labType Disagreed Count,${accStats.nDisagree}")
            writer.println(s"$labType Accuracy,${accStats.accuracy.map(_.toString).getOrElse("NA")}")
          }

          writer.close()
          Ok.sendFile(content = sidewalkStatsFile, onClose = () => { sidewalkStatsFile.delete(); () })
        case _ =>
          Ok(projectSidewalkStatsToJson(stats))
      }
    }
  }
}
