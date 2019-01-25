package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.User

import scala.sys.process._
import play.api.mvc._
import play.api.mvc.Results._
import play.api.libs.json.Json
import formats.json.AttributeFormats
import models.attribute._
import models.label.LabelTypeTable
import models.region.RegionTable
import models.street.StreetEdgePriorityTable
import org.joda.time.{ DateTime, DateTimeZone }
import play.api.Logger

import collection.immutable.Seq
import scala.io.Source

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class AttributeController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Returns the clustering webpage with GUI if the user is an admin, otherwise redirects to the landing page.
   *
   * @return
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
    val trueKey: Option[String] = readKeyFile()
    if (trueKey.isDefined) trueKey.get == key else false
  }

  /**
   * Reads a key from a file and returns it.
   *
   * @return If read is successful, then the Option(key) is returned, otherwise None
   */
  def readKeyFile(): Option[String] = {
    val bufferedSource = Source.fromFile("special_api_key.txt")
    val lines = bufferedSource.getLines()
    val key: Option[String] = if (lines.hasNext) Some(lines.next()) else None
    bufferedSource.close
    key
  }

  /**
   * Calls the appropriate clustering function(s); either single-user clustering, multi-user clustering, or both.
   *
   * @param clusteringType One of "singleUser", "multiUser", or "both".
   * @return
   */
  def runClustering(clusteringType: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      // pre-operations
      var runSingleUserClusteringAllUsersFuture: Future[Any] = Future.successful(0)
      var runMultiUserClusteringAllRegionsFuture: Future[Any] = Future.successful(0)

      if (clusteringType == "singleUser" || clusteringType == "both") {
        runSingleUserClusteringAllUsersFuture = runSingleUserClusteringAllUsers()
      }
      if (clusteringType == "multiUser" || clusteringType == "both") {
        runMultiUserClusteringAllRegionsFuture = runMultiUserClusteringAllRegions()
      }

      (for {
        _ <- runSingleUserClusteringAllUsersFuture
        _ <- runMultiUserClusteringAllRegionsFuture
      } yield 1).flatMap { _ =>
        // Gets the counts of labels/attributes from the affected tables to show how many clusters were created.
        clusteringType match {
          case "singleUser" => for {
            userLabs <- UserAttributeLabelTable.countUserAttributeLabels
            userAtts <- UserAttributeTable.countUserAttributes
          } yield { Ok(Json.obj("user_labels" -> userLabs, "user_attributes" -> userAtts)) }
          case "multiUser" => for {
            userAtts <- UserAttributeTable.countUserAttributes
            globalAtts <- GlobalAttributeTable.countGlobalAttributes
          } yield { Ok(Json.obj("user_attributes" -> userAtts, "global_attributes" -> globalAtts)) }
          case "both" => for {
            userLabs <- UserAttributeLabelTable.countUserAttributeLabels
            userAtts <- UserAttributeTable.countUserAttributes
            globalAtts <- GlobalAttributeTable.countGlobalAttributes
          } yield {
            Ok(Json.obj("user_labels" -> userLabs, "user_attributes" -> userAtts, "global_attributes" -> globalAtts))
          }
          case _ => Future(Ok(Json.obj("error_msg" -> "Invalid clusteringType")))
        }
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
   * Runs single user clustering for each high quality user.
   *
   * @return
   */
  def runSingleUserClusteringAllUsers(): Future[Any] = {

    // First truncate the user_clustering_session, user_attribute, and user_attribute_label tables
    UserClusteringSessionTable.truncateTables().flatMap { _ =>
      // Read key from keyfile. If we aren't able to read it, we can't do anything :(
      val maybeKey: Option[String] = readKeyFile()

      if (maybeKey.isDefined) {
        StreetEdgePriorityTable.getIdsOfGoodUsers.map { goodUsers =>
          val key: String = maybeKey.get
          //      val goodUsers: List[String] = List("9efaca05-53bb-492e-83ab-2b47219ee863") // Test users with a lot of labels
          //      val goodUsers: List[String] = List("53b4a67b-614e-432d-9bfa-8a97e081fea5") // Test users with fewer labels
          val nUsers = goodUsers.length
          println("N users = " + nUsers)

          // Runs clustering for each good user.
          for ((userId, i) <- goodUsers.view.zipWithIndex) {
            println(s"Finished ${f"${100.0 * i / nUsers}%1.2f"}% of users, next: $userId.")
            val clusteringOutput =
              Seq("python", "label_clustering.py", "--key", key, "--user_id", userId).!!
            //      println(clusteringOutput)
          }
          println("\nFinshed 100% of users!!\n")
          Future.successful(0)
        }
      } else {
        println("Could not read keyfile, so nothing happened :(")
        Future.successful(0)
      }
    }
  }

  /**
   * Runs multi user clustering for the user attributes in each region.
   *
   * @return
   */
  def runMultiUserClusteringAllRegions(): Future[Any] = {

    // First truncate the global_clustering_session, global_attribute, and global_attribute_user_attribute tables.
    GlobalClusteringSessionTable.truncateTables().flatMap { _ =>
      // Read key from keyfile. If we aren't able to read it, we can't do anything :(
      val maybeKey: Option[String] = readKeyFile()

      if (maybeKey.isDefined) {
        RegionTable.selectAllNeighborhoods.flatMap { neighborhoods =>
          val key: String = maybeKey.get
          val regionIds: List[Int] = neighborhoods.map(_.regionId).sortBy(x => x)
          //    val regionIds = List(199, 200, 203, 211, 261) // Small test set.
          val nRegions: Int = regionIds.length

          // Runs multi-user clustering within each region.
          for ((regionId, i) <- regionIds.view.zipWithIndex) {
            println(s"Finished ${f"${100.0 * i / nRegions}%1.2f"}% of regions, next: $regionId.")
            val clusteringOutput = Seq("python", "label_clustering.py", "--key", key, "--region_id", regionId.toString).!!
          }
          println("\nFinshed 100% of regions!!\n\n")
          Future.successful(0)
        }
      } else {
        println("Could not read keyfile, so nothing happened :(")
        Future.successful(0)
      }
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

    if (authenticate(key)) {
      UserClusteringSessionTable.getUserLabelsToCluster(userId) map { labelsToCluster =>
        Ok(Json.arr(labelsToCluster.map(_.toJSON)))
      }
    } else {
      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
    }
  }

  /**
   * Returns the set of clusters from single-user clustering that are in this region as JSON.
   *
   * @param key A key used for authentication.
   * @param regionId The region who's labels should be retrieved.
   * @return
   */
  def getClusteredLabelsInRegion(key: String, regionId: Int) = UserAwareAction.async { implicit request =>
    if (authenticate(key)) {
      UserClusteringSessionTable.getClusteredLabelsInRegion(regionId) map { labelsToCluster =>
        Ok(Json.arr(labelsToCluster.map(_.toJSON)))
      }
    } else {
      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
    }
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
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
        },
        submission => {
          // Extract the thresholds, clusters, and labels, and put them into separate variables.
          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
          val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
          val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels

          // Group the labels by the cluster they were put into.
          val groupedLabels: Map[Int, List[AttributeFormats.ClusteredLabelSubmission]] = labels.groupBy(_.clusterNum)
          val now = new DateTime(DateTimeZone.UTC)
          val timestamp: Timestamp = new Timestamp(now.getMillis)

          // Add corresponding entry to the user_clustering_session table
          UserClusteringSessionTable.save(UserClusteringSession(0, userId, timestamp)) flatMap { userSessionId =>
            // Add the clusters to user_attribute table, and the associated user_attribute_labels after each cluster.
            val userAttributeSaves =
              for (cluster <- clusters) yield {
                (for {
                  labelTypeId <- LabelTypeTable.labelTypeToId(cluster.labelType)
                  regionId <- RegionTable.selectRegionIdOfClosestNeighborhood(cluster.lng, cluster.lat)
                } yield (labelTypeId, regionId)).flatMap {
                  case (labelTypeId, regionId) =>
                    UserAttributeTable.save(
                      UserAttribute(
                        0,
                        userSessionId,
                        thresholds(cluster.labelType),
                        labelTypeId,
                        regionId,
                        cluster.lat,
                        cluster.lng,
                        cluster.severity,
                        cluster.temporary)).flatMap { attributeId =>
                        // Add all the labels associated with that user_attribute to the user_attribute_label table
                        groupedLabels get cluster.clusterNum match {
                          case Some(group) =>
                            val userAttributeLabelSaves = for (label <- group) yield {
                              UserAttributeLabelTable.save(UserAttributeLabel(0, attributeId, label.labelId))
                            }
                            Future.sequence(userAttributeLabelSaves)
                          case None =>
                            Logger.warn("Cluster sent with no accompanying labels. Seems wrong!")
                            Future.successful(Nil)
                        }
                      }
                }
              }

            Future.sequence(userAttributeSaves).map(_ =>
              Ok(Json.obj("session" -> userSessionId)))
          }
        })
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
  def postMultiUserClusteringResults(key: String, regionId: Int) = UserAwareAction.async(BodyParsers.parse.json(maxLength = 1024 * 1024 * 100)) { implicit request =>
    // The maxLength argument above allows a 100MB max load size for the POST request.
    if (authenticate(key)) {
      // Validation https://www.playframework.com/documentation /2.3.x/ScalaJson
      val submission = request.body.validate[AttributeFormats.ClusteringSubmission]
      submission.fold(
        errors => {
          println("Failed to parse JSON POST request for multi-user clustering results.")
          println(Json.prettyPrint(request.body))
          Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
        },
        submission => {
          // Extract the thresholds, clusters, and labels, and put them into separate variables.
          val thresholds: Map[String, Float] = submission.thresholds.map(t => (t.labelType, t.threshold)).toMap
          val clusters: List[AttributeFormats.ClusterSubmission] = submission.clusters
          val labels: List[AttributeFormats.ClusteredLabelSubmission] = submission.labels

          // Group the labels by the cluster they were put into.
          val groupedLabels: Map[Int, List[AttributeFormats.ClusteredLabelSubmission]] = labels.groupBy(_.clusterNum)
          val now = new DateTime(DateTimeZone.UTC)
          val timestamp: Timestamp = new Timestamp(now.getMillis)

          // Add corresponding entry to the global_clustering_session table
          GlobalClusteringSessionTable.save(GlobalClusteringSession(0, regionId, timestamp)).flatMap {
            globalSessionId =>
              // Add the clusters to global_attribute table, and the associated user_attributes after each cluster.
              val userAttributeSaves =
                for (cluster <- clusters) yield {
                  (for {
                    labelTypeId <- LabelTypeTable.labelTypeToId(cluster.labelType)
                    regionId <- RegionTable.selectRegionIdOfClosestNeighborhood(cluster.lng, cluster.lat)
                  } yield (labelTypeId, regionId)).flatMap {
                    case (labelTypeId, regionId) =>
                      GlobalAttributeTable.save(
                        GlobalAttribute(
                          0,
                          globalSessionId,
                          thresholds(cluster.labelType),
                          labelTypeId,
                          regionId,
                          cluster.lat,
                          cluster.lng,
                          cluster.severity,
                          cluster.temporary)).flatMap { attributeId =>
                          // Add all the associated labels to the global_attribute_user_attribute table
                          groupedLabels get cluster.clusterNum match {
                            case Some(group) =>
                              val userAttributeLabelSaves = for (label <- group) yield {
                                GlobalAttributeUserAttributeTable.save(GlobalAttributeUserAttribute(0, attributeId, label.labelId))
                              }
                              Future.sequence(userAttributeLabelSaves)
                            case None =>
                              Logger.warn("Cluster sent with no accompanying labels. Seems wrong!")
                              Future.successful(Nil)
                          }
                        }
                  }
                }

              Future.sequence(userAttributeSaves).map(_ =>
                Ok(Json.obj("session" -> globalSessionId)))
          }
        })
    } else {
      Future.successful(Ok(Json.obj("error_msg" -> "Could not authenticate.")))
    }
  }
}
