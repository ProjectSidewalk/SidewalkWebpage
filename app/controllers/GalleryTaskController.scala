package controllers

import java.sql.Timestamp
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator

import controllers.headers.ProvidesHeader

import formats.json.GalleryTaskSubmissionFormats._

import models.user.User
import models.gallery._
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future
import scala.collection.mutable.ListBuffer

class GalleryTaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def processGalleryTaskSubmissions(submission: Seq[GalleryTaskSubmission], remoteAddress: String, identity: Option[User]) = {
    val userOption = identity
    for (data <- submission) yield {
      GalleryTaskInteractionTable.saveMultiple(data.interactions.map { interaction =>
        GalleryTaskInteraction(0, interaction.action, interaction.panoId, interaction.note, new Timestamp(interaction.timestamp))
      })

      // Insert Environment 
      val env: GalleryEnvironmentSubmission = data.environment
      val taskEnv: GalleryTaskEnvironment = GalleryTaskEnvironment(0, env.browser,
        env.browserVersion, env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth,
        env.screenHeight, env.operatingSystem, Some(remoteAddress), env.language)
      GalleryTaskEnvironmentTable.save(taskEnv)
    }
    
    Future.successful(Ok("Got request"))
  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON
    *
    * @return
    */
  def postBeacon = UserAwareAction.async(BodyParsers.parse.text) { implicit request =>
    val json = Json.parse(request.body)
    var submission = json.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        processGalleryTaskSubmissions(submission, request.remoteAddress, request.identity)
      }
    )
  }

  /**
    * Parse submitted gallery data and submit to tables
    * Useful info: https://www.playframework.com/documentation/2.6.x/ScalaJsonHttp
    * BodyParsers.parse.json in async
    */
  def post = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        processGalleryTaskSubmissions(submission, request.remoteAddress, request.identity)
      }
    )
  }
}
