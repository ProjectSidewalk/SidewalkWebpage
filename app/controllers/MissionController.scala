package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import models.mission.{Mission, MissionTable, MissionUserTable}
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
        val regionsWhereOriginal1000FtMissionCompleted = completedMissions.filter(m => 
          m.coverage match {
            case None => ~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 1000.0, 0.10)
            case _ => false
          }
        ).map(_.regionId.getOrElse(-1)).filter(_ != -1)
        val incompleteMissions: List[Mission] = MissionTable.selectIncompleteMissionsByAUser(user.userId).filter(m =>
          !(m.coverage match {
            case None => 
              ~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 1000.0, 0.10) ||
              regionsWhereOriginal1000FtMissionCompleted.exists(_ == m.regionId.getOrElse(-1)) && ~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 500.0, 0.10)
            case _ =>
              regionsWhereOriginal1000FtMissionCompleted.exists(_ == m.regionId.getOrElse(-1)) && ~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 1000.0, 0.10)
            }
          )
        )

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
        val missions = MissionTable.selectMissions.filter(m => 
          m.coverage match {
            case None => !(~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 1000.0, 0.10))
            case _ => true
          }
        ) // Don't include the original 1000-ft mission
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

  def ~=(x: Double, y: Double, precision: Double) = { // Approximate equality check for Doubles
    if ((x - y).abs < precision) true else false
  }

  /**
    *
    * @param userId
    * @param regionId
    */
  def updatedUnmarkedCompletedMissionsAsCompleted(userId: UUID, regionId: Int): Unit = {
    val completedMissions = MissionTable.selectCompletedMissionsByAUser(userId, regionId)
    val hasCompletedOriginal1000FtMission = completedMissions.exists(m => 
      m.coverage match {
        case None => ~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 1000.0, 0.10)
        case _ => false
      }
    )
    val missions = MissionTable.selectIncompleteMissionsByAUser(userId, regionId)
    val streets = StreetEdgeTable.selectStreetsAuditedByAUser(userId, regionId)
    val CRSEpsg4326 = CRS.decode("epsg:4326")
    val CRSEpsg26918 = CRS.decode("epsg:26918")
    val transform = CRS.findMathTransform(CRSEpsg4326, CRSEpsg26918)
    val completedDistance_m = streets.map(s => JTS.transform(s.geom, transform).getLength).sum

    // If User has audited more distance than a mission's distance in a particular region, mark the mission as completed
    val missionsToComplete = missions.filter(m =>
      m.distance.getOrElse(Double.PositiveInfinity) < completedDistance_m &&
      !(m.coverage match {
        case None => (
          (hasCompletedOriginal1000FtMission && ~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 500.0, 0.10)) ||
          ~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 1000.0, 0.10)
        )
        case _ => (
          hasCompletedOriginal1000FtMission && ~=(m.distance_ft.getOrElse(Double.PositiveInfinity), 1000.0, 0.10)
        ) // Don't add the new 500-ft and 1000-ft missions if the user has already completed the old 1000-ft mission
          // Don't add the old 1000-ft mission
      })
    )
    missionsToComplete.foreach { m =>
      MissionUserTable.save(m.missionId, userId.toString)
    }
  }
}

