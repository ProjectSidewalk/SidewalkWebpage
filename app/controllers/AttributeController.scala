package controllers

import java.sql.Timestamp
import java.time.Instant
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import controllers.helper.AttributeControllerHelper
import models.user.User

import scala.concurrent.Future
import play.api.mvc._
import play.api.libs.json.Json
import play.api.Play.current
import play.api.Play
import formats.json.AttributeFormats
import models.attribute._
import models.label.LabelTypeTable
import models.region.RegionTable
import play.api.Logger

class AttributeController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * Returns the clustering webpage with GUI if the user is an admin, otherwise redirects to the landing page.
    *
    * @return
    */
  def index = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val cityStr: String = Play.configuration.getString("city-id").get
      Future.successful(Ok(views.html.clustering("Project Sidewalk", request.identity, cityStr)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Checks if the user is an administrator.
    *
    * @param user
    * @return Boolean indicating if the user is an admin.
   */
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
    * Reads a key from a file and compares against input key, returning true if they match.
    *
    * @param key
    *
    * @return Boolean indicating whether the input key matches the true key.
    */
  def authenticate(key: String): Boolean = {
    val trueKey: Option[String] = AttributeControllerHelper.readKeyFile()
    if (trueKey.isDefined) trueKey.get == key else false
  }

  /**
    * Calls the appropriate clustering function(s); either single-user clustering, multi-user clustering, or both.
    *
    * @param clusteringType One of "singleUser", "multiUser", or "both".
    * @return
    */
  def runClustering(clusteringType: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val json = AttributeControllerHelper.runClustering(clusteringType)
      Future.successful(Ok(json))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Returns the set of all labels associated with the given user, in the format needed for clustering.
    *
    * @param key A key used for authentication.
    * @param userId The user_id of the user who's labels should be retrieved.
    * @return
    */
  def getUserLabelsToCluster(key: String, userId: String) = UserAwareAction.async { implicit request =>

    val json = if (authenticate(key)) {
      Json.arr(UserClusteringSessionTable.getUserLabelsToCluster(userId).map(_.toJSON))
    } else {
      Json.obj("error_msg" -> "Could not authenticate.")
    }
    Future.successful(Ok(json))
  }

  /**
    * Returns the set of clusters from single-user clustering that are in this region as JSON.
    *
    * @param key A key used for authentication.
    * @param regionId The region who's labels should be retrieved.
    * @return
    */
  def getClusteredLabelsInRegion(key: String, regionId: Int) = UserAwareAction.async { implicit request =>
    val json = if (authenticate(key)) {
      val labelsToCluster: List[LabelToCluster] = UserClusteringSessionTable.getClusteredLabelsInRegion(regionId)
      Json.arr(labelsToCluster.map(_.toJSON))
    } else {
      Json.obj("error_msg" -> "Could not authenticate.")
    }
    Future.successful(Ok(json))
  }

  /**
    * Takes in results of single-user clustering, and adds the data to the relevant tables.
    *
    * @param key A key used for authentication.
    * @param userId The user_id address of the user who's labels were clustered.
    * @return
    */
  def postSingleUserClusteringResults(key: String, userId: String) = UserAwareAction.async(BodyParsers.parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
    // The maxLength argument above allows a 100MB max load size for the POST request.
    if (authenticate(key)) {
      // Validation https://www.playframework.com/documentation /2.3.x/ScalaJson
      val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
      submission.fold(
        errors => {
          println("Failed to parse JSON POST request for multi-user clustering results.")
          println(Json.prettyPrint(request.body))
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
        },
        submission => {
          // Extract the thresholds, clusters, and labels, and put them into separate variables.
          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
          val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
          val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels

          // Group the labels by the cluster they were put into.
          val groupedLabels: Map[Int, List[AttributeFormats.ClusteredLabelSubmission]] = labels.groupBy(_.clusterNum)
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

          // Add corresponding entry to the user_clustering_session table
          val userSessionId: Int = UserClusteringSessionTable.save(UserClusteringSession(0, userId, timestamp))
          // Add the clusters to user_attribute table, and the associated user_attribute_labels after each cluster.
          for (cluster <- clusters) yield {
            val attributeId: Int =
              UserAttributeTable.save(
                UserAttribute(0,
                  userSessionId,
                  thresholds(cluster.labelType),
                  LabelTypeTable.labelTypeToId(cluster.labelType),
                  RegionTable.selectRegionIdOfClosestNeighborhood(cluster.lng, cluster.lat),
                  cluster.lat,
                  cluster.lng,
                  cluster.severity,
                  cluster.temporary
                )
              )
            // Add all the labels associated with that user_attribute to the user_attribute_label table
            groupedLabels get cluster.clusterNum match {
              case Some(group) =>
                for (label <- group) yield {
                  UserAttributeLabelTable.save(UserAttributeLabel(0, attributeId, label.labelId))
                }
              case None =>
                Logger.warn("Cluster sent with no accompanying labels. Seems wrong!")
            }
          }
          Future.successful(Ok(Json.obj("session" -> userSessionId)))
        }
      )
    } else {
      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
    }
  }

  /**
    * Takes in results of multi-user clustering, and adds the data to the relevant tables.
    *
    * @param key A key used for authentication.
    * @param regionId The region who's labels were clustered.
    * @return
    */
  def postMultiUserClusteringResults(key: String, regionId: Int) = UserAwareAction.async(BodyParsers.parse.json(maxLength = 1024 * 1024 * 100)) {implicit request =>
    // The maxLength argument above allows a 100MB max load size for the POST request.
    if (authenticate(key)) {
      // Validation https://www.playframework.com/documentation /2.3.x/ScalaJson
      val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
      submission.fold(
        errors => {
          println("Failed to parse JSON POST request for multi-user clustering results.")
          println(Json.prettyPrint(request.body))
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
        },
        submission => {
          // Extract the thresholds, clusters, and labels, and put them into separate variables.
          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
          val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
          val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels

          // Group the labels by the cluster they were put into.
          val groupedLabels: Map[Int, List[AttributeFormats.ClusteredLabelSubmission]] = labels.groupBy(_.clusterNum)
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

          // Add corresponding entry to the global_clustering_session table
          val globalSessionId: Int = GlobalClusteringSessionTable.save(GlobalClusteringSession(0, regionId, timestamp))

          // Add the clusters to global_attribute table, and the associated user_attributes after each cluster.
          for (cluster <- clusters) yield {
            val attributeId: Int =
              GlobalAttributeTable.save(
                GlobalAttribute(0,
                  globalSessionId,
                  thresholds(cluster.labelType),
                  LabelTypeTable.labelTypeToId(cluster.labelType),
                  RegionTable.selectRegionIdOfClosestNeighborhood(cluster.lng, cluster.lat),
                  cluster.lat,
                  cluster.lng,
                  cluster.severity,
                  cluster.temporary)
              )
            // Add all the associated labels to the global_attribute_user_attribute table
            groupedLabels get cluster.clusterNum match {
              case Some(group) =>
                for (label <- group) yield {
                  GlobalAttributeUserAttributeTable.save(GlobalAttributeUserAttribute(0, attributeId, label.labelId))
                }
              case None =>
                Logger.warn("Cluster sent with no accompanying labels. Seems wrong!")
            }
          }
          Future.successful(Ok(Json.obj("session" -> globalSessionId)))
        }
      )
    } else {
      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
    }
  }
}
