package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import models.mission.{Mission, MissionTable, MissionUserTable}
import models.user.User
import play.api.libs.json.{JsArray, JsError, JsValue, Json}
import play.api.mvc.BodyParsers

import scala.concurrent.Future


class MissionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
    * Return all the missions in a JSON array
    * @return
    */
  def getAllMissions = UserAwareAction.async { implicit request =>
    val missions: List[JsValue] = MissionTable.all.map(m => Json.toJson(m))
    Future.successful(Ok(JsArray(missions)))
  }

  /**
    * Return the completed missions in a JSON array
    * @return
    */
  def getCompletedMissions = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val missions = MissionTable.completed(user.userId).map(m => Json.toJson(m))
        Future.successful(Ok(JsArray(missions)))
      case _ =>
        Future.successful(Ok(JsArray(Seq())))
    }
  }

  /**
    * Return the completed missions in the given area
    * @param regionId Region id
    * @return
    */
  def getCompletedMissionsInRegion(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val missions = MissionTable.completed(user.userId, regionId).map(m => Json.toJson(m))
        Future.successful(Ok(JsArray(missions)))
      case _ =>
        Future.successful(Ok(JsArray(Seq())))
    }
  }

  /**
    * Return incomplete missions
    * @return
    */
  def getIncompleteMissions = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val missions = MissionTable.incomplete(user.userId).map(m => Json.toJson(m))
        Future.successful(Ok(JsArray(missions)))
      case _ =>
        val missions = MissionTable.all.map(m => Json.toJson(m))
        Future.successful(Ok(JsArray(missions)))
    }
  }

  /**
    * Return incomplete missions in the given region
    * @param regionId Region id
    * @return
    */
  def getIncompleteMissionsInRegion(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val missions = MissionTable.incomplete(user.userId, regionId).map(m => Json.toJson(m))
        Future.successful(Ok(JsArray(missions)))
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

