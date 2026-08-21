package controllers.api

import controllers.base.CustomControllerComponents
import models.api.{AggregateStats, ApiError, DailyStatRecord, ProjectSidewalkStats, UserStatForApi}
import play.api.Logger
import play.api.libs.json.Json
import play.api.mvc.Result
import play.silhouette.api.Silhouette
import service.{ApiService, ConfigService}

import java.time.LocalDate
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

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
      .map { filteredStats: Seq[UserStatForApi] =>
        val baseFileName: String = timestampedFilename("userStats")
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

        // Output data in the appropriate file format: CSV or JSON (default).
        filetype match {
          case Some("csv") =>
            val userStatsFile = new java.io.File(s"$baseFileName.csv")
            val writer        = new java.io.PrintStream(userStatsFile)
            writer.println(UserStatForApi.csvHeader)
            filteredStats.foreach(userStat => writer.println(userStat.toCsvRow))
            writer.close()
            Ok.sendFile(content = userStatsFile, onClose = () => { userStatsFile.delete(); () })
          case _ =>
            Ok(Json.toJson(filteredStats.map(_.toJson)))
        }
      }
  }

  /**
   * Returns overall statistics for Project Sidewalk.
   */
  def getOverallSidewalkStats(filterLowQuality: Boolean, filetype: Option[String]) = silhouette.UserAwareAction.async {
    implicit request =>
      apiService.getOverallStats(filterLowQuality).map { stats: ProjectSidewalkStats =>
        val baseFileName: String = timestampedFilename("projectSidewalkStats")
        cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)

        // Output data in the appropriate file format: CSV or JSON (default).
        filetype match {
          case Some("csv") =>
            val sidewalkStatsFile = new java.io.File(s"$baseFileName.csv")
            val writer            = new java.io.PrintStream(sidewalkStatsFile, "UTF-8")
            stats.toCsvRows.foreach(writer.println)
            writer.close()
            Ok.sendFile(content = sidewalkStatsFile, onClose = () => { sidewalkStatsFile.delete(); () })
          case _ =>
            Ok(stats.toJson)
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
            val baseFileName = timestampedFilename("aggregateStats")

            // Create temporary CSV file (following the same pattern as other endpoints).
            val aggregateStatsFile = new java.io.File(s"$baseFileName.csv")
            val writer             = new java.io.PrintStream(aggregateStatsFile)
            writer.print((AggregateStats.csvHeader +: aggregateStats.toCsvRows).mkString("\n"))
            writer.close()

            Ok.sendFile(content = aggregateStatsFile, onClose = () => { aggregateStatsFile.delete(); () })

          case _ => // Default to JSON
            Ok(aggregateStats.toJson)
        }

      }
      .recover { case e: Exception =>
        logger.error(s"Failed to retrieve aggregate statistics: ${e.getMessage}", e)
        ApiError.toResult(ApiError.internalServerError(s"Failed to retrieve aggregate statistics: ${e.getMessage}"))
      }
  }

  /**
   * Parses a pair of optional YYYY-MM-DD date strings into Option[LocalDate] values.
   *
   * @param startDateStr Optional start date in YYYY-MM-DD format.
   * @param endDateStr   Optional end date in YYYY-MM-DD format.
   * @return             Right((startDate, endDate)) on success, Left(ApiError) on bad input.
   */
  private def parseDateParams(
      startDateStr: Option[String],
      endDateStr: Option[String]
  ): Either[ApiError, (Option[LocalDate], Option[LocalDate])] = {
    def parseOpt(opt: Option[String], paramName: String): Either[ApiError, Option[LocalDate]] =
      opt match {
        case None    => Right(None)
        case Some(s) =>
          try Right(Some(LocalDate.parse(s)))
          catch {
            case _: Exception =>
              Left(ApiError.invalidParameter(s"Invalid date '$s': expected YYYY-MM-DD format.", paramName))
          }
      }
    for {
      start <- parseOpt(startDateStr, "startDate")
      end   <- parseOpt(endDateStr, "endDate")
      _     <- (start, end) match {
        case (Some(s), Some(e)) if s.isAfter(e) =>
          Left(ApiError.invalidParameter("startDate must not be after endDate.", "startDate"))
        case _ => Right(())
      }
    } yield (start, end)
  }

  /**
   * Renders a sequence of DailyStatRecord as JSON or as a downloadable CSV file.
   *
   * @param stats    The daily stats to render.
   * @param filetype Optional "csv" to trigger CSV output; defaults to JSON.
   * @param baseName Base filename stem for the CSV download (timestamp appended automatically).
   * @return         Play Result with appropriate content type.
   */
  private def renderDailyStats(stats: Seq[DailyStatRecord], filetype: Option[String], baseName: String): Result = {
    filetype match {
      case Some("csv") =>
        val file   = new java.io.File(s"${timestampedFilename(baseName)}.csv")
        val writer = new java.io.PrintStream(file, "UTF-8")
        writer.print(DailyStatRecord.csvHeader)
        stats.foreach { r =>
          writer.println(
            s"${r.date},${r.labelType},${r.humanLabels},${r.aiLabels}," +
              s"${r.humanValidationsAgree},${r.humanValidationsDisagree},${r.humanValidationsUnsure}," +
              s"${r.aiValidationsAgree},${r.aiValidationsDisagree},${r.aiValidationsUnsure}"
          )
        }
        writer.close()
        Ok.sendFile(content = file, onClose = () => { file.delete(); () })
      case _ =>
        Ok(Json.obj("status" -> "OK", "data" -> stats))
    }
  }

  /**
   * Returns daily label and validation counts for the current city split by human vs AI and label type.
   *
   * @param startDate        Optional start date (YYYY-MM-DD); no lower bound if absent.
   * @param endDate          Optional end date (YYYY-MM-DD); no upper bound if absent.
   * @param filterLowQuality If true, exclude low-quality users. Defaults to false.
   * @param filetype         Output format: "json" (default) or "csv".
   * @return                 Daily stats in the requested format.
   */
  def getOverallStatsByDay(
      startDate: Option[String],
      endDate: Option[String],
      filterLowQuality: Boolean,
      filetype: Option[String]
  ) = silhouette.UserAwareAction.async { implicit request =>
    parseDateParams(startDate, endDate) match {
      case Left(err)           => Future.successful(ApiError.toResult(err))
      case Right((start, end)) =>
        apiService.getOverallStatsByDay(start, end, filterLowQuality).map { stats =>
          cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
          renderDailyStats(stats, filetype, "overallStatsByDay")
        }
    }
  }

  /**
   * Returns daily label and validation counts aggregated across all configured cities, split by human
   * vs AI and label type.
   *
   * @param startDate        Optional start date (YYYY-MM-DD); no lower bound if absent.
   * @param endDate          Optional end date (YYYY-MM-DD); no upper bound if absent.
   * @param filterLowQuality If true, exclude low-quality users. Defaults to false.
   * @param filetype         Output format: "json" (default) or "csv".
   * @return                 Daily aggregate stats in the requested format.
   */
  def getAggregateStatsByDay(
      startDate: Option[String],
      endDate: Option[String],
      filterLowQuality: Boolean,
      filetype: Option[String]
  ) = silhouette.UserAwareAction.async { implicit request =>
    parseDateParams(startDate, endDate) match {
      case Left(err)           => Future.successful(ApiError.toResult(err))
      case Right((start, end)) =>
        configService.getAggregateStatsByDay(start, end, filterLowQuality).map { stats =>
          cc.loggingService.insert(request.identity.map(_.userId), request.ipAddress, request.toString)
          renderDailyStats(stats, filetype, "aggregateStatsByDay")
        }
    }
  }
}
