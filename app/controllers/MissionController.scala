package controllers

import java.util.UUID

import javax.inject.Inject
import java.sql.Timestamp

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import org.joda.time.{DateTime, DateTimeZone}
import controllers.headers.ProvidesHeader
import formats.json.MissionFormats._
import formats.json.TaskSubmissionFormats.AMTAssignmentCompletionSubmission
import models.mission.{Mission, MissionTable, MissionUserTable}
import models.street.StreetEdgeTable
import models.user.{User, UserCurrentRegionTable, UserRoleTable}
import models.amt.AMTAssignmentTable
import models.region.NamedRegion
import play.api.Logger
import play.api.libs.json._
import play.api.mvc.{Action, BodyParsers}

import scala.concurrent.Future


class MissionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val precision = 0.10
  val missionLength1000 = 1000.0
  val missionLength500 = 500.0
  val payPerMile = 4.17


  /**
    * Gets the next mission that the user should do in specified region.
    *
    * @param regionId
    * @return
    */
  def getNextMission(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        // TODO we shouldn't ever get to the part where the user has no missions left in the region; delete once we test
        val mission: Mission = if (!MissionTable.hasCompletedOnboarding(user.userId)) {
          MissionTable.getOnboardingMission
        } else if (MissionTable.isMissionAvailable(user.userId, regionId)) {
          MissionTable.selectIncompleteMissionsByAUser(user.userId, regionId).minBy(_.distance)
        } else {
          val newRegion: Option[NamedRegion] = UserCurrentRegionTable.assignRegion(user.userId)
          MissionTable.selectIncompleteMissionsByAUser(user.userId, newRegion.get.regionId).minBy(_.distance)
        }
        val missionObj: JsObject = Json.obj(
          "is_completed" -> false,
          "mission_id" -> mission.missionId,
          "region_id" -> mission.regionId,
          "label" -> mission.label,
          "level" -> mission.level,
          "distance" -> mission.distance,
          "distance_ft" -> mission.distance_ft,
          "distance_mi" -> mission.distance_mi,
          "coverage" -> mission.coverage
        )
        Future.successful(Ok(missionObj))

      // If the user doesn't already have an anonymous ID, sign them up and rerun.
      case _ => Future.successful(Redirect(s"/anonSignUp?url=/nextMission/$regionId"))
    }
  }

  /**
    * Return the completed missions in a JSON array
    * @return
    */
  def getMissions(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        // Get the missions for the currently assigned neighborhood.
        // Compute the distance traveled thus far.
        // Mark the missions that should be completed.
        val userCurrentRegion: Option[Int] = UserCurrentRegionTable.currentRegion(user.userId)
        if (userCurrentRegion.isDefined) {
          updateUnmarkedCompletedMissionsAsCompleted(user.userId, userCurrentRegion.get)
        }
        if (userCurrentRegion.isEmpty || userCurrentRegion.get != regionId)
          println(s"problem with /missions/:regionId endpoint: ${regionId}, ${userCurrentRegion}")

        val completedMissions: List[Mission] = MissionTable.selectCompletedMissionsByAUser(user.userId, regionId, includeOnboarding = true)

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
//        val incompleteMissions: List[Mission] = MissionTable.selectIncompleteMissionsByAUser(user.userId).filter(m => {
//          val coverage = m.coverage
//          val distanceFt = m.distance_ft.getOrElse(Double.PositiveInfinity)
//          val missionRegionId = m.regionId.getOrElse(-1)
//
//          !(coverage match {
//            case None =>
//              // Filter out original 1000-ft missions
//              ~=(distanceFt, missionLength1000, precision) ||
//              // Filter out new 500-ft mission if user has already completed original 1000-ft mission in that region
//              (regionsWhereOriginal1000FtMissionCompleted.exists(_ == missionRegionId) &&
//               ~=(distanceFt, missionLength500, precision))
//            case _ =>
//              // Filter out new 1000-ft mission if user has already completed original 1000-ft mission in that region
//              regionsWhereOriginal1000FtMissionCompleted.exists(_ == missionRegionId) &&
//              ~=(distanceFt, missionLength1000, precision)
//            }
//          )
//        })

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

//        val incompleteMissionJsonObjects: List[JsObject] = incompleteMissions.map( m =>
//          Json.obj("is_completed" -> false,
//            "mission_id" -> m.missionId,
//            "region_id" -> m.regionId,
//            "label" -> m.label,
//            "level" -> m.level,
//            "distance" -> m.distance,
//            "distance_ft" -> m.distance_ft,
//            "distance_mi" -> m.distance_mi,
//            "coverage" -> m.coverage)
//        )
//        val concatenated = completedMissionJsonObjects ++ incompleteMissionJsonObjects
        Future.successful(Ok(JsArray(completedMissionJsonObjects)))

        // If the user doesn't already have an anonymous ID, sign them up and rerun.
      case _ => Future.successful(Redirect(s"/anonSignUp?url=/missions/$regionId"))
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
                if(UserRoleTable.getRole(user.userId) == "Turker") {
                  MissionUserTable.save(mission.missionId, user.userId.toString, false, payPerMile)
                } else {
                  MissionUserTable.save(mission.missionId, user.userId.toString, false, 0.0)
                }
              }
            }
          case _ => Logger.error("User without a user_id completed a mission, but every user should have a user_id.")
        }

        Future.successful(Ok(Json.obj()))
      }
    )
  }

  def postAMTAssignment = Action.async(BodyParsers.parse.json) { implicit request =>
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


  /** If the dist a user has audited in a region implies that they should have completed more missions, add them.
    *
    * @param userId
    * @param regionId
    */
  def updateUnmarkedCompletedMissionsAsCompleted(userId: UUID, regionId: Int): Unit = {
    // Checks if user has completed original 1000-ft mission
    val completedMissions = MissionTable.selectCompletedMissionsByAUser(userId, regionId, includeOnboarding = false)
    val hasCompletedOriginal1000FtMission = completedMissions.exists(m => {
      val coverage = m.coverage
      val distanceFt = m.distance_ft.getOrElse(Double.PositiveInfinity)
      coverage match {
        case None => ~=(distanceFt, missionLength1000, precision)
        case _ => false
      }
    })

    val incompleteMissions = MissionTable.selectIncompleteMissionsByAUser(userId, regionId)
    val completedDistance_m = StreetEdgeTable.getDistanceAudited(userId, regionId)

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
      if(UserRoleTable.getRole(userId) == "Turker") {
        MissionUserTable.save(m.missionId, userId.toString, false, payPerMile)
      } else {
        MissionUserTable.save(m.missionId, userId.toString, false, 0.0)
      }

    }
  }

  def getRewardPerMile = Action.async { implicit request =>
    Future.successful(Ok(Json.obj("rewardPerMile" -> payPerMile)))
  }

}

