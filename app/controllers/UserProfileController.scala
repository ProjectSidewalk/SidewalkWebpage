package controllers

import javax.inject.Inject
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import models.audit.AuditTaskTable
import models.mission.MissionTable
import models.user.OrganizationTable
import models.user.UserOrgTable
import models.label.{LabelTable, LabelValidationTable}
import models.user.{User, WebpageActivityTable, WebpageActivity}
import play.api.libs.json.{JsObject, Json}
import play.extras.geojson
import play.api.i18n.Messages
import scala.concurrent.Future

/**
 * Holds the HTTP requests associated with the user dashboard.
 *
 * @param env The Silhouette environment.
 */
class UserProfileController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {

  /**
   * Loads the user dashboard page.
   */
  def userProfile(username: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val username: String = user.username
        // Get distance audited by the user. If using metric units, convert from miles to kilometers.
        val auditedDistance: Float =
          if (Messages("measurement.system") == "metric") MissionTable.getDistanceAudited(user.userId) * 1.60934.toFloat
          else MissionTable.getDistanceAudited(user.userId)
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_UserDashboard", timestamp))
        Future.successful(Ok(views.html.userProfile(s"Project Sidewalk - $username", Some(user), auditedDistance)))
      case None => Future.successful(Redirect(s"/anonSignUp?url=/contribution/$username"))
    }
  }

  /**
   * Get the list of streets that have been audited by the signed in user.
   */
  def getAuditedStreets = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val streets = AuditTaskTable.getAuditedStreets(user.userId)
        val features: List[JsObject] = streets.map { edge =>
          val coordinates: Array[Coordinate] = edge.geom.getCoordinates
          val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList
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

  /**
   * Get the list of streets that have been audited by any user.
   */
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
   * Get the list of labels submitted by the signed in user. Only include labels in the given region if supplied.
   */
  def getSubmittedLabels(regionId: Option[Int]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels = regionId match {
          case Some(rid) => LabelTable.getLabelLocations(user.userId, rid)
          case None => LabelTable.getLabelLocations(user.userId)
        }

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

  /**
   * Get a count of the number of audits that have been completed each day.
   */
  def getAllAuditCounts = UserAwareAction.async { implicit request =>
    val auditCounts = AuditTaskTable.auditCounts
    val json = Json.arr(auditCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }

  /**
   * Get a count of the number of labels that have been added each day.
   */
  def getAllLabelCounts = UserAwareAction.async { implicit request =>
    val labelCounts = LabelTable.selectLabelCountsPerDay
    val json = Json.arr(labelCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }

  /**
   * Get a count of the number of validations that have been completed each day.
   */
  def getAllValidationCounts = UserAwareAction.async { implicit request =>
    val validationCounts = LabelValidationTable.getValidationsByDate
    val json = Json.arr(validationCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }

  def setUserOrg(orgId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val userId: UUID = user.userId
        if (user.role.getOrElse("") != "Anonymous") {
          val allUserOrgs: List[Int] = UserOrgTable.getAllOrgs(userId);
          if (allUserOrgs.headOption.isEmpty) {
            UserOrgTable.save(userId, orgId)
          } else if (allUserOrgs.head != orgId) {
            UserOrgTable.remove(userId, allUserOrgs.head)
            UserOrgTable.save(userId, orgId)
          }
        }
        Future.successful(Ok(Json.obj("user_id" -> userId, "org_id" -> orgId)))
      case None =>  Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "Your user id could not be found."
      )))
    }
  }
}
