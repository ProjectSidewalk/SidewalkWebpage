package controllers

import javax.inject.{Inject, Singleton}
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.base._

import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}


import scala.concurrent.ExecutionContext

import formats.json.GalleryFormats._
import models.user.SidewalkUserWithRole
import models.gallery._
import play.api.libs.json._

import scala.concurrent.Future


@Singleton
class GalleryTaskController @Inject() (
                                        cc: CustomControllerComponents,
                                        val silhouette: Silhouette[DefaultEnv],
                                        protected val dbConfigProvider: DatabaseConfigProvider,
                                        implicit val ec: ExecutionContext,
                                        galleryTaskInteractionTable: GalleryTaskInteractionTable,
                                        galleryTaskEnvironmentTable: GalleryTaskEnvironmentTable
                                      )
  extends CustomBaseController(cc) with HasDatabaseConfigProvider[MyPostgresProfile] {

  /**
    * Take parsed JSON data and insert it into database.
    *
    * @return
    */
  def processGalleryTaskSubmissions(submission: Seq[GalleryTaskSubmission], remoteAddress: String, identity: Option[SidewalkUserWithRole]) = {
    val userId: Option[String] = identity.map(_.userId)
    for (data <- submission) yield {
      // Insert into interactions and environment tables.
      val env: GalleryEnvironmentSubmission = data.environment
      db.run(for {
        nInteractionSubmitted <- galleryTaskInteractionTable.insertMultiple(data.interactions.map { action =>
          GalleryTaskInteraction(0, action.action, action.panoId, action.note, action.timestamp, userId)
        })
        _ <- galleryTaskEnvironmentTable.insert(GalleryTaskEnvironment(0, env.browser,
          env.browserVersion, env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth,
          env.screenHeight, env.operatingSystem, Some(remoteAddress), env.language, userId))
      } yield nInteractionSubmitted)
    }
    Future.successful(Ok("Got request"))
  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
    *
    * @return
    */
  def postBeacon = silhouette.UserAwareAction.async(parse.text) { implicit request =>
    val json = Json.parse(request.body)
    var submission = json.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        processGalleryTaskSubmissions(submission, request.remoteAddress, request.identity)
      }
    )
  }

  /**
    * Parse submitted gallery data and submit to tables.
    */
  def post = silhouette.UserAwareAction.async(parse.json) { implicit request =>
    var submission = request.body.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        processGalleryTaskSubmissions(submission, request.remoteAddress, request.identity)
      }
    )
  }
}
