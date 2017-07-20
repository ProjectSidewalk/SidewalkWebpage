package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.IssueFormats._
import formats.json.TaskSubmissionFormats._
import formats.json.CommentSubmissionFormats._
import models.amt.{AMTAssignment, AMTAssignmentTable, AMTRouteAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.MissionTable
import models.route._
import models.region._
import models.street.{StreetEdgeAssignmentCountTable, StreetEdgeIssue, StreetEdgeIssueTable}
import models.turker.{Turker, TurkerTable}
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.ws._
import play.api.mvc._
import play.api.Play.current
import play.extras.geojson

import scala.concurrent.Future

/**
  * Condition controller
  */
class ConditionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  val anonymousUser: DBUser = UserTable.find("anonymous").get

  /**
    * Returns a condition page.
    *
    * @return
    */
  def assignIfNotExists= UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    // Get mTurk parameters
    // Map with keys ["assignmentId","hitId","turkSubmitTo","workerId"]
    val qString = request.queryString.map { case (k, v) => k.mkString -> v.mkString }
    //println(timestamp + " " + qString)

    var screenStatus: String = null
    var hitId: String = null
    var assignmentId: String = null
    var workerId: String = null
    var turkSubmitTo: String = null
    if (qString.nonEmpty && qString.contains("assignmentId")) {

      assignmentId = qString("assignmentId")

      if (qString("assignmentId") != "ASSIGNMENT_ID_NOT_AVAILABLE") {
        // User clicked the ACCEPT HIT button
        hitId = qString("hitId")
        workerId = qString("workerId")
        turkSubmitTo = qString("turkSubmitTo")
        screenStatus = "Assigned"
      }
      else {
        screenStatus = "Preview"
      }
    }
    else {
      screenStatus = "Blank"
    }
    val r = new scala.util.Random
    val conditionId = 1+r.nextInt(3)
    Future.successful(Redirect(routes.AuditController.audit.url +s"?turkSubmitTo=$turkSubmitTo&workerId=$workerId&assignmentId=$assignmentId&hitId=$hitId&conditionId=$conditionId"))
  }

}
