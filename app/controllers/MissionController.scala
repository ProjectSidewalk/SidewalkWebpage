package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import models.mission.{Mission, MissionTable, MissionUserTable}
import models.turker.{Turker, TurkerTable}
import models.amt.{AMTVolunteerRouteTable,AMTAssignmentTable}
import models.route.{RouteTable}
import models.street.StreetEdgeTable
import models.user.{User, UserCurrentRegionTable}
import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS
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
        // Get the missions for the currently assigned neighborhood.
        // Compute the distance traveled thus far.
        // Mark the missions that should be completed.
        val regionId: Option[Int] = UserCurrentRegionTable.currentRegion(user.userId)
        if (regionId.isDefined) {
          updatedUnmarkedCompletedMissionsAsCompleted(user.userId, regionId.get)
        }

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
        val missions = MissionTable.selectMissions
        val missionJsonObjects: List[JsObject] = missions.map( m =>
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

        Future.successful(Ok(JsArray(missionJsonObjects)))
    }
  }

  /**
    * Return the completed missions in a JSON array
    * @return
    */
  def getMTurkMissions = UserAwareAction.async { implicit request =>
    request.identity match {
      case _ =>
        val mission = MissionTable.selectMTurkMission
        val missionJsonObjects: List[JsObject] = mission.map( m =>
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

        Future.successful(Ok(JsArray(missionJsonObjects)))
    }
  }

  def getMTurkMissionsByTurker(turkerId: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case _ =>
        val conditionId = TurkerTable.getConditionIdByTurkerId(turkerId).get
        val routeId = AMTVolunteerRouteTable.getRoutesByConditionId(conditionId).headOption
        val regionId = RouteTable.getRegionByRouteId(routeId)
        val mission = MissionTable.selectMTurkMissionByRegion(regionId)
        val completedMissionCount = AMTAssignmentTable.getCountOfCompletedByTurkerId(turkerId)

        val missionJsonObjects: List[JsObject] = mission.zipWithIndex.map( m =>
          Json.obj("is_completed" -> (m._2 < completedMissionCount),
            "mission_id" -> m._1.missionId,
            "region_id" -> m._1.regionId,
            "label" -> m._1.label,
            "level" -> m._1.level,
            "distance" -> m._1.distance,
            "distance_ft" -> m._1.distance_ft,
            "distance_mi" -> m._1.distance_mi,
            "coverage" -> m._1.coverage)
    )

        Future.successful(Ok(JsArray(missionJsonObjects)))
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

  /**
    *
    * @param userId
    * @param regionId
    */
  def updatedUnmarkedCompletedMissionsAsCompleted(userId: UUID, regionId: Int): Unit = {
    val missions = MissionTable.selectIncompleteMissionsByAUser(userId, regionId)
    val streets = StreetEdgeTable.selectStreetsAuditedByAUser(userId, regionId)
    val CRSEpsg4326 = CRS.decode("epsg:4326")
    val CRSEpsg26918 = CRS.decode("epsg:26918")
    val transform = CRS.findMathTransform(CRSEpsg4326, CRSEpsg26918)
    val completedDistance_m = streets.map(s => JTS.transform(s.geom, transform).getLength).sum

    val missionsToComplete = missions.filter(_.distance.getOrElse(Double.PositiveInfinity) < completedDistance_m)
    missionsToComplete.foreach { m =>
      MissionUserTable.save(m.missionId, userId.toString)
    }
  }
}

