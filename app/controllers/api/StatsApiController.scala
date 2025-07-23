package controllers.api

import controllers.base.CustomControllerComponents
import formats.json.ApiFormats._
import models.label.ProjectSidewalkStats
import models.user.UserStatApi
import play.api.Logger
import play.api.libs.json.{JsObject, Json}
import play.silhouette.api.Silhouette
import service.{AggregateStats, ApiService, ConfigService}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

@Singleton
class StatsApiController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[models.auth.DefaultEnv],
    apiService: ApiService,
    configService: ConfigService
)(implicit ec: ExecutionContext)
    extends BaseApiController(cc) {

  private val logger = Logger(this.getClass)

  /**
   * Returns statistics for registered users in either JSON or CSV format with optional filtering.
   *
   * @param minLabels Optional minimum number of labels a user must have to be included
   * @param minMetersExplored Optional minimum meters explored a user must have to be included
   * @param highQualityOnly Optional filter to include only high quality users if true
   * @param minAccuracy Optional minimum label accuracy a user must have to be included
   * @param filetype Optional file type (e.g., "csv" for CSV format, defaults to JSON if not specified)
   * @return User statistics in the requested format with applied filters
   */
  def getUserApiStats(
      minLabels: Option[Int],
      minMetersExplored: Option[Float],
      highQualityOnly: Option[Boolean],
      minAccuracy: Option[Float],
      filetype: Option[String]
  ) = silhouette.UserAwareAction.async { implicit request =>
    // Use the updated service method that applies filters at the service level.
    apiService
      .getUserStats(
        minLabels = minLabels,
        minMetersExplored = minMetersExplored,
        highQualityOnly = highQualityOnly,
        minAccuracy = minAccuracy
      )
      .map { filteredStats: Seq[UserStatApi] =>
        val baseFileName: String = s"userStats_${OffsetDateTime.now()}"
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

        // Output data in the appropriate file format: CSV or JSON (default).
        filetype match {
          case Some("csv") =>
            val userStatsFile = new java.io.File(s"$baseFileName.csv")
            val writer        = new java.io.PrintStream(userStatsFile)
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
  def getOverallSidewalkStats(filterLowQuality: Boolean, filetype: Option[String]) = silhouette.UserAwareAction.async {
    implicit request =>
      apiService.getOverallStats(filterLowQuality).map { stats: ProjectSidewalkStats =>
        val baseFileName: String = s"projectSidewalkStats_${OffsetDateTime.now()}"
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

        // Output data in the appropriate file format: CSV or JSON (default).
        filetype match {
          case Some("csv") =>
            val sidewalkStatsFile = new java.io.File(s"$baseFileName.csv")
            val writer            = new java.io.PrintStream(sidewalkStatsFile)

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

  /**
   * Returns aggregate statistics across all Project Sidewalk deployments.
   *
   * This endpoint provides consolidated statistics from all configured cities, including:
   * - Total kilometers explored (with and without overlap)
   * - Total labels and validations across all cities
   * - Label-specific statistics showing counts, validations, and agreement rates
   *
   * The response format matches the structure expected by the frontend statistics aggregator,
   * replacing the client-side JavaScript aggregation with server-side calculation.
   *
   * @param filetype Optional file type (e.g., "csv" for CSV format, defaults to JSON)
   * @return Aggregate statistics in the requested format
   */
  def getAggregateStats(filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    // Fetch aggregate statistics from the config service.
    configService
      .getAggregateStats()
      .map { aggregateStats =>
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

        // Generate response in the requested format.
        filetype match {
          case Some("csv") =>
            val csvContent   = generateAggregateStatsCsv(aggregateStats)
            val baseFileName = s"aggregateStats_${OffsetDateTime.now()}"

            // Create temporary CSV file (following the same pattern as other endpoints).
            val aggregateStatsFile = new java.io.File(s"$baseFileName.csv")
            val writer             = new java.io.PrintStream(aggregateStatsFile)
            writer.print(csvContent)
            writer.close()

            Ok.sendFile(content = aggregateStatsFile, onClose = () => { aggregateStatsFile.delete(); () })

          case _ => // Default to JSON
            Ok(aggregateStatsToJson(aggregateStats))
        }

      }
      .recover { case e: Exception =>
        logger.error(s"Failed to retrieve aggregate statistics: ${e.getMessage}", e)

        // Return error response to client.
        InternalServerError(
          Json.obj(
            "status"  -> 500,
            "code"    -> "INTERNAL_SERVER_ERROR",
            "message" -> s"Failed to retrieve aggregate statistics: ${e.getMessage}"
          )
        )
      }
  }

  /**
   * Converts aggregate statistics to JSON format.
   *
   * This method creates a JSON representation of the aggregate statistics that matches the expected format for the
   * frontend aggregator replacement, now including deployment counts for cities, countries, and languages.
   *
   * @param stats The aggregate statistics to convert
   * @return JSON representation of the statistics
   */
  private def aggregateStatsToJson(stats: AggregateStats): JsObject = {

    // Convert label type statistics to JSON.
    val labelTypeJson = stats.byLabelType.map { case (labelType, labelStats) =>
      labelType -> Json.obj(
        "labels"                  -> labelStats.labels,
        "labelsValidated"         -> labelStats.labelsValidated,
        "labelsValidatedAgree"    -> labelStats.labelsValidatedAgree,
        "labelsValidatedDisagree" -> labelStats.labelsValidatedDisagree
      )
    }

    // Create the main JSON response (following the same pattern as other endpoints).
    Json.obj(
      "status"              -> "OK",
      "kmExplored"          -> stats.kmExplored,
      "kmExploredNoOverlap" -> stats.kmExploredNoOverlap,
      "totalLabels"         -> stats.totalLabels,
      "totalValidations"    -> stats.totalValidations,
      "numCities"           -> stats.numCities,
      "numCountries"        -> stats.numCountries,
      "numLanguages"        -> stats.numLanguages,
      "byLabelType"         -> labelTypeJson
    )
  }

  /**
   * Generates CSV format for aggregate statistics.
   *
   * This method creates a CSV representation of the aggregate statistics suitable for data analysis and reporting
   * purposes. It follows the same pattern as other CSV generation methods in the controller.
   *
   * @param stats The aggregate statistics to convert
   * @return CSV formatted string
   */
  private def generateAggregateStatsCsv(stats: AggregateStats): String = {
    val header     = "Metric,Value\n"
    val basicStats = Seq(
      s"KM Explored,${stats.kmExplored}",
      s"KM Explored No Overlap,${stats.kmExploredNoOverlap}",
      s"Total Labels,${stats.totalLabels}",
      s"Total Validations,${stats.totalValidations}",
      s"Number of Cities,${stats.numCities}",
      s"Number of Countries,${stats.numCountries}",
      s"Number of Languages,${stats.numLanguages}"
    )

    // Add label-specific statistics.
    val labelTypeStats = stats.byLabelType.flatMap { case (labelType, labelStats) =>
      Seq(
        s"$labelType Labels,${labelStats.labels}",
        s"$labelType Labels Validated,${labelStats.labelsValidated}",
        s"$labelType Labels Validated Agree,${labelStats.labelsValidatedAgree}",
        s"$labelType Labels Validated Disagree,${labelStats.labelsValidatedDisagree}"
      )
    }

    // Combine all statistics
    val allStats = basicStats ++ labelTypeStats
    header + allStats.mkString("\n")
  }
}
