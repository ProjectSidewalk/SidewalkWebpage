package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.TaskFormats._
import models.audit.{AuditTaskInteraction, AuditTaskInteractionTable, AuditTaskTable, InteractionWithLabel}
import models.daos.slick.DBTableDefinitions.UserTable
import models.mission.MissionTable
import models.region.RegionTable
import models.user.User
import play.api.libs.json.{JsArray, JsObject, Json}
import play.extras.geojson

import scala.concurrent.Future

/**
  * Todo. This controller is written quickly and not well thought out. Someone could polish the controller together with the model code that was written kind of ad-hoc.
  * @param env
  */
class AdminController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // Helper methods
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.roles.getOrElse(Seq()).contains("Administrator")) true else false
    case _ => false
  }

  // Pages
  def index = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      Future.successful(Ok(views.html.admin.index("Project Sidewalk", request.identity)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def userProfile(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity, Some(user))))
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def task(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      AuditTaskTable.find(taskId) match {
        case Some(task) => Future.successful(Ok(views.html.admin.task("Project Sidewalk", request.identity, task)))
        case _ => Future.successful(Redirect("/"))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  // JSON APIs
  def getNeighborhoodCompletionRate = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val streetsPerRegion = RegionTable.selectStreetsInRegions.groupBy(_.regionId)

      val completionRates = streetsPerRegion.map {
        case (regionId, streets) =>
          val completed = streets.filter(_.completionCount > 0).map(_.distance).sum
          val total = streets.map(_.distance).sum
          val regionName = streets.head.regionName
          (regionId, total, completed, regionName)
      }.map(x => Json.obj("region_id" -> x._1, "total_distance_m" -> x._2, "completed_distance_m" -> x._3, "name" -> x._4)).toSeq

      Future.successful(Ok(JsArray(completionRates)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getOnboardingTaskInteractions = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val onboardingTransitions = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAnActionType("Onboarding_Transition")
      val jsonObjectList = onboardingTransitions.map(x => Json.toJson(x))

      Future.successful(Ok(JsArray(jsonObjectList)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * This method returns the tasks and labels submitted by the given user.
    * @param username Username
    * @return
    */
  def getSubmittedTasksWithLabels(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) =>
          val tasksWithLabels = AuditTaskTable.tasksWithLabels(UUID.fromString(user.userId)).map(x => Json.toJson(x))
          Future.successful(Ok(JsArray(tasksWithLabels)))
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getMissionsCompletedByUsers = UserAwareAction.async{ implicit request =>
    if (isAdmin(request.identity)) {
      val missionsCompleted = MissionTable.missionsCompletedByUsers.map(x =>
        Json.obj("usrename" -> x.username, "label" -> x.label, "level" -> x.level, "distance_m" -> x.distance_m, "distance_ft" -> x.distance_ft, "distance_mi" -> x.distance_mi)
      )
      Future.successful(Ok(JsArray(missionsCompleted)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def completedTasks = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {

      Future.successful(Ok(JsArray()))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Get records of audit task interactions of a user
    * @param username
    * @return
    */
  def getAuditTaskInteractionsOfAUser(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) =>
          val interactions = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser(UUID.fromString(user.userId)).map(interaction => Json.toJson(interaction))
          Future.successful(Ok(JsArray(interactions)))
        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def auditTaskInteractions(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      AuditTaskTable.find(taskId) match {
        case Some(user) =>
          val interactions = AuditTaskInteractionTable.selectAuditTaskInteractions(taskId).map(x => Json.toJson(x))
          Future.successful(Ok(JsArray(interactions)))
        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getAnAuditTaskPath(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      AuditTaskTable.find(taskId) match {
        case Some(task) =>
          // Select interactions and format it into a geojson
          val interactionsWithLabels: List[InteractionWithLabel] = AuditTaskInteractionTable.selectAuditInteractionsWithLabels(task.auditTaskId)
          val featureCollection: JsObject = AuditTaskInteractionTable.auditTaskInteractionsToGeoJSON(interactionsWithLabels)
          Future.successful(Ok(featureCollection))
        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }
}
