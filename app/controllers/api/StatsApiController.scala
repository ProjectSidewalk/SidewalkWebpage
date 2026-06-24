package controllers.api

import controllers.base.CustomControllerComponents
import controllers.helper.ControllerUtils.labelTypeOrdering
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
   * Converts a human-readable or camelCase/PascalCase label into a snake_case CSV key (#3871).
   *
   * @param label The label to convert, e.g. "KM Explored" or "CurbRamp Count".
   * @return The snake_case key, e.g. "km_explored" or "curb_ramp_count".
   */
  private def toSnakeKey(label: String): String =
    label.trim
      .replaceAll("([a-z\\d])([A-Z])", "$1_$2") // split camelCase/PascalCase boundaries
      .replaceAll("\\s+", "_")                  // spaces to underscores
      .toLowerCase

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
      minMetersExplored: Option[Double],
      highQualityOnly: Option[Boolean],
      minAccuracy: Option[Double],
      filetype: Option[String]
  ) = silhouette.UserAwareAction.async { implicit request =>
    // Use the updated service method that applies filters at the service level.
    apiService
      .getUserStats(
        minLabels = minLabels,
        minMetersExplored = minMetersExplored,
        highQualityOnly = highQualityOnly.getOrElse(false),
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
            val writer            = new java.io.PrintStream(sidewalkStatsFile, "UTF-8")

            // Each row is "snake_case_key,value" per the v3 API convention (#3871); toSnakeKey normalizes the label.
            def row(label: String, value: Any): Unit = writer.println(s"${toSnakeKey(label)},$value")

            row("Launch Date", stats.launchDate)
            row("Recent Labels Average Timestamp", stats.avgTimestampLast100Labels.getOrElse("NA"))
            row("KM Explored", stats.kmExplored)
            row("KM Explored Without Overlap", stats.kmExploreNoOverlap)
            row("Total User Count", stats.nUsers)
            row("Explore User Count", stats.nExplorers)
            row("Validate User Count", stats.nValidators)
            row("Registered User Count", stats.nRegistered)
            row("Anonymous User Count", stats.nAnon)
            row("Turker User Count", stats.nTurker)
            row("Researcher User Count", stats.nResearcher)
            row("Total Label Count", stats.nLabels)
            row("Total Label Count With Severity", stats.nLabelsWithSeverity)
            row("Average Label Timestamp", stats.avgLabelTimestamp.getOrElse("NA"))
            val avgImgAge: String = stats.avgImageAgeByLabel.map(avg => s"${avg.toDays} Days").getOrElse("NA")
            row("Average Age of Image When Labeled", avgImgAge)
            for ((labType, sevStats) <- stats.severityByLabelType.toSeq.sorted(labelTypeOrdering)) {
              row(s"$labType Count", sevStats.n)
              row(s"$labType Count With Severity", sevStats.nWithSeverity.getOrElse("NA"))
              row(s"$labType Severity Mean", sevStats.severityMean.map(_.toString).getOrElse("NA"))
              row(s"$labType Severity SD", sevStats.severitySD.map(_.toString).getOrElse("NA"))
            }
            // Validation stats split three ways: combined (all votes), human (non-AI votes), and AI (AI votes).
            val validationSources = Seq(
              ("Combined", stats.validations.combined),
              ("Human", stats.validations.human),
              ("AI", stats.validations.ai)
            )
            for ((srcLabel, srcStats) <- validationSources) {
              row(s"$srcLabel Total Validations", srcStats.nValidations)
              for ((labType, accStats) <- srcStats.accuracyByLabelType.toSeq.sorted(labelTypeOrdering)) {
                row(s"$srcLabel $labType Labels Validated", accStats.n)
                row(s"$srcLabel $labType Agreed Count", accStats.nAgree)
                row(s"$srcLabel $labType Disagreed Count", accStats.nDisagree)
                row(s"$srcLabel $labType Accuracy", accStats.accuracy.map(_.toString).getOrElse("NA"))
                row(s"$srcLabel $labType Labels With a Validation", accStats.nWithValidation)
              }
            }
            for ((labelType, aiStatsMap) <- stats.aiPerformance.toSeq.sorted(labelTypeOrdering)) {
              for ((voteType, aiStats) <- aiStatsMap) {
                val voteTypeText: String =
                  if (voteType == "human_majority_vote") "Human Majority Vote" else "Admin Majority Vote"
                row(s"$labelType AI Yes and $voteTypeText Concurs", aiStats.aiYesHumanConcurs)
                row(s"$labelType AI Yes but $voteTypeText Differs", aiStats.aiYesHumanDiffers)
                row(s"$labelType AI No but $voteTypeText Differs", aiStats.aiNoHumanDiffers)
                row(s"$labelType AI No and $voteTypeText Concurs", aiStats.aiNoHumanConcurs)
              }
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

    // Convert label type statistics to JSON. Field names are snake_case per the v3 API convention (#3871).
    val labelTypeJson = stats.byLabelType.map { case (labelType, labelStats) =>
      labelType -> Json.obj(
        "labels"                    -> labelStats.labels,
        "labels_validated"          -> labelStats.labelsValidated,
        "labels_validated_agree"    -> labelStats.labelsValidatedAgree,
        "labels_validated_disagree" -> labelStats.labelsValidatedDisagree
      )
    }

    // Create the main JSON response (following the same pattern as other endpoints).
    Json.obj(
      "status"                 -> "OK",
      "km_explored"            -> stats.kmExplored,
      "km_explored_no_overlap" -> stats.kmExploredNoOverlap,
      "total_labels"           -> stats.totalLabels,
      "total_validations"      -> stats.totalValidations,
      "num_cities"             -> stats.numCities,
      "num_countries"          -> stats.numCountries,
      "num_languages"          -> stats.numLanguages,
      "by_label_type"          -> labelTypeJson
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
