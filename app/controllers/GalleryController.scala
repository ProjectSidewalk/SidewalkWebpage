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
import play.api.libs.json.{JsObject, Json}

import scala.concurrent.Future
import scala.io.Source


class GalleryController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Returns curb ramp labels.
   * @param count Number of curb ramp labels to return.
   * @return
   */
  def getLabelsByType(labelTypeId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>

        val labels: Seq[LabelValidationMetadata] = LabelTable.retrieveLabelsByType(labelTypeId)
        val jsonList: Seq[JsObject] = labels.map(l => Json.obj(
            "label" -> LabelTable.validationLabelMetadataToJson(l),
            "imageUrl" -> getImageUrl(l.gsvPanoramaId, l.canvasWidth, l.canvasHeight, l.heading, l.pitch, l.zoom)
          )
        )

        val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
        Future.successful(Ok(labelList))

      // If the user doesn't already have an anonymous ID, sign them up and rerun.
      case _ => Future.successful(Redirect(s"/anonSignUp?url=/label/labelsByType?labelTypeId=" + labelTypeId))
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
    if (zoom == 1) {
      47.5
    } else if (zoom == 2) {
      52.5
    } else {
      57.5
    }
  }
}

