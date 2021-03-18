package controllers.helper

import models.attribute.{GlobalAttributeTable, GlobalClusteringSessionTable, UserAttributeLabelTable, UserAttributeTable, UserClusteringSessionTable}
import models.user.UserStatTable
import play.api.{Logger, Play}
import play.api.Play.current
import play.api.libs.json.Json
import java.sql.Timestamp
import java.time.Instant
import scala.collection.immutable.Seq
import scala.sys.process._

object AttributeControllerHelper {
  /**
   * Calls the appropriate clustering function(s); either single-user clustering, multi-user clustering, or both.
   *
   * @param clusteringType One of "singleUser", "multiUser", or "both".
   * @param cutoffTime Only cluster users who have placed a label since this time. Defaults to all time.
   * @return Counts of attributes and the labels that were clustered into those attributes in JSON.
   */
  def runClustering(clusteringType: String, cutoffTime: Timestamp = new Timestamp(Instant.EPOCH.toEpochMilli)) = {
    if (clusteringType == "singleUser" || clusteringType == "both") {
      runSingleUserClustering(cutoffTime)
    }
    if (clusteringType == "multiUser" || clusteringType == "both") {
      runMultiUserClustering()
    }

    // Gets the counts of labels/attributes from the affected tables to show how many clusters were created.
    val json = clusteringType match {
      case "singleUser" => Json.obj(
        "user_labels" -> UserAttributeLabelTable.countUserAttributeLabels,
        "user_attributes" -> UserAttributeTable.countUserAttributes
      )
      case "multiUser" => Json.obj(
        "user_attributes" -> UserAttributeTable.countUserAttributes,
        "global_attributes" -> GlobalAttributeTable.countGlobalAttributes
      )
      case "both" => Json.obj(
        "user_labels" -> UserAttributeLabelTable.countUserAttributeLabels,
        "user_attributes" -> UserAttributeTable.countUserAttributes,
        "global_attributes" -> GlobalAttributeTable.countGlobalAttributes
      )
      case _ => Json.obj("error_msg" -> "Invalid clusteringType")
    }
    json
  }

  /**
   * Runs single user clustering for each high quality user who has placed a label since `cutoffTime`.
   */
  def runSingleUserClustering(cutoffTime: Timestamp) = {
    val key: String = Play.configuration.getString("internal-api-key").get

    // Get list of users who's data we want to delete or re-cluster (or cluster for the first time).
    val goodUsersToUpdate: List[String] = UserStatTable.getIdsOfGoodUsersWithLabels(cutoffTime)
    val newBadUsers: List[String] = UserStatTable.getIdsOfNewlyLowQualityUsers
    val usersToDelete: List[String] = (goodUsersToUpdate ++ newBadUsers).distinct

    // Delete data from users we want to delete or re-cluster.
    UserClusteringSessionTable.deleteUsersClusteringSessions(usersToDelete)

    val nUsers = goodUsersToUpdate.length
    Logger.info("N users = " + nUsers)

    // Run clustering for each user that we are re-clustering.
    for ((userId, i) <- goodUsersToUpdate.view.zipWithIndex) {
      Logger.info(s"Finished ${f"${100.0 * i / nUsers}%1.2f"}% of users, next: $userId.")
      val clusteringOutput =
        Seq("python", "label_clustering.py", "--key", key, "--user_id", userId).!!
      // Logger.info(clusteringOutput)
    }
    Logger.info("Finshed 100% of users!!\n")
  }

  /**
    * Runs multi user clustering for the user attributes in each region.
    */
  def runMultiUserClustering() = {
    val key: String = Play.configuration.getString("internal-api-key").get

    // Get the list of neighborhoods that need to be updated because the underlying users' clusters changed.
    val regionIds: List[Int] = GlobalClusteringSessionTable.getNeighborhoodsToReCluster

    // Delete the data for those regions.
    GlobalClusteringSessionTable.deleteGlobalClusteringSessions(regionIds)
    val nRegions: Int = regionIds.length
    Logger.info("N regions = " + nRegions)

    // Runs multi-user clustering within each region.
    for ((regionId, i) <- regionIds.view.zipWithIndex) {
      Logger.info(s"Finished ${f"${100.0 * i / nRegions}%1.2f"}% of regions, next: $regionId.")
      val clusteringOutput = Seq("python", "label_clustering.py", "--key", key, "--region_id", regionId.toString).!!
    }
    Logger.info("Finshed 100% of regions!!\n\n")
  }
}
