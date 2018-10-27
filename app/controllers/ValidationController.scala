package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.IssueFormats._
import formats.json.CommentSubmissionFormats._
import models.audit._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.MissionTable
import models.region._
import models.street.{StreetEdgeIssue, StreetEdgeIssueTable}
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future

class ValidationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /*
  def validate() = Action {implicit request =>
    request.identity match {
        Ok(views.html.validation())
    }
    // Ok("Got request [" + request + "]")
  }
  */

  // Returns validation endpoint
  def validate = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        Future.successful(Ok(views.html.validation("Project Sidewalk - Validate", Some(user))))
      case None =>
        Future.successful(Redirect("/"))
    }
  }
}