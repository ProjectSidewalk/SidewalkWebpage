package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import models.mission.{Mission, MissionTable, MissionUserTable}
import models.user.User
import play.api.libs.json._
import play.api.mvc.BodyParsers

import scala.concurrent.Future


class MissionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * Return the completed missions in a JSON array
    * @return
    */
  def getMissions = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val completedMissions: List[Mission] = MissionTable.selectCompletedMissionsByAUser(user.userId)
        val incompleteMissions: List[Mission] = MissionTable.selectIncompleteMissionsByAUser(user.userId)

        val completedMissionJsonObjects: List[JsObject] = completedMissions.map( m =>
          Json.obj("is_completed" -> true,
            "mission_id" -> m.missionId,
            "region_id" -> m.regionId,
            "label" -> m.label,
            "level" -> m.level,
            "distance" -> m.distance,
            "distance_ft" -> m.distance_ft,
            "distance_mi" -> m.distance_mi,
            "coverage" -> m.coverage)
        )

        val incompleteMissionJsonObjects: List[JsObject] = incompleteMissions.map( m =>
          Json.obj("is_completed" -> false,
            "mission_id" -> m.missionId,
            "region_id" -> m.regionId,
            "label" -> m.label,
            "level" -> m.level,
            "distance" -> m.distance,
            "distance_ft" -> m.distance_ft,
            "distance_mi" -> m.distance_mi,
            "coverage" -> m.coverage)
        )

        val concatenated = completedMissionJsonObjects ++ incompleteMissionJsonObjects
        Future.successful(Ok(JsArray(concatenated)))
      case _ =>
        Future.successful(Ok(JsArray(Seq())))
    }
  }

  def post = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
    val submission = request.body.validate[Seq[Mission]]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) =>
            for (mission <- submission) yield {
              // Check if duplicate user-mission exists. If not, save it.
              if (!MissionUserTable.exists(mission.missionId, user.userId.toString)) {
                MissionUserTable.save(mission.missionId, user.userId.toString)
              }
            }
          case _ =>
        }

        Future.successful(Ok(Json.obj()))
      }
    )
  }
}

