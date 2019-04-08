package models.mission

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import models.amt.{AMTAssignment, AMTAssignmentTable}
import models.audit.AuditTaskTable
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import models.region._
import models.user.{RoleTable, UserRoleTable}
import models.label.{LabelTable, LabelTypeTable}
import models.region.RegionPropertyTable
import play.api.Logger
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.GetResult

case class CVMissionPanoStatus(itemId: Int, linkedMissionId: Int, panoId: String, completed: Boolean, lat: Float, lng: Float)

/**
  * For computer vision ground truth audit missions, this table tracks the list of panos that need to be audited.
  * @param tag
  */
class MissionProgressCVGroundtruthTable(tag: Tag) extends Table[CVMissionPanoStatus](tag, Some("sidewalk"), "mission_progress_cvgroundtruth") {
  def itemId: Column[Int] = column[Int]("item_id", O.PrimaryKey, O.AutoInc)
  def linkedMissionId: Column[Int] = column[Int]("linked_mission_id", O.NotNull)
  def panoId: Column[String] = column[String]("panoid", O.NotNull)
  def completed: Column[Boolean] = column[Boolean]("completed", O.NotNull)
  def lat: Column[Float] = column[Float]("lat", O.NotNull)
  def lng: Column[Float] = column[Float]("lng", O.NotNull)
  def * = (itemId, linkedMissionId, panoId, completed, lat, lng) <> ((CVMissionPanoStatus.apply _).tupled,
    CVMissionPanoStatus.unapply)
}

object MissionProgressCVGroundtruthTable {
  val db = play.api.db.slick.DB
  val cvMissionPanoStatuses = TableQuery[MissionProgressCVGroundtruthTable]

  /**
    * Fetches that remaining panos that still need to be audited for a particular user and ground truth audit mission.
    * @param userId a user id
    * @param missionId the id of a ground truth audit mission that belongs to this user
    * @return a list of panoIds that still need to be audited in this mission
    */
  def getRemainingPanos(userId:UUID, missionId: Int): List[String] = db.withSession { implicit session =>
    val statusesWithMission = for {
    (_panostatuses, _missions) <- cvMissionPanoStatuses.innerJoin(MissionTable.missions).on(_.linkedMissionId === _.missionId)
    } yield (_panostatuses.panoId, _panostatuses.completed, _panostatuses.linkedMissionId,_missions.userId)

    val remaining = statusesWithMission.filter(panoStatus =>
      panoStatus._3 === missionId &&
      !panoStatus._2 &&
      panoStatus._4 === userId.toString
    )
    remaining.list.map(x => x._1)
  }

  /**
    * Marks a pano complete and updates the database. If all panos are complete, the entire mission is also marked
    * as complete.
    *
    * @param userId a user id
    * @param missionId id of a CV ground truth audit mission belonging to this user
    * @param panoId a panoID that is part of the mission, to mark as complete
    * @return
    */
  def markPanoComplete(userId: UUID, missionId: Int, panoId: String) = db.withSession { implicit session =>
    cvMissionPanoStatuses.filter(panoStatus =>
      panoStatus.linkedMissionId === missionId &&
      panoStatus.panoId === panoId
    ).map(c => c.completed).update(true)

    // Count number of remaining incomplete panos for this mission. If 0, mark mission complete.
    val remaining = getRemainingPanos(userId, missionId)
    remaining match {
      case List() =>
        MissionTable.updateComplete(missionId)
      case _ =>
    }
  }

  /**
    * Gets the lat/lng position of a panoid that is part of an active CV ground truth audit mission.
    * Note: these lat/lng positions are supplied by the client when the ground truth audit mission is created.
    * @param userId a user id
    * @param panoId a panoId that is part of an active CV ground truth audit mission for this user
    * @return a lat/lng tuple specifing the location of the pano
    */
  def getPanoLatLng(userId: UUID, panoId: String):(Option[Float],Option[Float]) = db.withSession { implicit session =>
    val activeMission = MissionTable.getIncompleteCVGroundTruthMission(userId)
    activeMission match {
      case Some(mission) =>
        val result = cvMissionPanoStatuses.filter(statusEntry =>
          statusEntry.linkedMissionId === mission.missionId &&
          statusEntry.panoId === panoId
        ).take(1).list.head
        (Some(result.lat), Some(result.lng))
      case None =>
        (None, None)
    }
  }

  /**
    * Adds a new row to the table
    */
  def save(requiredPanoStatus: CVMissionPanoStatus): Int = db.withTransaction { implicit session =>
    val requiredPanoStatusId: Int =
      (cvMissionPanoStatuses returning cvMissionPanoStatuses.map(_.itemId)) += requiredPanoStatus
    requiredPanoStatusId
  }
}
