package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import models.user.{User, UserCurrentRegionTable}

import scala.concurrent.Future
import play.api.mvc._
import models.region._
import play.api.libs.json.Json
import play.api.libs.json.Json._

class RegionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def setANewRegion = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    case class RegionId(regionId:Int)
    implicit val regionIdReads: Reads[RegionId] = (JsPath \ "region_id").read[Int].map(RegionId(_))
    var submission = request.body.validate[RegionId]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val regionId: Int = submission.regionId
        request.identity match {
          case Some(user) =>

            UserCurrentRegionTable.update(user.userId, regionId)
          case None =>
        }
        Future.successful(Ok(Json.obj(
          "region_id" -> regionId
        )))
      }
    )
  }
}
