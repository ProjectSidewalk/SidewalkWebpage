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
        val jsonList: Seq[JsObject] = labels.map(l => LabelTable.validationLabelMetadataToJson(l))
        val labelList: JsObject = Json.obj("labelsOfType" -> jsonList)
        Future.successful(Ok(labelList))

      // If the user doesn't already have an anonymous ID, sign them up and rerun.
      case _ => Future.successful(Redirect(s"/anonSignUp?url=/label/labelsByType?labelTypeId=" + labelTypeId))
    }
  }

//  /**
//   * Retrieves the static image of the label panorama from the Google Street
//   * View Static API. Note that this returns the image of the panorama, but
//   * doesn't actually include the label. More information here:
//   * https://developers.google.com/maps/documentation/streetview/intro
//   *
//   * @param label Label to retrieve the static image of.
//   * @return  Image URL that represents the background of the label.
//   */
//  def getImageUrl(label: Label): String = {
//    val url = "https://maps.googleapis.com/maps/api/streetview?" +
//      "pano=" + label.gsvPanoramaId +
//      "&size=" + label.canvasWidth + "x" + label.canvasHeight +
//      "&heading=" + label.heading +
//      "&pitch=" + label.pitch +
//      "&fov=" + getFov(label) +
//      "&key=" + getGoogleMapsAPIKey()
//    url
//  }

  /**
   * Returns Google Maps API key from google_maps_api_key.txt (ask Mikey
   * Saugstad for the file if you don't have it).
   * @return  Google Maps API Key.
   */
  def getGoogleMapsAPIKey(): String = {
    val bufferedSource = Source.fromFile("google_maps_api_key.txt")
    val lines = bufferedSource.getLines()
    val key: String = lines.next()
    bufferedSource.close
    key
  }
}

