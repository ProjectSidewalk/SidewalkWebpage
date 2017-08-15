/**
  * Created by manaswi on 5/10/17.
  */


package controllers

import java.sql.Timestamp
import java.util.{Calendar, Date, TimeZone, UUID}
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.TaskSubmissionFormats.{AMTRouteAssignmentSubmission, AuditTaskSubmission, EnvironmentSubmission, IncompleteTaskSubmission, TaskSubmission}
import models.amt.AMTAssignmentTable
import models.audit._
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable}
import models.label._
import models.mission.{Mission, MissionStatus, MissionTable}
import models.region._
import models.route.{Route, RouteStreet, RouteStreetTable, RouteTable}
import models.street.StreetEdgeAssignmentCountTable
import models.user.User
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.mvc.BodyParsers
import play.extras.geojson

import scala.util.control.Breaks._
import scala.concurrent.Future

/**
  * Street controller
  */
class RouteController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  case class TaskPostReturnValue(auditTaskId: Int, streetEdgeId: Int, completedMissions: List[Mission])


  /**
    * This returns a list of all the streets for a route
    * @return
    */
  def getStreetsOnARoute(routeId: Int) = UserAwareAction.async { implicit request =>

    val routeStreets = RouteStreetTable.getRouteStreets(routeId)
    val newTasks = AuditTaskTable.selectTasksOnARoute(routeId, routeStreets)
    implicit val rStreetWrites = Json.writes[RouteStreet]

    var rStreetsJsonObj: JsObject = Json.obj()

    var rList = routeStreets
    for (newTask <- newTasks) {
      val edgeId = newTask.edgeId
      val edgeIdString = edgeId.toString

      // TODO: Could be optimized to reduce the number of loops
      breakable {
        for (routeStreet <- routeStreets) {
          val streetId = routeStreet.current_street_edge_id

          if (edgeId == streetId) {
            val nextStreetId = routeStreet.next_street_edge_id
            val isStartEdge = routeStreet.isStartEdge
            val isEndEdge = routeStreet.isEndEdge
            val length = routeStreet.length

            val streetJson = edgeIdString -> Json.obj("task" -> newTask.toJSON, "next" -> nextStreetId,
              "length_mi" -> length, "isStartEdge" -> isStartEdge, "isEndEdge" -> isEndEdge)

            val newJson = rStreetsJsonObj.as[JsObject] + streetJson
            rStreetsJsonObj = newJson
            break
          }
        }
      }
    }

    Future.successful(Ok(rStreetsJsonObj))
  }

  def getRouteById(routeId: Int) = UserAwareAction.async { implicit request =>
    val route: Route = RouteTable.getRoute(Some(routeId)).get
    val routeJsonObj = Json.obj(
      "route_id" -> routeId,
      "street_count" -> route.streetCount,
      "route_length_mi" -> route.route_length_mi,
      "region_id" -> route.regionId
    )
    Future.successful(Ok(routeJsonObj))

  }

  def updateRouteAssignmentCompleteness(amtAssignmentId: Option[Int], routeAssignment: AMTRouteAssignmentSubmission): Unit = {
    val id = routeAssignment.assignmentId
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    AMTAssignmentTable.updateAssignmentEnd(id, timestamp)

    if (routeAssignment.completed.isDefined && routeAssignment.completed.get) {
      AMTAssignmentTable.updateCompleted(id, completed=true)
    }
  }

  /**
    * Parse the submitted data and insert them into tables.
    *
    * @return
    */
  def post = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson

    val submission = request.body.validate[AMTRouteAssignmentSubmission]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val amtAssignmentId: Option[Int] = Option(submission.assignmentId)

        // Update the AMTAssignmentTable
        updateRouteAssignmentCompleteness(amtAssignmentId, submission)
        Future.successful(Ok(Json.obj("success" -> true)))
      }
    )
  }
}
