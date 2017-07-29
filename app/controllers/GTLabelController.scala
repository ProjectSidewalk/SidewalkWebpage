package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.gt.{GTLabelTable}
import models.user.User
import play.api.libs.json.{JsObject, Json}

import scala.concurrent.Future

class GTLabelController @Inject()(implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * Returns all records in gt_label table.
    */
  def getAllGTLabels = UserAwareAction.async { implicit request =>
    val gtLabels= GTLabelTable.all

    val gtl: List[JsObject] = gtLabels.map { gtLabel =>
      Json.obj(
        "gtLabelId" -> gtLabel.gtLabelId, "routeId" -> gtLabel.routeId, "gsvPanoramaId" -> gtLabel.gsvPanoramaId,
        "labelTypeId" -> gtLabel.labelTypeId, "svImageX" -> gtLabel.svImageX, "svImageY" -> gtLabel.svImageY,
        "canvasX" -> gtLabel.canvasX, "canvasY" -> gtLabel.canvasY, "heading" -> gtLabel.heading,
        "pitch" -> gtLabel.pitch, "zoom" -> gtLabel.zoom, "canvasHeight" -> gtLabel.canvasHeight,
        "canvasWidth" -> gtLabel.canvasWidth, "alphaX" -> gtLabel.alphaX, "alphaY" -> gtLabel.alphaY,
        "lat" -> gtLabel.lat, "lng" -> gtLabel.lng,
        "description" -> gtLabel.description,
        "severity" -> gtLabel.severity,
        "temporaryProblem" -> gtLabel.temporaryProblem
      )
    }
    val gtlCollection = Json.obj("ground_truth_labels" -> gtl)
    Future.successful(Ok(gtlCollection))
  }

}