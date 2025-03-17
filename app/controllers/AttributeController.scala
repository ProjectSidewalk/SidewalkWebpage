package controllers

import play.silhouette.api.actions.UserAwareRequest

import javax.inject.{Inject, Singleton}
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv

import controllers.helper.ControllerUtils.isAdmin
import controllers.base._
import play.api.Configuration
import play.api.libs.json._
import service.utils.ConfigService


import scala.concurrent.ExecutionContext
import controllers.helper.AttributeControllerHelper
import models.user.SidewalkUserWithRole

import scala.concurrent.Future
import play.api.mvc._
import play.api.libs.json.Json
import formats.json.AttributeFormats
import models.attribute._
import models.label.{LabelTable, LabelTypeTable}
import models.region.RegionTable
import play.api.{Logger, Play}

@Singleton
class AttributeController @Inject() (
                                      cc: CustomControllerComponents,
                                      val silhouette: Silhouette[DefaultEnv],
                                      val config: Configuration,
                                      configService: ConfigService
                                    )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config

  /**
    * Returns the clustering webpage with GUI if the user is an admin, otherwise redirects to the landing page.
    */
  def index = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    if (isAdmin(request.identity)) {
      cc.loggingService.insert(request.identity.get.userId, request.remoteAddress, "Visit_Clustering")

      configService.getCommonPageData(request2Messages.lang)
        .map(commonData => Ok(views.html.clustering(commonData, "Sidewalk - Clustering", request.identity.get)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Reads a key from env variable and compares against input key, returning true if they match.
    *
    * @return Boolean indicating whether the input key matches the true key.
    */
  def authenticate(key: String): Boolean = {
    key == config.get[String]("internal-api-key")
  }

  /**
    * Calls the appropriate clustering function(s); either single-user clustering, multi-user clustering, or both.
    *
    * @param clusteringType One of "singleUser", "multiUser", or "both".
    */
//  def runClustering(clusteringType: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    if (isAdmin(request.identity)) {
//      val json = AttributeControllerHelper.runClustering(clusteringType)
//      Future.successful(Ok(json))
//    } else {
//      Future.successful(Redirect("/"))
//    }
//  }

  /**
    * Returns the set of all labels associated with the given user, in the format needed for clustering.
    *
    * @param key A key used for authentication.
    * @param userId The user_id of the user who's labels should be retrieved.
    */
//  def getUserLabelsToCluster(key: String, userId: String) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//
//    val json = if (authenticate(key)) {
//      Json.arr(UserClusteringSessionTable.getUserLabelsToCluster(userId).map(_.toJSON))
//    } else {
//      Json.obj("error_msg" -> "Could not authenticate.")
//    }
//    Future.successful(Ok(json))
//  }

  /**
    * Returns the set of clusters from single-user clustering that are in this region as JSON.
    *
    * @param key A key used for authentication.
    * @param regionId The region who's labels should be retrieved.
    */
//  def getClusteredLabelsInRegion(key: String, regionId: Int) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val json = if (authenticate(key)) {
//      val labelsToCluster: List[LabelToCluster] = UserClusteringSessionTable.getClusteredLabelsInRegion(regionId)
//      Json.arr(labelsToCluster.map(_.toJSON))
//    } else {
//      Json.obj("error_msg" -> "Could not authenticate.")
//    }
//    Future.successful(Ok(json))
//  }

  /**
    * Takes in results of single-user clustering, and adds the data to the relevant tables.
    *
    * @param key A key used for authentication.
    * @param userId The user_id address of the user who's labels were clustered.
    */
  // TODO try parse.json.maxLength(100.megabytes) or parse.json(maxLength = 100.megabytes) or parse.json(maxLength = 1024 * 1024 * 100L)
//  def postSingleUserClusteringResults(key: String, userId: String) = silhouette.UserAwareAction.async(parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
//    // The maxLength argument above allows a 100MB max load size for the POST request.
//    if (authenticate(key)) {
//      // Validation https://www.playframework.com/documentation /2.3.x/ScalaJson
//      val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
//      submission.fold(
//        errors => {
//          Logger.warn("Failed to parse JSON POST request for single-user clustering results.")
//          Logger.info(Json.prettyPrint(request.body))
//          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//        },
//        submission => {
//          // Extract the thresholds, clusters, and labels, and put them into separate variables.
//          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
//          val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
//          val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels
//
//          // Group the labels by the cluster they were put into.
//          val groupedLabels: Map[Int, List[AttributeFormats.ClusteredLabelSubmission]] = labels.groupBy(_.clusterNum)
//          val timestamp: OffsetDateTime = OffsetDateTime.now
//
//          // Add corresponding entry to the user_clustering_session table
//          val userSessionId: Int = UserClusteringSessionTable.insert(UserClusteringSession(0, userId, timestamp))
//          // Add the clusters to user_attribute table, and the associated user_attribute_labels after each cluster.
//          for (cluster <- clusters) yield {
//            val attributeId: Int =
//              UserAttributeTable.insert(
//                UserAttribute(0,
//                  userSessionId,
//                  thresholds(cluster.labelType),
//                  LabelTypeTable.labelTypeToId(cluster.labelType).get,
//                  RegionTable.selectRegionIdOfClosestNeighborhood(cluster.lng, cluster.lat),
//                  cluster.lat,
//                  cluster.lng,
//                  cluster.severity,
//                  cluster.temporary
//                )
//              )
//            // Add all the labels associated with that user_attribute to the user_attribute_label table.
//            groupedLabels get cluster.clusterNum match {
//              case Some(group) =>
//                for (label <- group) yield {
//                  UserAttributeLabelTable.insert(UserAttributeLabel(0, attributeId, label.labelId))
//                }
//              case None =>
//                Logger.warn("Cluster sent with no accompanying labels. Seems wrong!")
//            }
//          }
//          Future.successful(Ok(Json.obj("session" -> userSessionId)))
//        }
//      )
//    } else {
//      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
//    }
//  }

  /**
    * Takes in results of multi-user clustering, and adds the data to the relevant tables.
    *
    * @param key A key used for authentication.
    * @param regionId The region who's labels were clustered.
    */
  // TODO try parse.json.maxLength(100.megabytes) or parse.json(maxLength = 100.megabytes) or parse.json(maxLength = 1024 * 1024 * 100L)
//  def postMultiUserClusteringResults(key: String, regionId: Int) = silhouette.UserAwareAction.async(parse.json(maxLength = 1024 * 1024 * 100)) {implicit request =>
//    // The maxLength argument above allows a 100MB max load size for the POST request.
//    if (authenticate(key)) {
//      // Validation https://www.playframework.com/documentation /2.3.x/ScalaJson
//      val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
//      submission.fold(
//        errors => {
//          Logger.error("Failed to parse JSON POST request for multi-user clustering results.")
//          Logger.info(Json.prettyPrint(request.body))
//          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//        },
//        submission => {
//          // Extract the thresholds, clusters, and labels, and put them into separate variables.
//          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
//          val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
//          val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels
//
//          // Group the labels by the cluster they were put into.
//          val groupedLabels: Map[Int, List[AttributeFormats.ClusteredLabelSubmission]] = labels.groupBy(_.clusterNum)
//          val timestamp: OffsetDateTime = OffsetDateTime.now
//
//          // Add corresponding entry to the global_clustering_session table
//          val globalSessionId: Int = GlobalClusteringSessionTable.insert(GlobalClusteringSession(0, regionId, timestamp))
//
//          // Add the clusters to global_attribute table, and the associated user_attributes after each cluster.
//          for (cluster <- clusters) yield {
//            val attributeId: Int =
//              GlobalAttributeTable.insert(
//                GlobalAttribute(0,
//                  globalSessionId,
//                  thresholds(cluster.labelType),
//                  LabelTypeTable.labelTypeToId(cluster.labelType).get,
//                  LabelTable.getStreetEdgeIdClosestToLatLng(cluster.lat, cluster.lng).get,
//                  RegionTable.selectRegionIdOfClosestNeighborhood(cluster.lng, cluster.lat),
//                  cluster.lat,
//                  cluster.lng,
//                  cluster.severity,
//                  cluster.temporary)
//              )
//            // Add all the associated labels to the global_attribute_user_attribute table.
//            groupedLabels get cluster.clusterNum match {
//              case Some(group) =>
//                for (label <- group) yield {
//                  GlobalAttributeUserAttributeTable.insert(GlobalAttributeUserAttribute(0, attributeId, label.labelId))
//                }
//              case None =>
//                Logger.warn("Cluster sent with no accompanying labels. Seems wrong!")
//            }
//          }
//          Future.successful(Ok(Json.obj("session" -> globalSessionId)))
//        }
//      )
//    } else {
//      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
//    }
//  }
}
