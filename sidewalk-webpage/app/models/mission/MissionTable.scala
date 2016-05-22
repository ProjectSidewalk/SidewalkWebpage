package models.mission

import java.util.UUID

import models.utils.MyPostgresDriver.simple._
import models.region._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.slick.lifted.ForeignKeyQuery

case class Mission(missionId: Int, regionId: Option[Int], label: String, level: Int, distance: Option[Double],
                   distance_ft: Option[Double], distance_mi: Option[Double], coverage: Option[Double], deleted: Boolean) {
  def completed(status: MissionStatus): Boolean = label match {
    case "initial-mission" =>
      if (this.distance.getOrElse(Double.PositiveInfinity) < status.currentRegionDistance) true else false
    case "distance-mission" =>
      if (this.distance.getOrElse(Double.PositiveInfinity) < status.currentRegionDistance) true else false
    case "area-coverage-mission" =>
      if (this.distance.getOrElse(Double.PositiveInfinity) < status.currentRegionDistance) true else false
    case "neighborhood-coverage-mission" =>
      if (this.level <= status.totalNumberOfRegionsCompleted) true else false
    case _ => false
  }

  def toJSON: JsObject = {
    Json.obj("mission_id" -> missionId, "region_id" -> regionId, "label" -> label, "level" -> level, "distance" -> distance, "coverage" -> coverage)
  }
}

case class MissionStatus(currentRegionDistance: Double, currentRegionCoverage: Double, totalNumberOfRegionsCompleted: Int)

class MissionTable(tag: Tag) extends Table[Mission](tag, Some("sidewalk"), "mission") {
  def missionId = column[Int]("mission_id", O.PrimaryKey, O.AutoInc)
  def regionId = column[Option[Int]]("region_id", O.Nullable)
  def label = column[String]("label", O.NotNull)
  def level = column[Int]("level", O.NotNull)
  def distance = column[Option[Double]]("distance", O.Nullable)
  def distance_ft = column[Option[Double]]("distance_ft", O.Nullable)
  def distance_mi = column[Option[Double]]("distance_mi", O.Nullable)
  def coverage = column[Option[Double]]("coverage", O.Nullable)
  def deleted = column[Boolean]("deleted", O.NotNull)

  def * = (missionId, regionId, label, level, distance, distance_ft, distance_mi, coverage, deleted) <> ((Mission.apply _).tupled, Mission.unapply)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("mission_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

object MissionTable {
  val db = play.api.db.slick.DB
  val missions = TableQuery[MissionTable]
  val missionUsers = TableQuery[MissionUserTable]

  /**
    * Returns all the missions
    *
    * @return A list of SidewalkEdge objects.
    */
  def all: List[Mission] = db.withSession { implicit session =>
    missions.filter(_.deleted === false).list
  }

  /**
    * Get a list of all the completed tasks
    * @param userId User's UUID
    * @return
    */
  def completed(userId: UUID): List[Mission] = db.withSession { implicit session =>
    val _missions = for {
      (_missions, _missionUsers) <- missions.innerJoin(missionUsers).on(_.missionId === _.missionId) if !_missions.deleted && _missionUsers.userId === userId.toString
    } yield _missions
    _missions.list
  }

  /**
    * Get the list of the completed tasks in the given region for the given user
    * @param userId User's UUID
    * @param regionId region Id
    * @return
    */
  def completed(userId: UUID, regionId: Int): List[Mission] = db.withSession { implicit session =>
    val missionUsersQuery = missionUsers.filter(_.userId === userId.toString)
    val _missions = for {
      (_missions, _missionUsers) <- missions.innerJoin(missionUsersQuery).on(_.missionId === _.missionId) if !_missions.deleted
    } yield _missions
    _missions.filter(_.regionId.getOrElse(-1) === regionId).list
  }

  /**
    * Get a list of the incomplete missions for the given user
    * @param userId User's UUID
    * @return
    */
  def incomplete(userId: UUID): List[Mission] = db.withSession { implicit session =>
    val missionUsersQuery = missionUsers.filter(_.userId === userId.toString)
    val _missions = for {
      (_missions, _missionUsers) <- missions.leftJoin(missionUsersQuery).on(_.missionId === _.missionId)
      if !_missions.deleted && _missionUsers.missionUserId.?.isEmpty
    } yield _missions

    _missions.list
  }

  /**
    * Get a list of incomplete missions in the give region for the given user
    * @param userId User's UUID
    * @param regionId Region Id
    * @return
    */
  def incomplete(userId: UUID, regionId: Int): List[Mission] = db.withSession { implicit session =>
    val missionUsersQuery = missionUsers.filter(_.userId === userId.toString)
    val _missions = for {
      (_missions, _missionUsers) <- missions.leftJoin(missionUsersQuery).on(_.missionId === _.missionId)
      if !_missions.deleted && _missionUsers.missionUserId.?.isEmpty
    } yield _missions
    _missions.filter(_.regionId.getOrElse(-1) === regionId).list
  }

  /**
    * Get a set of regions where the user has not completed all the missions.
    *
    * @param userId
    * @return
    */
  def incompleteRegions(userId: UUID): Set[Int] = db.withSession { implicit session =>
    val missionUsersQuery = missionUsers.filter(_.userId === userId.toString)
    val _missions = for {
      (_missions, _missionUsers) <- missions.leftJoin(missionUsersQuery).on(_.missionId === _.missionId)
      if !_missions.deleted && _missionUsers.userId === userId.toString && _missions.regionId.nonEmpty
    } yield _missions

    _missions.list.map(_.regionId.get).toSet
  }

  /**
    * Save a mission. Irankunai?
    * @param mission
    * @return
    */
  def save(mission: Mission): Int = db.withTransaction { implicit session =>
    val missionId: Int =
      (missions returning missions.map(_.missionId)) += mission
    missionId
  }
}
