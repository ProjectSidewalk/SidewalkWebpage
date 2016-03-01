package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, LogoutEvent, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.audit.{NewTask, AuditTaskTable}
import models.user.User
import play.api.libs.json.Json
import play.api.mvc.{BodyParsers, Result, RequestHeader}

import scala.concurrent.Future


class MissionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def getAllMissions = UserAwareAction.async { implicit request =>
    Future.successful(Ok(""))
  }

  def getIncompleteMissions = UserAwareAction.async { implicit request =>
    Future.successful(Ok(""))
  }

  def getIncompleteMissions(regionId: Int) = UserAwareAction.async { implicit request =>
    Future.successful(Ok(""))
  }
}
