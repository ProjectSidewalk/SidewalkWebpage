package models.mission

import java.util.UUID

import models.daos.slick.DBTableDefinitions.UserTable
import models.utils.MyPostgresDriver.simple._
import models.region._
import play.api.Play.current
import play.api.libs.json.{JsObject, Json}

import scala.slick.lifted.ForeignKeyQuery
import scala.slick.jdbc.{GetResult, StaticQuery => Q}


case class RegionalMission(missionId: Int, regionId: Option[Int], regionName: Option[String], label: String, level: Int, distance: Option[Double], distance_ft: Option[Double], distance_mi: Option[Double], coverage: Option[Double])
case class Mission(missionId: Int, regionId: Option[Int], label: String, level: Int, distance: Option[Double], distance_ft: Option[Double], distance_mi: Option[Double], coverage: Option[Double], deleted: Boolean) {
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
  val users = TableQuery[UserTable]
  val regionProperties = TableQuery[RegionPropertyTable]
  val regions = TableQuery[RegionTable]
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)

  val missionsWithoutDeleted = missions.filter(_.deleted === false)

  implicit val missionConverter = GetResult[Mission](r => {
    // missionId: Int, regionId: Option[Int], label: String, level: Int, distance: Option[Double], distance_ft: Option[Double], distance_mi: Option[Double], coverage: Option[Double], deleted: Boolean
    // Int, Option[Int], String, Int, Option[Double], Option[Double], Option[Double], Option[Double], Boolean
    val missionId: Int = r.nextInt
    val regionId: Option[Int] = r.nextIntOption
    val label: String = r.nextString
    val level: Int = r.nextInt
    val distance: Option[Double] = r.nextDoubleOption
    val distance_ft: Option[Double] = r.nextDoubleOption
    val distance_mi: Option[Double] = r.nextDoubleOption
    val coverage: Option[Double] = r.nextDoubleOption
    val deleted: Boolean = r.nextBoolean
    Mission(missionId, regionId, label, level, distance, distance_ft, distance_mi, coverage, deleted)
  })

  case class MissionCompletedByAUser(username: String, label: String, level: Int, distance_m: Option[Double], distance_ft: Option[Double], distance_mi: Option[Double])

  /**
    * Count the number of missions completed by a user
    *
    * @param userId
    * @return
    */
  def countCompletedMissionsByUserId(userId: UUID): Int = db.withTransaction { implicit session =>
    val completedMissions = selectCompletedMissionsByAUser(userId)
    val missionsWithoutOnboarding = completedMissions.filter(_.label != "onboarding")
    missionsWithoutOnboarding.size
  }

  /**
    * This method checks if there are missions remaining for the given user
    *
    * @param userId User id
    * @param regionId Region id
    * @return
    */
  def isMissionAvailable(userId: UUID, regionId: Int): Boolean = db.withSession { implicit session =>
    val incompleteMissions = selectIncompleteMissionsByAUser(userId, regionId)
    incompleteMissions.nonEmpty
  }


  /**
    * Get a list of all the completed tasks
    *
    * @param userId User's UUID
    * @return
    */
  def selectCompletedMissionsByAUser(userId: UUID): List[Mission] = db.withSession { implicit session =>
    val _missions = for {
      (_missions, _missionUsers) <- missionsWithoutDeleted.innerJoin(missionUsers).on(_.missionId === _.missionId)
      if _missionUsers.userId === userId.toString
    } yield _missions

    _missions.list.groupBy(_.missionId).map(_._2.head).toList
  }

  /**
    * Get the list of the completed tasks in the given region for the given user
    *
    * @param userId User's UUID
    * @param regionId region Id
    * @return
    */
  def selectCompletedMissionsByAUser(userId: UUID, regionId: Int): List[Mission] = db.withSession { implicit session =>
    val completedMissions: List[Mission] = selectCompletedMissionsByAUser(userId)
    completedMissions.filter(_.regionId.getOrElse(-1) == regionId)
  }

  /**
    * Select missions with neighborhood names
    * @param userId
    * @return
    */
  def selectCompletedRegionalMission(userId: UUID): List[RegionalMission] = db.withSession { implicit session =>
    val missions = for {
      (_missions, _missionUsers) <- missionsWithoutDeleted.innerJoin(missionUsers).on(_.missionId === _.missionId)
      if _missionUsers.userId === userId.toString
    } yield _missions


    val regionalMissions = for {
      (_m, _r) <- missions.innerJoin(regionProperties).on(_.regionId === _.regionId)
      if _r.key === "Neighborhood Name"
    } yield (_m.missionId, _m.regionId, _r.value.?, _m.label, _m.level, _m.distance, _m.distance_ft, _m.distance_mi, _m.coverage)

    regionalMissions.sortBy(rm => (rm._2.getOrElse(1).asc, rm._6.getOrElse(0.0))).list.map(rm => RegionalMission.tupled(rm))
  }

  /**
    * Get a list of the incomplete missions for the given user
    *
    * @param userId User's UUID
    * @return
    */
  def selectIncompleteMissionsByAUser(userId: UUID): List[Mission] = db.withSession { implicit session =>
    val selectIncompleteMissionQuery = Q.query[String, Mission](
      """SELECT mission.mission_id, mission.region_id, mission.label, mission.level, mission.distance, mission.distance_ft, mission.distance_mi, mission.coverage, mission.deleted
        |  FROM sidewalk.mission
        |LEFT JOIN (
        |    SELECT mission.mission_id
        |      FROM sidewalk.mission
        |    LEFT JOIN sidewalk.mission_user
        |      ON mission.mission_id = mission_user.mission_id
        |    WHERE mission.deleted = false
        |    AND mission_user.user_id = ?
        |) AS completed_mission
        |  ON mission.mission_id = completed_mission.mission_id
        |WHERE deleted = false AND completed_mission.mission_id IS NULL""".stripMargin
    )
    val incompleteMissions: List[Mission] = selectIncompleteMissionQuery(userId.toString).list
    incompleteMissions
  }

  /**
    * Get a list of incomplete missions in the give region for the given user
    *
    * @param userId User's UUID
    * @param regionId Region Id
    * @return
    */
  def selectIncompleteMissionsByAUser(userId: UUID, regionId: Int): List[Mission] = db.withSession { implicit session =>
    val incompleteMissions: List[Mission] = selectIncompleteMissionsByAUser(userId)
    incompleteMissions.filter(_.regionId.getOrElse(-1) == regionId)
  }

  /**
    * Get a set of regions where the user has not completed all the missions.
    *
    * @param userId UUID for the user
    * @return
    */
  def selectIncompleteRegions(userId: UUID): Set[Int] = db.withSession { implicit session =>
    val incompleteMissions: List[Mission] = selectIncompleteMissionsByAUser(userId)
    val incompleteRegions: Set[Int] = incompleteMissions.map(_.regionId).flatten.toSet
    incompleteRegions
  }

  /**
    * Returns all the missions
    *
    * @return A list of Mission objects.
    */
  def selectMissions: List[Mission] = db.withSession { implicit session =>
    missionsWithoutDeleted.list
  }

  /**
    * Returns mturk mission
    */

  def selectMTurkMission: List[Mission] = db.withSession { implicit session =>
    missionsWithoutDeleted.filter(_.label inSet List("mturk-mission","onboarding")).list
    //missionsWithoutDeleted.filter(l => l.label === "mturk-mission" || l.label ===  "onboarding").list
  }

  def selectMTurkMissionByRegion(regionId: Option[Int]): List[Mission] = db.withSession { implicit session =>
    missionsWithoutDeleted.filter(_.label inSet List("mturk-mission")).filter(_.regionId === regionId).list ++ missionsWithoutDeleted.filter(_.label inSet List("onboarding")).list
    //missionsWithoutDeleted.filter(l => l.label === "mturk-mission" || l.label ===  "onboarding").list
  }

  /**
    * Select a list of missions completed by users
    * @return
    */
  def selectMissionsCompletedByUsers: List[MissionCompletedByAUser] = db.withSession { implicit session =>
    val _missions = for {
      (_missions, _missionUsers) <- missionsWithoutDeleted.innerJoin(missionUsers).on(_.missionId === _.missionId)
    } yield (_missions.label, _missions.level, _missionUsers.userId, _missions.distance, _missions.distance_ft, _missions.distance_mi)

    val _missionsCompleted = for {
      (_users, _missions) <- users.innerJoin(_missions).on(_.userId === _._3)
    } yield (_users.username, _missions._1, _missions._2, _missions._4, _missions._5, _missions._6)

    _missionsCompleted.list.map(x => MissionCompletedByAUser.tupled(x))
  }

  /**
    * Select mission counts by user
    *
    * @ List[(user_id,count)]
    */
  def selectMissionCountsPerUser: List[(String, Int)] = db.withSession { implicit session =>
    val _missions = for {
      (_missions, _missionUsers) <- missionsWithoutDeleted.innerJoin(missionUsers).on(_.missionId === _.missionId)
    } yield _missionUsers.userId

    _missions.groupBy(m => m).map{ case(id, group) => (id, group.length)}.list
  }
}
