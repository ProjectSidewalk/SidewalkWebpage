package controllers

import java.util.UUID
import javax.inject.Inject
import java.sql.Timestamp

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import org.joda.time.{DateTime, DateTimeZone}
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import formats.json.TaskSubmissionFormats.{AMTAssignmentCompletionSubmission}
import models.mission.{Mission, MissionTable, MissionUserTable}
import models.street.StreetEdgeTable
import models.user.{User, UserCurrentRegionTable}
import models.amt.{AMTAssignment, AMTAssignmentTable}
import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS
import play.api.libs.json._
import play.api.mvc.BodyParsers

import scala.concurrent.Future


class MissionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val precision = 0.10
  val missionLength1000 = 1000.0
  val missionLength500 = 500.0

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

        // Finds the regions where the user has completed the original 1000-ft mission
        // Filters original 1000-ft mission out from incomplete missions for each region since it has been replaced by
        // new 500-ft and 1000-ft mission (https://github.com/ProjectSidewalk/SidewalkWebpage/issues/841)
        // If user has already completed the original 1000-ft mission in a region, filters out the new 500-ft and 
        // 1000-ft missions in that region
        val regionsWhereOriginal1000FtMissionCompleted = completedMissions.filter(m => {
          val coverage = m.coverage
          val distanceFt = m.distance_ft.getOrElse(Double.PositiveInfinity)
          coverage match {
            case None => ~=(distanceFt, missionLength1000, precision)
            case _ => false
          }
        }).map(_.regionId.getOrElse(-1)).filter(_ != -1)
        val incompleteMissions: List[Mission] = MissionTable.selectIncompleteMissionsByAUser(user.userId).filter(m => {
          val coverage = m.coverage
          val distanceFt = m.distance_ft.getOrElse(Double.PositiveInfinity)
          val missionRegionId = m.regionId.getOrElse(-1)

          !(coverage match {
            case None => 
              // Filter out original 1000-ft missions
              ~=(distanceFt, missionLength1000, precision) ||
              // Filter out new 500-ft mission if user has already completed original 1000-ft mission in that region
              (regionsWhereOriginal1000FtMissionCompleted.exists(_ == missionRegionId) &&
               ~=(distanceFt, missionLength500, precision))
            case _ =>
              // Filter out new 1000-ft mission if user has already completed original 1000-ft mission in that region
              regionsWhereOriginal1000FtMissionCompleted.exists(_ == missionRegionId) &&
              ~=(distanceFt, missionLength1000, precision)
            }
          )
        })

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



      // For anonymous users
      case _ =>
        // Selects all missions except the original 1000-ft mission
        val missions = MissionTable.selectMissions.filter(m => {
          val coverage = m.coverage
          val distanceFt = m.distance_ft.getOrElse(Double.PositiveInfinity)
          coverage match {
            case None => !(~=(distanceFt, missionLength1000, precision))
            case _ => true
          }
        })
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
                MissionUserTable.save(mission.missionId, user.userId.toString, false)
              }
            }
          case _ =>
        }

        Future.successful(Ok(Json.obj()))
      }
    )
  }

  def postAMTAssignment = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson

    val submission = request.body.validate[AMTAssignmentCompletionSubmission]

    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val amtAssignmentId: Option[Int] = Option(submission.assignmentId)
        amtAssignmentId match {
          case Some(asgId) =>
            // Update the AMTAssignmentTable
            AMTAssignmentTable.updateAssignmentEnd(asgId, timestamp)
            AMTAssignmentTable.updateCompleted(asgId, completed=true)
            Future.successful(Ok(Json.obj("success" -> true)))
          case None =>
            Future.successful(Ok(Json.obj("success" -> false)))
        }
      }
    )
  }


  // Approximate equality check for Doubles
  // https://alvinalexander.com/scala/how-to-compare-floating-point-numbers-in-scala-float-double
  def ~=(x: Double, y: Double, precision: Double) = { // Approximate equality check for Doubles
    if ((x - y).abs < precision) true else false
  }


  /**
    *
    * @param userId
    * @param regionId
    */
  // Checks total audit distance for a user in a particular region
  // Creates MissionUser entries for missions in that region whose distance is less than user's total audited distance
  // in the region
  def updatedUnmarkedCompletedMissionsAsCompleted(userId: UUID, regionId: Int): Unit = {
    // Checks if user has completed original 1000-ft mission
    val completedMissions = MissionTable.selectCompletedMissionsByAUser(userId, regionId)
    val hasCompletedOriginal1000FtMission = completedMissions.exists(m => {
      val coverage = m.coverage
      val distanceFt = m.distance_ft.getOrElse(Double.PositiveInfinity)
      coverage match {
        case None => ~=(distanceFt, missionLength1000, precision)
        case _ => false
      }
    })

    val incompleteMissions = MissionTable.selectIncompleteMissionsByAUser(userId, regionId)

    // Calculates total distance audited in the region by this user
    val streets = StreetEdgeTable.selectStreetsAuditedByAUser(userId, regionId)
    val CRSEpsg4326 = CRS.decode("epsg:4326")
    val CRSEpsg26918 = CRS.decode("epsg:26918")
    val transform = CRS.findMathTransform(CRSEpsg4326, CRSEpsg26918)
    val completedDistance_m = streets.map(s => JTS.transform(s.geom, transform).getLength).sum

    // If User has audited more distance than a particular mission's distance in this region, marks the mission as
    // completed, unless user has completed original 1000-ft mission (in which case the new 500-ft and 1000-ft 
    // missions are not marked as completed). Also does not mark original 1000-ft mission as completed, ever
    val missionsToComplete = incompleteMissions.filter(m => {
      val distance = m.distance.getOrElse(Double.PositiveInfinity)
      val distanceFt = m.distance_ft.getOrElse(Double.PositiveInfinity)
      val coverage = m.coverage

      distance < completedDistance_m &&
      !(coverage match {
        case None => (
          // Does not mark original 1000-ft mission as completed
          ~=(distanceFt, missionLength1000, precision) ||
          // Does not mark new 500-ft mission as completed if user has already completed original 1000-ft mission
          (hasCompletedOriginal1000FtMission && ~=(distanceFt, missionLength500, precision))
        )
        case _ => (
          // Does not mark new 1000-ft mission as completed if user has already completed original 1000-ft mission
          hasCompletedOriginal1000FtMission && ~=(distanceFt, missionLength1000, precision)
        )
      })
    })
    missionsToComplete.foreach { m =>
      MissionUserTable.save(m.missionId, userId.toString, false)
    }
  }

  def getRewardPerMile = UserAwareAction.async { implicit request =>
    val rewardPerMile = 4.73
    Future.successful(Ok(Json.obj("reward_per_mile" -> rewardPerMile)))
  }

}

