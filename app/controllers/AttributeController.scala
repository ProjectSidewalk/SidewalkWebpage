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
import formats.json.AttributeFormats
import models.attribute._
import models.label.{LabelTable, LabelTypeTable}
import models.region.RegionTable
import play.api.Play.current
import play.api.{Logger, Play}

/**
 * Holds the HTTP requests associated with accessibility attributes and the label clustering used to create them.
 *
 * @param env The Silhouette environment.
 */
class AttributeController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Returns the clustering webpage with GUI if the user is an admin, otherwise redirects to the landing page.
   */
  def index = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      Future.successful(Ok(views.html.clustering("Project Sidewalk", request.identity)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
   * Checks if the user is an administrator.
   *
   * @return Boolean indicating if the user is an admin.
   */
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
   * Reads a key from env variable and compares against input key, returning true if they match.
   *
   * @return Boolean indicating whether the input key matches the true key.
   */
  def authenticate(key: String): Boolean = {
    key == Play.configuration.getString("internal-api-key").get
  }

  /**
   * Calls the appropriate clustering function(s); either single-user clustering, multi-user clustering, or both.
   *
   * @param clusteringType One of "singleUser", "multiUser", or "both".
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
   * Takes in results of single-user clustering, and adds the data in bulk to the relevant tables.
   *
   * NOTE The maxLength argument allows a 100MB max load size for the POST request.
   *
   * @param key A key used for authentication.
   * @param userId The user_id address of the user who's labels were clustered.
   */
  def postSingleUserClusteringResults(key: String, userId: String) = UserAwareAction.async(BodyParsers.parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
    if (authenticate(key)) {
      val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
      submission.fold(
        errors => {
          Logger.warn("Failed to parse JSON POST request for single-user clustering results.")
          Logger.info(Json.prettyPrint(request.body))
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
        },
        submission => {
          // Extract the thresholds, clusters, and labels, and put them into separate variables.
          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
          val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
          val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels

          // Add corresponding entry to the user_clustering_session table
          val timestamp = new Timestamp(Instant.now.toEpochMilli)
          val userSessionId: Int = UserClusteringSessionTable.save(UserClusteringSession(0, userId, timestamp))

          // Turn each cluster into a UserAttribute object.
          val userAttributes: List[UserAttribute] = clusters.map { c =>
            UserAttribute(
              userAttributeId = 0,
              userClusteringSessionId = userSessionId,
              clusteringThreshold = thresholds(c.labelType),
              labelTypeId = LabelTypeTable.labelTypeToId(c.labelType).get,
              regionId = RegionTable.selectRegionIdOfClosestNeighborhood(c.lng, c.lat),
              lat = c.lat,
              lng = c.lng,
              severity = c.severity,
              temporary = c.temporary
            )
          }

          // Bulk insert them, returning newly created IDs in the same order.
          val userAttrIds: Seq[Int] = UserAttributeTable.saveMultiple(userAttributes)

          // Map clusters to their new userAttributeId.
          val userAttrIdsMap: Map[Int, Int] = clusters.zip(userAttrIds).map { case (c, attrId) => (c.clusterNum, attrId) }.toMap

          val userAttributeLabels: List[UserAttributeLabel] =
            labels.map { label =>
              UserAttributeLabel(
                userAttributeLabelId = 0,
                userAttributeId = userAttrIdsMap(label.clusterNum),
                labelId = label.labelId
              )
            }

          // Bulk insert the label mappings.
          UserAttributeLabelTable.saveMultiple(userAttributeLabels)

          Future.successful(Ok(Json.obj("session" -> userSessionId)))
        }
      )
    } else {
      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
    }
  }

  /**
   * Takes in results of multi-user clustering, and adds the data in bulk to the relevant tables.
   *
   * NOTE The maxLength argument allows a 100MB max load size for the POST request.
   *
   * @param key A key used for authentication.
   * @param regionId The region who's labels were clustered.
   */
  def postMultiUserClusteringResults(key: String, regionId: Int) = UserAwareAction.async(BodyParsers.parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
    if (authenticate(key)) {
      // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
      val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
      submission.fold(
        errors => {
          Logger.error("Failed to parse JSON POST request for multi-user clustering results.")
          Logger.info(Json.prettyPrint(request.body))
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
        },
        submission => {
          // Extract the thresholds, clusters, and labels, and put them into separate variables.
          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
          val clusters: Seq[AttributeFormats.ClusterSubmission] = submission.clusters
          val userAttributes: Seq[AttributeFormats.ClusteredLabelSubmission] = submission.labels

          // Add corresponding entry to the global_clustering_session table.
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
          val globalSessionId: Int = GlobalClusteringSessionTable.save(GlobalClusteringSession(0, regionId, timestamp))

          // Turn each cluster into a GlobalAttribute object.
          val globalAttributes: Seq[GlobalAttribute] = clusters.map { cluster =>
            GlobalAttribute(
              globalAttributeId = 0,
              globalClusteringSessionId = globalSessionId,
              clusteringThreshold = thresholds(cluster.labelType),
              labelTypeId = LabelTypeTable.labelTypeToId(cluster.labelType).get,
              streetEdgeId = LabelTable.getStreetEdgeIdClosestToLatLng(cluster.lat, cluster.lng).get,
              regionId = RegionTable.selectRegionIdOfClosestNeighborhood(cluster.lng, cluster.lat),
              lat = cluster.lat,
              lng = cluster.lng,
              severity = cluster.severity,
              temporary = cluster.temporary
            )
          }

          // Bulk insert global attributes and return their newly created IDs in the same order.
          val globalAttrIds: Seq[Int] = GlobalAttributeTable.saveMultiple(globalAttributes)

          // Map clusters to their new globalAttributeId.
          val globalAttrIdsMap: Map[Int, Int] = clusters.zip(globalAttrIds).map { case (c, attrId) => (c.clusterNum, attrId) }.toMap

          // Add all the associated labels to the global_attribute_user_attribute table.
          val globalAttrUserAttrs: Seq[GlobalAttributeUserAttribute] =
            userAttributes.map { userAttribute =>
              GlobalAttributeUserAttribute(
                globalAttributeUserAttributeId = 0,
                globalAttributeId = globalAttrIdsMap(userAttribute.clusterNum),
                userAttributeId = userAttribute.labelId
              )
            }

          // Bulk insert global attribute user attributes and return their newly created IDs.
          GlobalAttributeUserAttributeTable.saveMultiple(globalAttrUserAttrs)

          Future.successful(Ok(Json.obj("session" -> globalSessionId)))
        }
      )
    } else {
      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
    }
  }
}
