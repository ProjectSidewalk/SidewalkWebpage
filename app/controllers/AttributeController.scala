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
import play.api.db.DB
import play.api.{Logger, Play}
import anorm._
import anorm.SqlParser._



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
    * Takes in results of single-user clustering, and adds the data to the relevant tables.
    *
    * @param key A key used for authentication.
    * @param userId The user_id address of the user whose labels were clustered.
    */
  def postSingleUserClusteringResults(key: String, userId: String) =
    UserAwareAction.async(BodyParsers.parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
      // The maxLength argument above allows a 100MB max load size for  the POST request.
      if (authenticate(key)) {
        // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
        val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
        submission.fold(
          errors => {
            Logger.warn("Failed to parse JSON POST request for single-user clustering results.")
            Logger.info(Json.prettyPrint(request.body))
            Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
          },
          submission => {
            // Extract the thresholds, clusters, and labels, and put them into seperate variables.
            val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
            val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
            val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels

            // Group the labels by the cluster they were put into
            val groupedLabels: Map[Int, List[AttributeFormats.ClusteredLabelSubmission]] = labels.groupBy(_.clusterNum)
            val timestamp = new Timestamp(Instant.now.toEpochMilli)

            // This is the new user_clustering_session entry
            val userSessionId: Int = UserClusteringSessionTable.save(UserClusteringSession(0, userId, timestamp))

            // Gotta insert all the user_attributes in one pass to speed things up
            DB.withConnection { implicit conn =>
              val rowPlaceholder = "(?,?,?,?,?,?,?,?)"
              val allPlaceholders = clusters.map(_ => rowPlaceholder).mkString(", ")

              val insertSql =
                s"""
                   INSERT INTO user_attribute (
                     user_clustering_session_id,
                     clustering_threshold,
                     label_type_id,
                     region_id,
                     lat,
                     lng,
                     severity,
                     temporary
                   )
                   VALUES $allPlaceholders
                   RETURNING user_attribute_id
                 """

              val stmt = conn.prepareStatement(insertSql)
              var paramIndex = 1

              // Fill placeholders with cluster data
              clusters.foreach { c =>
                stmt.setInt(paramIndex, userSessionId)
                paramIndex += 1
                stmt.setFloat(paramIndex, thresholds(c.labelType))
                paramIndex += 1
                val labelTypeId = LabelTypeTable.labelTypeToId(c.labelType).get
                stmt.setInt(paramIndex, labelTypeId)
                paramIndex += 1
                val regionId = RegionTable.selectRegionIdOfClosestNeighborhood(c.lng, c.lat)
                stmt.setInt(paramIndex, regionId)
                paramIndex += 1
                stmt.setDouble(paramIndex, c.lat.toDouble)
                paramIndex += 1
                stmt.setDouble(paramIndex, c.lng.toDouble)
                paramIndex += 1
                c.severity match {
                  case Some(sv) => stmt.setInt(paramIndex, sv)
                  case None     => stmt.setNull(paramIndex, java.sql.Types.INTEGER)
                }
                paramIndex += 1
                stmt.setBoolean(paramIndex, c.temporary)
                paramIndex += 1
              }

              val rs = stmt.executeQuery()
              val newUserAttrIds = collection.mutable.ArrayBuffer[Int]()
              while (rs.next()) {
                newUserAttrIds.append(rs.getInt("user_attribute_id"))
              }
              rs.close()
              stmt.close()

              // Pair up each cluster with its labels
              val labelTuples = clusters.zip(newUserAttrIds).flatMap { case (c, attrId) =>
                groupedLabels.getOrElse(c.clusterNum, Nil).map { lbl =>
                  (attrId, lbl.labelId)
                }
              }

              // Insert all user_attribute_label rows at once
              if (labelTuples.nonEmpty) {
                val rowPlaceholder2 = "(?,?)"
                val all2 = labelTuples.map(_ => rowPlaceholder2).mkString(", ")
                val insertLabelSql =
                  s"""
                     INSERT INTO user_attribute_label (
                       user_attribute_id,
                       label_id
                     )
                     VALUES $all2
                   """
                val stmt2 = conn.prepareStatement(insertLabelSql)
                var i2 = 1

                labelTuples.foreach { case (attrId, lblId) =>
                  stmt2.setInt(i2, attrId)
                  i2 += 1
                  stmt2.setInt(i2, lblId)
                  i2 += 1
                }

                stmt2.executeUpdate()
                stmt2.close()
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
    * @param regionId The region whose labels were clustered.
    */
  def postMultiUserClusteringResults(key: String, regionId: Int) =
    UserAwareAction.async(BodyParsers.parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
      // We keep the 100MB note: The maxLength argument above allows a 100MB max load size for the POST request.
      if (authenticate(key)) {
        val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
        submission.fold(
          errors => {
            Logger.error("Failed to parse JSON POST request for multi-user clustering results.")
            Logger.info(Json.prettyPrint(request.body))
            Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
          },
          submission => {
            val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
            val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
            val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels

            val groupedLabels: Map[Int, List[AttributeFormats.ClusteredLabelSubmission]] = labels.groupBy(_.clusterNum)
            val timestamp = new Timestamp(Instant.now.toEpochMilli)

            // This new approach also creates an entry in global_clustering_session
            val globalSessionId: Int =
              GlobalClusteringSessionTable.save(GlobalClusteringSession(0, regionId, timestamp))

            // Do all the inserts for global_attribute in a single statement
            DB.withConnection { implicit conn =>
              val rowPlaceholder = "(?,?,?,?,?,?,?,?,?)"
              val allPlaceholders = clusters.map(_ => rowPlaceholder).mkString(", ")

              val insertSql =
                s"""
                   INSERT INTO global_attribute (
                     global_clustering_session_id,
                     clustering_threshold,
                     label_type_id,
                     street_edge_id,
                     region_id,
                     lat,
                     lng,
                     severity,
                     temporary
                   )
                   VALUES $allPlaceholders
                   RETURNING global_attribute_id
                 """

              val stmt = conn.prepareStatement(insertSql)
              var idx = 1

              clusters.foreach { c =>
                stmt.setInt(idx, globalSessionId)
                idx += 1
                stmt.setFloat(idx, thresholds(c.labelType))
                idx += 1
                val labelTypeId = LabelTypeTable.labelTypeToId(c.labelType).get
                stmt.setInt(idx, labelTypeId)
                idx += 1
                val streetEdgeId = LabelTable.getStreetEdgeIdClosestToLatLng(c.lat, c.lng).get
                stmt.setInt(idx, streetEdgeId)
                idx += 1
                val regionVal = RegionTable.selectRegionIdOfClosestNeighborhood(c.lng, c.lat)
                stmt.setInt(idx, regionVal)
                idx += 1
                stmt.setDouble(idx, c.lat.toDouble)
                idx += 1
                stmt.setDouble(idx, c.lng.toDouble)
                idx += 1
                c.severity match {
                  case Some(sv) => stmt.setInt(idx, sv)
                  case None     => stmt.setNull(idx, java.sql.Types.INTEGER)
                }
                idx += 1
                stmt.setBoolean(idx, c.temporary)
                idx += 1
              }

              val rs = stmt.executeQuery()
              val newGlobalAttrIds = collection.mutable.ArrayBuffer[Int]()
              while (rs.next()) {
                newGlobalAttrIds.append(rs.getInt("global_attribute_id"))
              }
              rs.close()
              stmt.close()

              // Link global_attribute IDs to user_attributes
              val linkTuples = clusters.zip(newGlobalAttrIds).flatMap { case (c, globAttrId) =>
                groupedLabels.getOrElse(c.clusterNum, Nil).map { lbl =>
                  (globAttrId, lbl.labelId)
                }
              }

              // Insert all global_attribute_user_attribute rows in bulk
              if (linkTuples.nonEmpty) {
                val rowPlaceholder2 = "(?,?)"
                val all2 = linkTuples.map(_ => rowPlaceholder2).mkString(", ")
                val insertLinkSql =
                  s"""
                     INSERT INTO global_attribute_user_attribute (
                       global_attribute_id,
                       user_attribute_id
                     )
                     VALUES $all2
                   """
                val stmt2 = conn.prepareStatement(insertLinkSql)
                var i2 = 1

                linkTuples.foreach { case (gAttrId, userAttrId) =>
                  stmt2.setInt(i2, gAttrId)
                  i2 += 1
                  stmt2.setInt(i2, userAttrId)
                  i2 += 1
                }

                stmt2.executeUpdate()
                stmt2.close()
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
