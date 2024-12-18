package controllers

import javax.inject.{Inject, Singleton}
//import controllers.headers.ProvidesHeader
import controllers.helper.GoogleMapsHelper
import formats.json.GalleryFormats._
import models.user._
import models.label.LabelTable
//import models.label.LabelTable._
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.{CookieAuthenticator, SessionAuthenticator}
import formats.json.LabelFormat
import play.api.i18n.MessagesApi
import play.api.mvc._
import play.api.libs.json.{JsError, JsObject, Json}

import scala.concurrent.Future


@Singleton
class GalleryController @Inject() (val messagesApi: MessagesApi, val env: Environment[SidewalkUserWithRole, CookieAuthenticator])
  extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] {

  /**
   * Returns labels of specified type, severities, and tags.
   *
   * @return
   */
//  def getLabels = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
//    val submission = request.body.validate[GalleryLabelsRequest]
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
//      },
//      submission => {
//        request.identity match {
//          case Some(user) =>
//            val n: Int = submission.n
//            val labelTypeId: Option[Int] = submission.labelTypeId
//            val loadedLabelIds: Set[Int] = submission.loadedLabels.toSet
//            val valOptions: Set[String] = submission.validationOptions.getOrElse(Seq()).toSet
//            val regionIds: Set[Int] = submission.regionIds.getOrElse(Seq()).toSet
//            val severities: Set[Int] = submission.severities.getOrElse(Seq()).toSet
//            val tags: Set[String] = submission.tags.getOrElse(Seq()).toSet
//
//            // Get labels from LabelTable.
//            val labels: Seq[LabelValidationMetadata] =
//              LabelTable.getGalleryLabels(n, labelTypeId, loadedLabelIds, valOptions, regionIds, severities, tags, user.userId)
//
//            val jsonList: Seq[JsObject] = labels.map(l => Json.obj(
//                "label" -> LabelFormat.validationLabelMetadataToJson(l),
//                "imageUrl" -> GoogleMapsHelper.getImageUrl(l.gsvPanoramaId, l.heading, l.pitch, l.zoom)
//              )
//            )
//
//            val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
//            Future.successful(Ok(labelList))
//
//          // If the user doesn't already have an anonymous ID,  will not do anything.
//          case _ => Future.successful(
//            Ok(Json.obj("ok" -> "ok"))
//          )
//        }
//      }
//    )
//  }
}
