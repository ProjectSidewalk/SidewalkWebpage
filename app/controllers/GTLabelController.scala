package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import formats.json.TaskFormats._
import models.daos.slick.DBTableDefinitions.UserTable
import models.label.LabelTable.LabelMetadata
import models.gt.{GTLabelTable}
import models.user.{User, WebpageActivityTable}
import models.daos.UserDAOImpl
import models.user.UserRoleTable
import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import play.extras.geojson


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