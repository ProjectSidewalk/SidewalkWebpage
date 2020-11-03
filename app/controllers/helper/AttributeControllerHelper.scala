package controllers.helper

import models.attribute.{GlobalAttributeTable, GlobalClusteringSessionTable, UserAttributeLabelTable, UserAttributeTable, UserClusteringSessionTable}
import models.region.RegionTable
import models.user.UserStatTable
import play.api.libs.json.Json

import scala.collection.immutable.Seq
import scala.io.Source
import scala.sys.process._

object AttributeControllerHelper {
  /**
    * Calls the appropriate clustering function(s); either single-user clustering, multi-user clustering, or both.
    *
    * @param clusteringType One of "singleUser", "multiUser", or "both".
    * @return
    */
  def runClustering(clusteringType: String) = {
    if (clusteringType == "singleUser" || clusteringType == "both") {
      runSingleUserClusteringAllUsers()
    }
    if (clusteringType == "multiUser" || clusteringType == "both") {
      runMultiUserClusteringAllRegions()
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
    * Runs single user clustering for each high quality user.
    *
    * @return
    */
  def runSingleUserClusteringAllUsers() = {

    // First truncate the user_clustering_session, user_attribute, and user_attribute_label tables
    UserClusteringSessionTable.truncateTables()

    // Read key from keyfile. If we aren't able to read it, we can't do anything :(
    val maybeKey: Option[String] = readKeyFile()

    if (maybeKey.isDefined) {
      val key: String = maybeKey.get
      val goodUsers: List[String] = UserStatTable.getIdsOfGoodUsersWithLabels
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
    } else {
      println("Could not read keyfile, so nothing happened :(")
    }
  }

  /**
    * Runs multi user clustering for the user attributes in each region.
    *
    * @return
    */
  def runMultiUserClusteringAllRegions() = {

    // First truncate the global_clustering_session, global_attribute, and global_attribute_user_attribute tables.
    GlobalClusteringSessionTable.truncateTables()

    // Read key from keyfile. If we aren't able to read it, we can't do anything :(
    val maybeKey: Option[String] = readKeyFile()

    if (maybeKey.isDefined) {
      val key: String = maybeKey.get
      val regionIds: List[Int] = RegionTable.selectAllNeighborhoods.map(_.regionId).sortBy(x => x)
      //    val regionIds = List(199, 200, 203, 211, 261) // Small test set.
      val nRegions: Int = regionIds.length

      // Runs multi-user clustering within each region.
      for ((regionId, i) <- regionIds.view.zipWithIndex) {
        println(s"Finished ${f"${100.0 * i / nRegions}%1.2f"}% of regions, next: $regionId.")
        val clusteringOutput = Seq("python", "label_clustering.py", "--key", key, "--region_id", regionId.toString).!!
      }
      println("\nFinshed 100% of regions!!\n\n")
    } else {
      println("Could not read keyfile, so nothing happened :(")
    }
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
}
