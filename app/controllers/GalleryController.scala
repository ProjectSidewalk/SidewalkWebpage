package controllers

import controllers.base._
import formats.json.GalleryFormats._
import formats.json.LabelFormats
import models.auth.DefaultEnv
import models.gallery.{GalleryTaskEnvironment, GalleryTaskEnvironmentTable, GalleryTaskInteraction, GalleryTaskInteractionTable}
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsError, JsObject, JsValue, Json}
import play.api.mvc.{Action, Result}
import play.silhouette.api.Silhouette
import service.{GsvDataService, LabelService}

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class GalleryController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext,
    labelService: LabelService,
    gsvDataService: GsvDataService,
    galleryTaskInteractionTable: GalleryTaskInteractionTable,
    galleryTaskEnvironmentTable: GalleryTaskEnvironmentTable
) extends CustomBaseController(cc)
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  /**
   * Returns labels of specified type, severities, and tags.
   */
  def getLabels: Action[JsValue] = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[GalleryLabelsRequest]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val n: Int                   = submission.n
        val labelTypeId: Option[Int] = submission.labelTypeId
        val loadedLabelIds: Set[Int] = submission.loadedLabels.toSet
        val valOptions: Set[String]  = submission.validationOptions.getOrElse(Seq()).toSet
        val regionIds: Set[Int]      = submission.regionIds.getOrElse(Seq()).toSet
        val severities: Set[Int]     = submission.severities.getOrElse(Seq()).toSet
        val tags: Set[String]        = submission.tags.getOrElse(Seq()).toSet
        val userId: String           = request.identity.userId

        // Get labels from LabelTable.
        labelService
          .getGalleryLabels(n, labelTypeId, loadedLabelIds, valOptions, regionIds, severities, tags, userId)
          .map { labels =>
            val jsonList: Seq[JsObject] = labels.map(l =>
              Json.obj(
                "label"    -> LabelFormats.validationLabelMetadataToJson(l),
                "imageUrl" -> gsvDataService.getImageUrl(l.gsvPanoramaId, l.heading, l.pitch, l.zoom)
              )
            )
            val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
            Ok(labelList)
          }
      }
    )
  }

  /**
   * Take parsed JSON data and insert it into database.
   */
  def processGalleryTaskSubmissions(
      submission: Seq[GalleryTaskSubmission],
      ipAddress: String,
      userId: String
  ): Future[Result] = {
    for (data <- submission) yield {
      // Insert into interactions and environment tables.
      val env: GalleryEnvironmentSubmission = data.environment
      db.run(for {
        nInteractionSubmitted <- galleryTaskInteractionTable.insertMultiple(data.interactions.map { action =>
          GalleryTaskInteraction(0, action.action, action.panoId, action.note, action.timestamp, Some(userId))
        })
        _ <- galleryTaskEnvironmentTable.insert(
          GalleryTaskEnvironment(0, env.browser, env.browserVersion, env.browserWidth, env.browserHeight,
            env.availWidth, env.availHeight, env.screenWidth, env.screenHeight, env.operatingSystem, Some(ipAddress),
            env.language, Some(userId))
        )
      } yield nInteractionSubmitted)
    }
    Future.successful(Ok("Got request"))
  }

  /**
   * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
   */
  def postBeacon = cc.securityService.SecuredAction(parse.text) { implicit request =>
    val json       = Json.parse(request.body)
    val submission = json.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => { processGalleryTaskSubmissions(submission, request.ipAddress, request.identity.userId) }
    )
  }

  /**
   * Parse submitted gallery data and submit to tables.
   */
  def post = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[Seq[GalleryTaskSubmission]]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => { processGalleryTaskSubmissions(submission, request.ipAddress, request.identity.userId) }
    )
  }
}
