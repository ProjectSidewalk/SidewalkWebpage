package controllers

import javax.inject.Inject
import java.sql.Timestamp
import java.time.Instant

import controllers.headers.ProvidesHeader
import models.user._
import models.label.LabelTable
import models.label.LabelTable._
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json.{JsObject, Json, JsValue, JsArray}
import play.api.Logger

import scala.concurrent.Future
import scala.io.Source


class GalleryController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Returns curb ramp labels.
   * @param count Number of curb ramp labels to return.
   * @return
   */
  def getLabelsByType(labelTypeId: Int, n: Int, loadedLabels: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val loadedLabelIds: Set[Int] = Json.parse(loadedLabels).as[JsArray].value.map(_.as[Int]).toSet
        val labels: Seq[LabelValidationMetadata] = if (labelTypeId == 9) LabelTable.retrieveAssortedLabels(n, loadedLabelIds) 
                                                   else LabelTable.retrieveLabelsByType(labelTypeId, n, loadedLabelIds) 
        val jsonList: Seq[JsObject] = labels.map(l => Json.obj(
            "label" -> LabelTable.validationLabelMetadataToJson(l),
            "imageUrl" -> getImageUrl(l.gsvPanoramaId, l.canvasWidth, l.canvasHeight, l.heading, l.pitch, l.zoom)
          )
        )

        val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
        Future.successful(Ok(labelList))

      // If the user doesn't already have an anonymous ID, sign them up and rerun.
      case _ => Future.successful(
        Redirect(s"/anonSignUp?url=/label/labelsByType?labelTypeId=" + labelTypeId + "&n=" + n + "&loadedLabels=" + loadedLabels)
      )
    }
  }

  /**
   * TODO: try to refactor this somewhere else
   *
   * Retrieves the static image of the label panorama from the Google Street
   * View Static API. Note that this returns the image of the panorama, but
   * doesn't actually include the label. More information here:
   * https://developers.google.com/maps/documentation/streetview/intro
   *
   * @param label Label to retrieve the static image of.
   * @return  Image URL that represents the background of the label.
   */
  def getImageUrl(gsvPanoramaId: String, canvasWidth: Int, canvasHeight: Int, heading: Float, pitch: Float, zoom: Int): String = {
    val url = "https://maps.googleapis.com/maps/api/streetview?" +
      "pano=" + gsvPanoramaId +
      "&size=" + canvasWidth + "x" + canvasHeight +
      "&heading=" + heading +
      "&pitch=" + pitch +
      "&fov=" + getFov(zoom) +
      "&key=" + VersionTable.getGoogleMapsAPIKey()
    url
  }

  /**
   * Hacky fix to generate the FOV for an image (sort of like zoom).
   * Determined experimentally.
   * @param label Label to retrieve the FOV for.
   */
  def getFov(zoom: Int): Double = {
    if (zoom <= 2) {
      126.5 - zoom * 36.75
    } else {
      195.93 / scala.math.pow(1.92, zoom * 1.0)
    }
  }
}

