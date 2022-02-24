package controllers

import javax.inject.Inject
import controllers.headers.ProvidesHeader
import controllers.helper.GoogleMapsHelper
import formats.json.LabelFormat._
import models.user._
import models.validation._
import models.label.{LabelTable, LabelTypeTable}
import models.label.LabelTable._
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.Play
import play.api.Play.current
import play.api.mvc._
import play.api.libs.json.{JsArray, JsObject, Json, JsError}
import scala.concurrent.Future


/**
 * Holds the HTTP requests associated with Sidewalk Gallery.
 *
 * @param env The Silhouette environment.
 */
class GalleryController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // Set of valid labels.
  val validLabTypes: Set[Int] = LabelTypeTable.validLabelTypeIds

  /**
   * Returns labels of a specified type.
   *
   * @param labelTypeId Label type specifying what type of labels to grab.
   * @param n Number of labels to grab.
   * @param loadedLabels String representing set of labelIds already grabbed as to not grab them again.
   * @return
   */
  def getLabelsByType(labelTypeId: Int, n: Int) = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[LoadedLabels]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) =>
            val loadedLabIds: Set[Int] = Json.parse(submission.loaded_labels).as[JsArray].value.map(_.as[Int]).toSet
            val labels: Seq[LabelValidationMetadata] =
              if (validLabTypes.contains(labelTypeId)) LabelTable.getLabelsByType(labelTypeId, n, loadedLabIds, user.userId)
              else LabelTable.getAssortedLabels(n, loadedLabIds, user.userId)
            val labelsShuffled = scala.util.Random.shuffle(labels)
            val jsonList: Seq[JsObject] = labelsShuffled.map(l => Json.obj(
                "label" -> LabelTable.validationLabelMetadataToJson(l),
                "imageUrl" -> GoogleMapsHelper.getImageUrl(l.gsvPanoramaId, l.canvasWidth, l.canvasHeight, l.heading, l.pitch, l.zoom)
              )
            )
            val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
            Future.successful(Ok(labelList))

          // If the user doesn't already have an anonymous ID, will not do anything
          case _ => Future.successful(
            Ok(Json.obj("ok" -> "ok"))
          )
        }
      }
    )
  }

  def getLabelsByTypePass() = UserAwareAction.async { implicit request =>
    Future.successful(Ok(Json.obj()));
  }

  /**
   * Returns labels of specified type, severities, and tags.
   *
   * @param labelTypeId Label type specifying what type of labels to grab.
   * @param n Number of labels to grab.
   * @param loadedLabels String representing the set of labelIds already grabbed as to not grab them again.
   * @param severities String representing the set of severities the labels grabbed can have.
   * @param tags String representing the set of tags the labels grabbed can have.
   * @return
   */
  def getLabelsBySeveritiesAndTags(labelTypeId: Int, n: Int, severities: String, tags: String) = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[LoadedLabels]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) =>
            val loadedLabelIds: Set[Int] = Json.parse(submission.loaded_labels).as[JsArray].value.map(_.as[Int]).toSet
            val severitiesToSelect: Set[Int] = Json.parse(severities).as[JsArray].value.map(_.as[Int]).toSet
            val tagsToSelect: Set[String] = Json.parse(tags).as[JsArray].value.map(_.as[String]).toSet

            val labels: Seq[LabelValidationMetadata] =
              if (validLabTypes.contains(labelTypeId)) {
                LabelTable.getLabelsOfTypeBySeverityAndTags(
                  labelTypeId, n, loadedLabelIds, severitiesToSelect, tagsToSelect, user.userId
                )
              } else {
                LabelTable.getAssortedLabels(n, loadedLabelIds, user.userId, Some(severitiesToSelect))
              }
            val jsonList: Seq[JsObject] = labels.map(l => Json.obj(
                "label" -> LabelTable.validationLabelMetadataToJson(l),
                "imageUrl" -> GoogleMapsHelper.getImageUrl(l.gsvPanoramaId, l.canvasWidth, l.canvasHeight, l.heading, l.pitch, l.zoom)
              )
            )

            val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
            Future.successful(Ok(labelList))
            
          // If the user doesn't already have an anonymous ID,  will not do anything
          case _ => Future.successful(
            Ok(Json.obj("ok" -> "ok"))
          )
        }
      }
    )
  }

  def getLabelsBySeveritiesAndTagsPass() = UserAwareAction.async { implicit request =>
    Future.successful(Ok(Json.obj()));
  }
}
