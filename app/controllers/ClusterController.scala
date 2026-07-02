package controllers

import controllers.base._
import formats.json.ClusterFormats._
import models.auth.{DefaultEnv, WithAdmin}
import org.apache.pekko.stream.scaladsl.Source
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import play.api.{Configuration, Logger}
import play.silhouette.api.Silhouette
import play.silhouette.api.exceptions.NotAuthorizedException
import service.{ClusterService, ConfigService}

import java.util.concurrent.atomic.AtomicReference
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class ClusterController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    configService: ConfigService,
    clusterService: ClusterService,
    apiService: service.ApiService
)(implicit ec: ExecutionContext, assets: AssetsFinder)
    extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config
  private val logger                         = Logger(this.getClass)

  /**
   * Returns the clustering webpage with GUI if the user is an admin, otherwise redirects to the landing page.
   */
  def index: Action[AnyContent] = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Clustering")
    configService
      .getCommonPageData(request2Messages.lang)
      .map(commonData => Ok(views.html.clustering(commonData, "Sidewalk - Clustering", request.identity)))
  }

  /**
   * Reads a key from env variable and compares against the input key, returning true if they match.
   * @return Boolean indicating whether the input key matches the true key.
   */
  def authenticate(key: String): Boolean = {
    key == config.get[String]("internal-api-key")
  }

  /**
   * Runs clustering, emitting status updates as a server-sent event stream.
   */
  def runClustering(): Action[AnyContent] = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)

    // Create a shared status object for clustering progress updates.
    val statusRef = new AtomicReference[String]("Starting")

    // Run the clustering.
    val resultFuture: Future[JsObject] = clusterService.runClustering(Some(statusRef)).map { results =>
      Json.obj("labels" -> results.labelCount, "clusters" -> results.clusterCount)
    }

    // Create a source that emits status updates.
    val statusSource = Source
      .tick(initialDelay = 0.seconds, interval = 2.seconds, tick = ())
      .mapMaterializedValue { mat =>
        // Cancel the ticker when clustering ends or the client disconnects.
        resultFuture.onComplete(_ => mat.cancel())
        mat
      }
      .takeWhile(_ =>
        // Send normal status updates.
        !resultFuture.isCompleted
      )
      .map { _ => s"""data: {"status": "${statusRef.get()}"}\n\n""" }

    // When the main task completes, emit the final status and complete the stream.
    val resultSource = Source.future(resultFuture).map { resultJson =>
      s"""data: {"status": "Complete", "results": ${resultJson.toString}}\n\n"""
    }

    // Combine the sources and return as event stream.
    Future.successful(
      Ok.chunked(statusSource.concat(resultSource))
        .as("text/event-stream")
        .withHeaders(
          "Cache-Control" -> "no-cache, no-store, must-revalidate",
          "Connection"    -> "keep-alive"
        )
    )
  }

  /**
   * Returns the set of labels in this region that should be clustered as JSON.
   * @param key A key used for authentication.
   * @param regionId The region whose labels should be retrieved.
   */
  def getLabelsToClusterInRegion(key: String, regionId: Int): Action[AnyContent] = Action.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    if (authenticate(key)) {
      apiService.getLabelsToClusterInRegion(regionId).map { labels => Ok(Json.toJson(labels)) }
    } else {
      Future.failed(new NotAuthorizedException("Could not authenticate with provided key."))
    }
  }

  /**
   * Takes in results of clustering, and adds the data in bulk to the relevant tables.
   *
   * NOTE The maxLength argument allows a 100MB max load size for the POST request.
   * TODO haven't tested that parse.json(maxLength = 1024 * 1024 * 100L) actually works.
   * @param key A key used for authentication.
   * @param regionId The region whose labels were clustered.
   */
  def postClusteringResults(key: String, regionId: Int): Action[JsValue] =
    Action.async(parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
      if (authenticate(key)) {
        val submission = request.body.validate[ClusteringSubmission]
        submission.fold(
          errors => {
            logger.error("Failed to parse JSON POST request for clustering results.")
            logger.info(Json.prettyPrint(request.body))
            Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
          },
          submission => {
            // Add all the new data into the db.
            apiService
              .submitClusteringResults(regionId, submission.clusters, submission.labels, submission.thresholds)
              .map { sessionId => Ok(Json.obj("session" -> sessionId)) }
          }
        )
      } else {
        Future.failed(new NotAuthorizedException("Could not authenticate with provided key."))
      }
    }
}
