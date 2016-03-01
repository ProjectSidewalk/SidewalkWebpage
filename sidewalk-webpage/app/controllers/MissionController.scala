package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, LogoutEvent, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import models.mission.{Mission, MissionTable, MissionUser, MissionUserTable}
import models.user.User
import play.api.libs.json.{JsObject, JsArray, Json}
import play.api.mvc.{BodyParsers, Result, RequestHeader}

import scala.concurrent.Future


class MissionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def getAllMissions = UserAwareAction.async { implicit request =>
    val missions = MissionTable.all.map(m => Json.toJson(m))
    Future.successful(Ok(JsArray(missions)))
  }

  def getIncompleteMissions = UserAwareAction.async { implicit request =>
    Future.successful(Ok(""))
  }

  def getIncompleteMissions(regionId: Int) = UserAwareAction.async { implicit request =>
    Future.successful(Ok(""))
  }
}
