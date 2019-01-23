package controllers.helper

import java.util.UUID

import models.audit.{AuditTaskInteraction, AuditTaskInteractionTable}
import models.label.{Label, LabelTable}

object LabelControllerHelper {
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
