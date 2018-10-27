package controllers

import java.sql.Timestamp
import java.util.UUID

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.TaskSubmissionFormats._
import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.gsv.{GSVData, GSVDataTable, GSVLink, GSVLinkTable}
import models.label._
import models.mission.{Mission, MissionTable}
import models.region._
import models.street.{StreetEdgeAssignmentCountTable, StreetEdgePriorityTable}
import models.user.{User, UserCurrentRegionTable}
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Logger
import play.api.libs.json._
import play.api.mvc._

import scala.concurrent.Future

class ValidationTaskController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  case class TaskPostReturnValue(auditTaskId: Int, streetEdgeId: Int, mission: Option[Mission])
  /**
    * Parse submitted validation data and submit to tables
    * Useful info: https://www.playframework.com/documentation/2.6.x/ScalaJsonHttp
    * BodyParsers.parse.json in async
    */

  def post = UserAwareAction.async(BodyParsers.parse.json) {implicit request =>
    println("[request] " + request.body)
    var submission = request.body.validate[Seq[ValidationTaskSubmission]]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        for (data <- submission) yield {
          val validationId = data.validationId
          val labelId = data.labelId
          println("Validation Task ID: " + validationId + ", Label ID: " + labelId)
        }
        Future.successful(Ok(Json.obj("status" -> "Ok")))
      }
    )
  }

}
