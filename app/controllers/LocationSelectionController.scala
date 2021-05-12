package controllers

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.CVGroundTruthSubmissionFormats.{CVGroundTruthPanoIdSubmission, CVGroundTruthPanoidListSubmission}
import formats.json.IssueFormats._
import formats.json.CommentSubmissionFormats._
import models.amt.AMTAssignmentTable
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.label.LabelTable
import models.mission.{CVMissionPanoStatus, Mission, MissionProgressCVGroundtruthTable, MissionTable, MissionSetProgress}
import models.region._
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable, StreetEdgeRegionTable}
import models.user._
import play.api.libs.json._
import play.api.{Logger, Play}
import play.api.Play.current
import play.api.mvc._
import scala.concurrent.Future

/**
 * Holds HTTP requests associated with the Location Selection page.
 *
 * @param env The Silhouette environment.
 */
class LocationSelectionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * Returns a selection page.
    */
  def select() = UserAwareAction.async { implicit request =>
    val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
    val ipAddress: String = request.remoteAddress
    Future.successful(Ok(views.html.location("Project Sidewalk - Select Location")))
  }

}
