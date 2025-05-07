// app/controllers/api/StatsController.scala
package controllers.api

import controllers.base.CustomControllerComponents
import models.label.ProjectSidewalkStats
import models.user.UserStatApi
import org.apache.pekko.stream.Materializer
import play.api.libs.json.Json
import play.silhouette.api.Silhouette
import service.ApiService

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import java.time.OffsetDateTime
import formats.json.ApiFormats._ // Import JSON formatters

@Singleton
class StatsApiController @Inject()(cc: CustomControllerComponents,
                               val silhouette: Silhouette[models.auth.DefaultEnv],
                               apiService: ApiService
                              )(implicit ec: ExecutionContext, mat: Materializer) extends BaseApiController(cc) {

  /**
   * Returns some statistics for all registered users in either JSON or CSV.
   */
  def getUsersApiStats(filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    apiService.getStatsForApi.map { userStats: Seq[UserStatApi] =>
      val baseFileName: String = s"userStats_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          val userStatsFile = new java.io.File(s"$baseFileName.csv")
          val writer = new java.io.PrintStream(userStatsFile)
          writer.println(UserStatApi.csvHeader)
          userStats.foreach(userStat => writer.println(userStatToCSVRow(userStat)))
          writer.close()
          Ok.sendFile(content = userStatsFile, onClose = () => { userStatsFile.delete(); () })
        case _ =>
          Ok(Json.toJson(userStats.map(userStatToJson)))
      }
    }
  }

  /**
   * Returns overall statistics for Project Sidewalk.
   */
  def getOverallSidewalkStats(filterLowQuality: Boolean, filetype: Option[String]) = silhouette.UserAwareAction.async { implicit request =>
    apiService.getOverallStatsForApi(filterLowQuality).map { stats: ProjectSidewalkStats =>
      val baseFileName: String = s"projectSidewalkStats_${OffsetDateTime.now()}"
      cc.loggingService.insert(request.identity.map(_.userId), request.remoteAddress, request.toString)

      // Output data in the appropriate file format: CSV or GeoJSON (default).
      filetype match {
        case Some("csv") =>
          val sidewalkStatsFile = new java.io.File(s"$baseFileName.csv")
          val writer = new java.io.PrintStream(sidewalkStatsFile)

          writer.println(s"Launch Date, ${stats.launchDate}")
          writer.println(s"Recent Labels Average Timestamp, ${stats.avgTimestampLast100Labels}")
          writer.println(s"KM Explored,${stats.kmExplored}")
          writer.println(s"KM Explored Without Overlap,${stats.kmExploreNoOverlap}")
          writer.println(s"Total User Count,${stats.nUsers}")
          writer.println(s"Explorer User Count,${stats.nExplorers}")
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