package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.User

import scala.concurrent.Future

import play.api.mvc._

import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._

class RegionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def setANewRegion = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[Seq[Int]]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        Future.successful(Ok(Json.obj(
          "region_id" -> 0
        )))
      }
    )
  }
}
