package controllers

import controllers.base._
import formats.json.ClusterFormats._
import models.auth.{DefaultEnv, WithAdmin}
import org.apache.pekko.stream.scaladsl.Source
import play.api.libs.json._
import play.api.{Configuration, Logger}
import play.silhouette.api.Silhouette
import play.silhouette.api.exceptions.NotAuthorizedException
import service.ConfigService

import java.util.concurrent.atomic.AtomicReference
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}
import scala.sys.process.stringSeqToProcess

@Singleton
class ClusterController @Inject()(cc: CustomControllerComponents,
                                  val silhouette: Silhouette[DefaultEnv],
                                  val config: Configuration,
                                  configService: ConfigService,
                                  apiService: service.ApiService
                                 )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig: Configuration = config
  private val logger = Logger(this.getClass)

  /**
   * Returns the clustering webpage with GUI if the user is an admin, otherwise redirects to the landing page.
   */
  def index = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Clustering")
    configService.getCommonPageData(request2Messages.lang)
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
   * Calls the appropriate clustering function(s); either single-user clustering, multi-user clustering, or both.
   * @param clusteringType One of "singleUser", "multiUser", or "both".
   */
  def runClustering(clusteringType: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit _ =>
    // Create a shared status object for clustering progress updates.
    val statusRef = new AtomicReference[String]("Starting")

    // Run the clustering.
    val resultFuture: Future[JsObject] = runClusteringHelper(clusteringType, Some(statusRef))

    // Create a source that emits status updates.
    val statusSource = Source.tick(initialDelay = 0.seconds, interval = 2.seconds, tick = ())
      .mapMaterializedValue { mat =>
        // Cancel the ticker when clustering ends or the client disconnects.
        resultFuture.onComplete(_ => mat.cancel())
        mat
      }.takeWhile(_ =>
        // Send normal status updates.
        !resultFuture.isCompleted).map { _ => s"""data: {"status": "${statusRef.get()}"}\n\n"""
      }

    // When the main task completes, emit the final status and complete the stream.
    val resultSource = Source.future(resultFuture).map { resultJson =>
      s"""data: {"status": "Complete", "results": ${resultJson.toString}}\n\n"""
    }

    // Combine the sources and return as event stream.
    Future.successful(
      Ok.chunked(statusSource.concat(resultSource)).as("text/event-stream")
        .withHeaders(
          "Cache-Control" -> "no-cache, no-store, must-revalidate",
          "Connection" -> "keep-alive"
        )
    )
  }

  /**
   * Calls the appropriate clustering function(s); either single-user clustering, multi-user clustering, or both.
   * @param clusteringType One of "singleUser", "multiUser", or "both".
   * @param statusRef Reference to a string that will be updated with the clustering progress.
   * @return Final counts of labels, user attributes, and global attributes in JSON.
   */
  def runClusteringHelper(clusteringType: String, statusRef: Option[AtomicReference[String]] = None): Future[JsObject] = {
    for {
      // Run the appropriate clustering function(s).
      _ <- if (Seq("singleUser", "both").contains(clusteringType)) runSingleUserClustering(statusRef) else Future.successful(())
      _ <- if (Seq("multiUser", "both").contains(clusteringType)) runMultiUserClustering(statusRef) else Future.successful(())
      // Gets the counts of labels/attributes from the affected tables to show how many clusters were created.
      clusteringResults <- apiService.getClusteringInfo
    } yield {
      Json.obj(
        "user_labels" -> clusteringResults._1,
        "user_attributes" -> clusteringResults._2,
        "global_attributes" -> clusteringResults._3
      )
    }
  }

  /**
   * Runs single user clustering for each high quality user who has placed a label since `cutoffTime`.
   * @param statusRef Reference to a string that will be updated with the clustering progress.
   */
  def runSingleUserClustering(statusRef: Option[AtomicReference[String]]): Future[Unit] = {
    val key: String = config.get[String]("internal-api-key")

    apiService.getUsersToCluster.map { usersToCluster =>
      val nUsers = usersToCluster.length
      logger.info("N users = " + nUsers)

      // Run clustering for each user that we are re-clustering.
      for ((userId, i) <- usersToCluster.view.zipWithIndex) {
        // Update the status in event stream and send a log message.
        statusRef.foreach(_.set(s"Finished ${f"${100.0 * i / nUsers}%1.2f"}% of users"))
        logger.info(s"Finished ${f"${100.0 * i / nUsers}%1.2f"}% of users, next: $userId.")

        // Run the clustering script for this user.
        val clusteringOutput = Seq("python3", "label_clustering.py", "--key", key, "--user_id", userId).!!
        logger.debug(clusteringOutput)
      }
      logger.info("Finished 100% of users!!\n")
    }
  }

  /**
   * Runs multi-user clustering for the user attributes in each region.
   * @param statusRef Reference to a string that will be updated with the clustering progress.
   */
  private def runMultiUserClustering(statusRef: Option[AtomicReference[String]]): Future[Unit] = {
    val key: String = config.get[String]("internal-api-key")

    apiService.getRegionsToCluster.map { regionIds =>
      val nRegions: Int = regionIds.length
      logger.info("N regions = " + nRegions)

      // Runs multi-user clustering within each region.
      for ((regionId, i) <- regionIds.view.zipWithIndex) {
        // Update the status in event stream and send a log message.
        statusRef.foreach(_.set(s"Finished ${f"${100.0 * i / nRegions}%1.2f"}% of regions"))
        logger.info(s"Finished ${f"${100.0 * i / nRegions}%1.2f"}% of regions, next: $regionId.")

        // Run the clustering script for this region.
        val clusteringOutput = Seq("python3", "label_clustering.py", "--key", key, "--region_id", regionId.toString).!!
        logger.debug(clusteringOutput)
      }
      logger.info("Finished 100% of regions!!\n\n")
    }
  }

  /**
   * Returns the set of all labels associated with the given user, in the format needed for clustering.
   * @param key A key used for authentication.
   * @param userId The user_id of the user whose labels should be retrieved.
   */
  def getUserLabelsToCluster(key: String, userId: String) = Action.async { implicit _ =>
    if (authenticate(key)) {
      apiService.getUserLabelsToCluster(userId).map(labels => Ok(Json.toJson(labels)))
    } else {
      Future.failed(new NotAuthorizedException("Could not authenticate with provided key."))
    }
  }

  /**
   * Returns the set of clusters from single-user clustering that are in this region as JSON.
   * @param key A key used for authentication.
   * @param regionId The region whose labels should be retrieved.
   */
  def getClusteredLabelsInRegion(key: String, regionId: Int) = Action.async { implicit _ =>
    if (authenticate(key)) {
      apiService.getClusteredLabelsInRegion(regionId).map { labels => Ok(Json.toJson(labels)) }
    } else {
      Future.failed(new NotAuthorizedException("Could not authenticate with provided key."))
    }
  }

  /**
   * Takes in results of single-user clustering, and adds the data in bulk to the relevant tables.
   *
   * NOTE The maxLength argument allows a 100MB max load size for the POST request.
   * TODO haven't tested that parse.json(maxLength = 1024 * 1024 * 100L) actually works.
   * @param key A key used for authentication.
   * @param userId The user_id address of the user whose labels were clustered.
   */
  def postSingleUserClusteringResults(key: String, userId: String) = Action.async(parse.json(maxLength = 1024 * 1024 * 100L)) { implicit request =>
    if (authenticate(key)) {
      val submission = request.body.validate[ClusteringSubmission]
      submission.fold(
        errors => {
          logger.warn("Failed to parse JSON POST request for single-user clustering results.")
          logger.info(Json.prettyPrint(request.body))
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
        },
        submission => {
          // Extract the thresholds, clusters, and labels, and put them into separate variables.
          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
          val clusters: Seq[ClusterSubmission] = submission.clusters
          val labels: Seq[ClusteredLabelSubmission] = submission.labels

          // Add all the new data into the db.
          apiService.submitSingleUserClusteringResults(userId, clusters, labels, thresholds).map { userSessionId =>
            Ok(Json.obj("session" -> userSessionId))
          }
        }
      )
    } else {
      Future.failed(new NotAuthorizedException("Could not authenticate with provided key."))
    }
  }

  /**
   * Takes in results of multi-user clustering, and adds the data in bulk to the relevant tables.
   *
   * NOTE The maxLength argument allows a 100MB max load size for the POST request.
   * TODO haven't tested that parse.json(maxLength = 1024 * 1024 * 100L) actually works.
   * @param key A key used for authentication.
   * @param regionId The region whose labels were clustered.
   */
  def postMultiUserClusteringResults(key: String, regionId: Int) = Action.async(parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
    if (authenticate(key)) {
      val submission = request.body.validate[ClusteringSubmission]
      submission.fold(
        errors => {
          logger.error("Failed to parse JSON POST request for multi-user clustering results.")
          logger.info(Json.prettyPrint(request.body))
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
        },
        submission => {
          // Extract the thresholds, clusters, and labels, and put them into separate variables.
          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
          val clusters: Seq[ClusterSubmission] = submission.clusters
          val userAttributes: Seq[ClusteredLabelSubmission] = submission.labels

          // Add all the new data into the db.
          apiService.submitMultiUserClusteringResults(regionId, clusters, userAttributes, thresholds).map { globalSessionId =>
            Ok(Json.obj("session" -> globalSessionId))
          }
        }
      )
    } else {
      Future.failed(new NotAuthorizedException("Could not authenticate with provided key."))
    }
  }
}
