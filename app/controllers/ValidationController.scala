package controllers

import java.sql.Timestamp
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.CommentSubmissionFormats._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.mission.Mission
import models.mission.MissionTable
import models.user._
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.Logger
import play.api.mvc._

import scala.concurrent.Future

class ValidationController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {
  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
    * Returns the validation page.
    * @return
    */
  def validate = UserAwareAction.async { implicit request =>
    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)
    val ipAddress: String = request.remoteAddress

    request.identity match {
      case Some(user) =>
        // println(user)
        val mission: Mission = MissionTable.resumeOrCreateNewValidationMission(user.userId, 0.0, 0.0).get
        Future.successful(Ok(views.html.validation("Project Sidewalk - Validate", Some(user), mission)))
      case None =>
        Future.successful(Redirect("/"))
    }
  }

  /**
    * This method handles a comment POST request. It parse the comment and insert it into the comment table
    *
    * @return
    */
  def postComment = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[ValidationCommentSubmission]
    println("[ValidationController] postComment submission: " + submission)
    submission.fold(
      errors => {
        println("[ValidationController] Error")
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        println("[ValidationController] Success!")
        Future.successful(Ok)
      }
    )
  }
}