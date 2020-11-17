package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import models.audit.AuditTaskTable
import models.mission.MissionTable
import models.label.{LabelTable, LabelValidationTable}
import models.user.User
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson
import play.api.i18n.Messages
import scala.concurrent.Future

/**
 * The basic application controller.
 *
 * @param env The Silhouette environment.
 */
class UserProfileController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {

  def userProfile(username: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val username: String = user.username
        // Get distance audited by the user. If using metric units, convert from miles to kilometers.
        val auditedDistance: Float =
          if (Messages("measurement.system") == "metric") MissionTable.getDistanceAudited(user.userId) * 1.60934.toFloat
          else MissionTable.getDistanceAudited(user.userId)
        Future.successful(Ok(views.html.userProfile(s"Project Sidewalk - $username", Some(user), auditedDistance)))
      case None => Future.successful(Redirect(s"/anonSignUp?url=/contribution/$username"))
    }
  }

  /**
   * Get a list of edges that are audited by users.
   */
  def getAuditedStreets = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val streets = AuditTaskTable.selectStreetsAuditedByAUser(user.userId)
        val features: List[JsObject] = streets.map { edge =>
          val coordinates: Array[Coordinate] = edge.geom.getCoordinates
          val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
          val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
          val properties = Json.obj(
            "street_edge_id" -> edge.streetEdgeId,
            "way_type" -> edge.wayType
          )
          Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
        }
        val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      case None => Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "We could not find your username in our system :("
      )))
    }
  }

  def getAllAuditedStreets = UserAwareAction.async { implicit request =>
    val streets = AuditTaskTable.selectStreetsAudited
    val features: List[JsObject] = streets.map { edge =>
      val coordinates: Array[Coordinate] = edge.geom.getCoordinates
      val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
      val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
      val properties = Json.obj(
        "street_edge_id" -> edge.streetEdgeId,
        "way_type" -> edge.wayType
      )
      Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Future.successful(Ok(featureCollection))
  }

  /**
   * Get a list of labels submitted by the user.
   */
  def getSubmittedLabels(regionId: Option[Int]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels = regionId match {
          case Some(rid) => LabelTable.selectLocationsOfLabelsByUserIdAndRegionId(user.userId, rid)
          case None => LabelTable.selectLocationsOfLabelsByUserId(user.userId)
        }

        // val labels = LabelTable.selectLocationsOfLabelsByUserId(user.userId)
        val features: List[JsObject] = labels.map { label =>
          val point = geojson.Point(geojson.LatLng(label.lat.toDouble, label.lng.toDouble))
          val properties = Json.obj(
            "audit_task_id" -> label.auditTaskId,
            "label_id" -> label.labelId,
            "gsv_panorama_id" -> label.gsvPanoramaId,
            "label_type" -> label.labelType
          )
          Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
        }
        val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      case None =>  Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "Your user id could not be found."
      )))
    }
  }

  def getAllAuditCounts = UserAwareAction.async { implicit request =>
    val auditCounts = AuditTaskTable.auditCounts
    val json = Json.arr(auditCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }

  def getAllLabelCounts = UserAwareAction.async { implicit request =>
    val labelCounts = LabelTable.selectLabelCountsPerDay
    val json = Json.arr(labelCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }

  def getAllValidationCounts = UserAwareAction.async { implicit request =>
    val validationCounts = LabelValidationTable.getValidationsByDate
    val json = Json.arr(validationCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }
}
