package controllers

import models.label.LabelValidationMetadata
import service.{GSVDataService, LabelService}


import javax.inject.{Inject, Singleton}
import javax.naming.AuthenticationException
import scala.concurrent.ExecutionContext

import formats.json.GalleryFormats._
import models.user._
import models.label.LabelTable
//import models.label.LabelTable._
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.base._

import formats.json.LabelFormat
import play.api.libs.json.{JsError, JsObject, Json}

import scala.concurrent.Future


@Singleton
class GalleryController @Inject() (
                                    cc: CustomControllerComponents,
                                    val silhouette: Silhouette[DefaultEnv],
                                    implicit val ec: ExecutionContext,
                                    labelService: LabelService,
                                    gsvDataService: GSVDataService
                                  )
  extends CustomBaseController(cc) {

  /**
   * Returns labels of specified type, severities, and tags.
   *
   * @return
   */
  def getLabels = silhouette.UserAwareAction.async(parse.json) { implicit request =>
    val submission = request.body.validate[GalleryLabelsRequest]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) =>
            val n: Int = submission.n
            val labelTypeId: Option[Int] = submission.labelTypeId
            val loadedLabelIds: Set[Int] = submission.loadedLabels.toSet
            val valOptions: Set[String] = submission.validationOptions.getOrElse(Seq()).toSet
            val regionIds: Set[Int] = submission.regionIds.getOrElse(Seq()).toSet
            val severities: Set[Int] = submission.severities.getOrElse(Seq()).toSet
            val tags: Set[String] = submission.tags.getOrElse(Seq()).toSet

            // Get labels from LabelTable.
            labelService.getGalleryLabels(n, labelTypeId, loadedLabelIds, valOptions, regionIds, severities, tags, user.userId).map { labels =>
              val jsonList: Seq[JsObject] = labels.map(l => Json.obj(
                  "label" -> LabelFormat.validationLabelMetadataToJson(l),
                  "imageUrl" -> gsvDataService.getImageUrl(l.gsvPanoramaId, l.heading, l.pitch, l.zoom)
                )
              )
              val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
              Ok(labelList)
            }

          // If the user doesn't already have an anonymous ID, will not do anything.
          case _ => Future.failed(new AuthenticationException("Please log in to use this resource."))
        }
      }
    )
  }
}
