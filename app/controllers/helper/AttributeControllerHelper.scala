package controllers.helper

import models.attribute.{GlobalAttributeTable, GlobalClusteringSessionTable, UserAttributeLabelTable, UserAttributeTable, UserClusteringSessionTable}
import models.region.RegionTable
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
    val t1 = System.nanoTime
    val goodUsersToUpdate: List[String] = UserStatTable.getIdsOfGoodUsersWithLabels(cutoffTime)
    val t2 = System.nanoTime
    val newBadUsers: List[String] = UserStatTable.getIdsOfNewlyLowQualityUsers
    val t3 = System.nanoTime
    val usersToDelete: List[String] = (goodUsersToUpdate ++ newBadUsers).distinct
    println(s"Good users to update: ${goodUsersToUpdate.length}")
    println(s"Bad users to remove: ${newBadUsers.length}")
    // First truncate the user_clustering_session, user_attribute, and user_attribute_label tables.
//    UserClusteringSessionTable.truncateTables()
    UserClusteringSessionTable.deleteUsersClusteringSessions(usersToDelete)
    val t4 = System.nanoTime

    val key: String = Play.configuration.getString("internal-api-key").get
    val t5 = System.nanoTime
    val nUsers = goodUsersToUpdate.length
    Logger.info("N users = " + nUsers)

    // Runs clustering for each good user.
    for ((userId, i) <- goodUsersToUpdate.view.zipWithIndex) {
      Logger.info(s"Finished ${f"${100.0 * i / nUsers}%1.2f"}% of users, next: $userId.")
      val clusteringOutput =
        Seq("python", "label_clustering.py", "--key", key, "--user_id", userId).!!
      // Logger.info(clusteringOutput)
    }
    val t6 = System.nanoTime
    Logger.info("\nFinshed 100% of users!!\n")
    println(s"good user query time: ${(t2 - t1) / 1e9d}s")
    println(s"bad user query time: ${(t3 - t2) / 1e9d}s")
    println(s"delete users query time: ${(t4 - t3) / 1e9d}s")
    println(s"get API key time: ${(t5 - t4) / 1e9d}s")
    println(s"clustering time: ${(t6 - t5) / 1e9d}s")
  }

  /**
    * Runs multi user clustering for the user attributes in each region.
    */
  def runMultiUserClustering() = {
    val key: String = Play.configuration.getString("internal-api-key").get
    val t1 = System.nanoTime
    // Get the list of neighborhoods that need to be updated because the underlying users' clusters changed.
    val regionIds: List[Int] = GlobalClusteringSessionTable.getNeighborhoodsToReCluster

    // Delete the data for those regions.
    GlobalClusteringSessionTable.deleteGlobalClusteringSessions(regionIds)
    val t2 = System.nanoTime
    val nRegions: Int = regionIds.length
    Logger.info("N regions = " + nRegions)

    // Runs multi-user clustering within each region.
    for ((regionId, i) <- regionIds.view.zipWithIndex) {
      Logger.info(s"Finished ${f"${100.0 * i / nRegions}%1.2f"}% of regions, next: $regionId.")
      val clusteringOutput = Seq("python", "label_clustering.py", "--key", key, "--region_id", regionId.toString).!!
    }
    Logger.info("\nFinshed 100% of regions!!\n\n")
    val t3 = System.nanoTime
    println(s"delete time: ${(t2 - t1) / 1e9d}s")
    println(s"clustering time: ${(t3 - t2) / 1e9d}s")
  }
}
