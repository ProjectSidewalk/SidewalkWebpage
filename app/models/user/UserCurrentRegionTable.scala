package models.user

import models.region.{NamedRegion, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.util.UUID
import models.mission.MissionTable

case class UserCurrentRegion(userCurrentRegionId: Int, userId: String, regionId: Int)

class UserCurrentRegionTable(tag: Tag) extends Table[UserCurrentRegion](tag, Some("sidewalk"), "user_current_region") {
  def userCurrentRegionId = column[Int]("user_current_region_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def regionId = column[Int]("region_id", O.NotNull)


  def * = (userCurrentRegionId, userId, regionId) <> ((UserCurrentRegion.apply _).tupled, UserCurrentRegion.unapply)
}

object UserCurrentRegionTable {
  val db = play.api.db.slick.DB
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]
  val regions = TableQuery[RegionTable]

  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)

  val experiencedUserMileageThreshold = 2.0

  def save(userId: UUID, regionId: Int): Int = db.withTransaction { implicit session =>
    val userCurrentRegion = UserCurrentRegion(0, userId.toString, regionId)
    val userCurrentRegionId: Int =
      (userCurrentRegions returning userCurrentRegions.map(_.userCurrentRegionId)) += userCurrentRegion
    userCurrentRegionId
  }

  /**
    * Checks if the given user is "experienced" (have audited at least 2 miles).
    */
  def isUserExperienced(userId: UUID): Boolean = db.withSession { implicit session =>
    MissionTable.getDistanceAudited(userId) > experiencedUserMileageThreshold
  }

  /**
    * Select an easy region w/ high avg street priority where the user hasn't completed all missions; assign it to them.
    */
  def assignEasyRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
    val newRegion: Option[NamedRegion] = RegionTable.selectAHighPriorityEasyRegion(userId)
    newRegion.map(r => saveOrUpdate(userId, r.regionId)) // If region successfully selected, assign it to them.
    newRegion
  }

  /**
    * Select a region with high avg street priority, where the user hasn't completed all missions; assign it to them.
    */
  def assignRegion(userId: UUID): Option[NamedRegion] = db.withSession { implicit session =>
    // If user is inexperienced, restrict them to only easy regions when selecting a high priority region.
    val newRegion: Option[NamedRegion] =
      if(isUserExperienced(userId)) RegionTable.selectAHighPriorityRegion(userId)
      else RegionTable.selectAHighPriorityEasyRegion(userId)
    newRegion.map(r => saveOrUpdate(userId, r.regionId)) // If region successfully selected, assign it to them.
    newRegion
  }

  /**
    * Returns the region id that is currently assigned to the given user.
    */
  def currentRegion(userId: UUID): Option[Int] = db.withSession { implicit session =>
    // Get rid of deleted regions.
    val ucr = for {
      (ucr, r) <- userCurrentRegions.innerJoin(neighborhoods).on(_.regionId === _.regionId)
    } yield ucr

    ucr.filter(_.userId === userId.toString).list.map(_.regionId).headOption
  }

  /**
    * Check if a user has been assigned to some region.
    */
  def isAssigned(userId: UUID): Boolean = db.withSession { implicit session =>
    val _userCurrentRegions = for {
      (_regions, _userCurrentRegions) <- neighborhoods.innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
      if _userCurrentRegions.userId === userId.toString
    } yield _userCurrentRegions

    _userCurrentRegions.list.nonEmpty
  }

  /**
    * Update the current region.
    *
    * Reference:
    * http://slick.typesafe.com/doc/2.1.0/queries.html#updating
    *
    * @param userId user ID
    * @param regionId region id
    * @return the number of rows updated
    */
  def update(userId: UUID, regionId: Int): Int = db.withSession { implicit session =>
    val q = for { ucr <- userCurrentRegions if ucr.userId === userId.toString } yield ucr.regionId
    q.update(regionId)
  }

  /**
    * Update the current region, or save a new entry if the user does not have one.
    *
    * Reference:
    * http://slick.typesafe.com/doc/2.1.0/queries.html#updating
    *
    * @param userId user ID
    * @param regionId region id
    * @return region id
    */
  def saveOrUpdate(userId: UUID, regionId: Int): Int = db.withSession { implicit session =>
    val rowsUpdated: Int = update(userId, regionId)
    // If no rows are updated, a new record needs to be created
    if (rowsUpdated == 0) {
      save(userId, regionId)
    }
    regionId
  }

    /**
    * Delete the current region for a user if it exists.
    *
    * @param userId user ID
    * @return
    */
  def delete(userId: UUID): Int = db.withSession { implicit session =>
    userCurrentRegions.filter(_.userId === userId.toString).delete
  }
}
