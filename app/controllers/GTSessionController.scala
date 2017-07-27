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
import models.gt_session.{GTSessionTable}
import models.street.{StreetEdge, StreetEdgeTable}
import models.user.{User, WebpageActivityTable}
import models.daos.UserDAOImpl
import models.user.UserRoleTable
import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import play.extras.geojson


import scala.concurrent.Future

class GTSessionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * The index page just displays all undeleted ground truth sessions for now.
    */
  def index = UserAwareAction.async { implicit request =>
    val gtSessions= GTSessionTable.selectExistingSessions
    val ses: List[JsObject] = gtSessions.map { gtSession =>
      val gtSessionId: Int = gtSession.gtSessionId
      val routeId: Int = gtSession.routeId
      val clustering_threshold: Double = gtSession.clustering_threshold
      val time_created: java.sql.Timestamp = gtSession.time_created
      val deleted: Boolean = gtSession.deleted
      Json.obj("gtSessionId" -> gtSessionId, "routeId" -> routeId, "clustering_threshold" -> clustering_threshold, "time_created" -> time_created, "deleted" -> deleted)
    }
    val sessionCollection = Json.obj("sessions" -> ses)
    Future.successful(Ok(sessionCollection))
  }



}