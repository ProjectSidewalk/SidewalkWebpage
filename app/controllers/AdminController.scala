package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.daos.slick.DBTableDefinitions.UserTable
import models.mission.MissionTable
import models.region.RegionTable
import models.user.User
import play.api.libs.json.{JsArray, Json}

import scala.concurrent.Future


class AdminController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.roles.getOrElse(Seq()).contains("Administrator")) true else false
    case _ => false
  }

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

  def getNeighborhoodCompletionRate = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val streetsPerRegion = RegionTable.getStreetsPerRegion.groupBy(_.regionId)

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

  def missionsCompletedByUsers = UserAwareAction.async{ implicit request =>
    if (isAdmin(request.identity)) {
      val missionsCompleted = MissionTable.missionsCompletedByUsers.map(x =>
        Json.obj("usrename" -> x.username, "label" -> x.label, "level" -> x.level, "distance_m" -> x.distance_m, "distance_ft" -> x.distance_ft, "distance_mi" -> x.distance_mi)
      )
      Future.successful(Ok(JsArray(missionsCompleted)))
    } else {
      Future.successful(Redirect("/"))
    }
  }
}
