package models.mission

import java.util.UUID
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

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
  def linkedMission: ForeignKeyQuery[MissionTable, Mission] =
    foreignKey("mission_progress_cvgroundtruth_linked_mission_id_fkey", linkedMissionId, TableQuery[MissionTable])(_.missionId)
}

object MissionProgressCVGroundtruthTable {
  val db: Database = play.api.db.slick.DB
  val cvMissionPanoStatuses: TableQuery[MissionProgressCVGroundtruthTable] = TableQuery[MissionProgressCVGroundtruthTable]

  /**
    * Fetches the remaining panos that still need to be audited for a particular user and ground truth audit mission.
    *
    * @param userId a user id
    * @param missionId the id of a ground truth audit mission that belongs to this user
    * @return a list of panoIds that still need to be audited in this mission
    */
  def getRemainingPanos(userId:UUID, missionId: Int): List[String] = db.withSession { implicit session =>
    val remaining: Query[Column[String], String, Seq] = for {
      _panostatuses <- cvMissionPanoStatuses
      _missions <- MissionTable.missions if _panostatuses.linkedMissionId === _missions.missionId
      if  _panostatuses.linkedMissionId === missionId && !_panostatuses.completed && _missions.userId === userId.toString
    } yield _panostatuses.panoId

    remaining.list
  }

  /**
    * Marks a pano complete and updates the database. If all panos complete, entire mission is also marked as complete.
    *
    * @param userId a user id
    * @param missionId id of a CV ground truth audit mission belonging to this user
    * @param panoId a panoID that is part of the mission, to mark as complete
    */
  def markPanoComplete(userId: UUID, missionId: Int, panoId: String) = db.withSession { implicit session =>
    cvMissionPanoStatuses.filter(panoStatus =>
      panoStatus.linkedMissionId === missionId &&
      panoStatus.panoId === panoId
    ).map(c => c.completed).update(true)

    // Get remaining incomplete panos for this mission. If none left, mark mission complete.
    val remaining: List[String] = getRemainingPanos(userId, missionId)
    if (remaining.isEmpty) {
      MissionTable.updateComplete(missionId)
    }
  }

  /**
    * Gets the lat/lng position of a panoid that is part of an active CV ground truth audit mission.
    * Note: these lat/lng positions are supplied by the client when the ground truth audit mission is created.
    * @param userId a user id
    * @param panoId a panoId that is part of an active CV ground truth audit mission for this user
    * @return a lat/lng tuple specifying the location of the pano
    */
  def getPanoLatLng(userId: UUID, panoId: String):(Option[Float],Option[Float]) = db.withSession { implicit session =>
    val activeMission: Option[Mission] = MissionTable.getIncompleteCVGroundTruthMission(userId)
    activeMission match {
      case Some(mission) =>
        val result: CVMissionPanoStatus = cvMissionPanoStatuses.filter(statusEntry =>
          statusEntry.linkedMissionId === mission.missionId &&
          statusEntry.panoId === panoId
        ).take(1).first
        (Some(result.lat), Some(result.lng))
      case None =>
        (None, None)
    }
  }

  /**
    * Adds a new row to the table.
    */
  def save(requiredPanoStatus: CVMissionPanoStatus): Int = db.withTransaction { implicit session =>
    val requiredPanoStatusId: Int =
      (cvMissionPanoStatuses returning cvMissionPanoStatuses.map(_.itemId)) += requiredPanoStatus
    requiredPanoStatusId
  }
}
