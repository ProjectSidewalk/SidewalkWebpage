package controllers.helper

import java.util.UUID

import models.attribute.{GlobalAttributeTable, GlobalClusteringSessionTable, UserAttributeLabelTable, UserAttributeTable, UserClusteringSessionTable}
import models.audit.{AuditTaskInteraction, AuditTaskInteractionTable}
import models.label.{Label, LabelTable}
import models.region.RegionTable
import models.street.StreetEdgePriorityTable
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
      val goodUsers: List[String] = StreetEdgePriorityTable.getIdsOfGoodUsers // All users
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

  def _helpGetLabelsFromCurrentMission(regionId: Int, userId: UUID): List[Label] = {

    val interactions: List[AuditTaskInteraction] = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser(regionId, userId)

    val lastIdx = interactions.map(_.action).reverse.indexOf("MissionComplete")

    val currentMissionInteractions = if (lastIdx == -1) {
      // No mission has been completed. Return all the interactions.
      interactions
    } else {
      // At least one mission has been completed. Return the labels after the last MissionComplete
      val idx = interactions.length - lastIdx - 1
      interactions.zipWithIndex.filter(_._2 > idx).map(_._1)
    }

    // Filter out all the interaction without temporary_label_id
    val filteredInteractions = currentMissionInteractions.filter(_.temporaryLabelId.isDefined)

    val labels = LabelTable.selectLabelsByInteractions(userId, filteredInteractions)

    labels
    // TODO if the old code below is ever used, replace using JTS.transform to find dist /w doing it within query, see MissionController.updateUnmarkedCompletedMissionsAsCompleted
    //    val CRSEpsg4326 = CRS.decode("epsg:4326")
    //    val CRSEpsg26918 = CRS.decode("epsg:26918")
    //    val transform = CRS.findMathTransform(CRSEpsg4326, CRSEpsg26918)
    //
    //    // Get tasks completed in the current region.
    //    val tasks = AuditTaskTable.selectCompletedTasksInARegion(regionId, userId)
    //
    //    if (tasks.isEmpty) return List()
    //
    //    // Get missions in the current region
    //    val completedMissions = MissionTable.selectCompletedMissionsByAUser(userId, regionId, includeOnboarding = true)
    //
    //    // Get the last mission distances (i.e., the cumulatirve mission distance traveled traveled).
    //    if (completedMissions.isEmpty) {
    //      // TODO: Return all the labels submitted so far
    //      List()
    //    } else {
    //      // Todo: Return all the labels
    //      val completedDistance: Double = completedMissions.last.distance.get
    //
    //      // Compute the tasks that are completed during the latest (current) mission
    //      // http://stackoverflow.com/questions/3224935/in-scala-how-do-i-fold-a-list-and-return-the-intermediate-results
    //      val cumulativeTaskDistances: List[Double] = tasks.map {var s: Double = 0; task => {s += JTS.transform(task.geom, transform).getLength; s}}
    //
    //      val lastMissionTasks: List[NewTask] = cumulativeTaskDistances.find(_ > completedDistance) match {
    //        case Some(v) =>
    //          val idx = cumulativeTaskDistances.indexOf(v)
    //
    //        case None =>
    //          List(tasks.last)  // This should not happen.
    //      }
    //
    //      List()
    //    }
    //
    //    // Using the task id and temporarary id, retrieve all the labels.

  }
}
