package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import models.user.User
import play.api.mvc.BodyParsers
import java.util.UUID
import scala.concurrent.Future
import play.api.libs.json.Json


class ImageController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def saveImage = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>

    val jsonBody = request.body

    System.out.println("userId: ")

//    var submission = request.body.validate[LabelMapValidationCommentSubmission]
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
//      },
//      submission => {

//        // Get the (or create a) mission_id for this user_id and label_type_id.
//        val labelTypeId: Int = LabelTypeTable.labelTypeToId(submission.labelType)
//        val mission: Mission =
//          MissionTable.resumeOrCreateNewValidationMission(userId, 0.0D, 0.0D, "labelmapValidation", labelTypeId).get
//
//        val ipAddress: String = request.remoteAddress
//        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//
//        val comment = ValidationTaskComment(0, mission.missionId, submission.labelId, userId.toString,
//          ipAddress, submission.gsvPanoramaId, submission.heading, submission.pitch,
//          submission.zoom, submission.lat, submission.lng, timestamp, submission.comment)
//
//        val commentId: Int = ValidationTaskCommentTable.save(comment)
//        Future.successful(Ok(Json.obj("commend_id" -> commentId)))
//      }
//    )
    Future.successful(Ok(Json.obj("commend_id" -> "commentId")))
  }
}
