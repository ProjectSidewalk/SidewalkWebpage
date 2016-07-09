package models.user

import models.audit.AuditTaskTable
import models.mission.MissionTable
import models.region.{NamedRegion, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.util.UUID

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

  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)

  def save(userId: UUID, regionId: Int): Int = db.withTransaction { implicit session =>
    val userCurrentRegion = UserCurrentRegion(0, userId.toString, regionId)
    val userCurrentRegionId: Int =
      (userCurrentRegions returning userCurrentRegions.map(_.userCurrentRegionId)) += userCurrentRegion
    userCurrentRegionId
  }

  /**
    * Assign a region to the given user. This is used for the initial assignment.
    *
    * @param userId user id
    * @return region id
    */
  def assignRandomly(userId: UUID): Int = db.withSession { implicit session =>
    // Check if there are any records
    val _currentRegions = for {
      (_regions, _currentRegions) <- neighborhoods.innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
      if _currentRegions.userId === userId.toString
    } yield _currentRegions
    val currentRegionList = _currentRegions.list

    if (currentRegionList.isEmpty) {
      // val regionId: Int = scala.util.Random.shuffle(neighborhoods.list).map(_.regionId).head // Todo. I can do better than randomly shuffling this...

      val region: Option[NamedRegion] = RegionTable.selectANamedRegionRoundRobin

      val regionId: Int = if (region.isDefined) {
        region.get.regionId
      } else {
        scala.util.Random.shuffle(neighborhoods.list).map(_.regionId).head
      }
      save(userId, regionId)
      regionId
    } else {
      assignNextRegion(userId)
    }
  }

  /**
    * Select a region where the user hasn't completed all the missions and assign that region to them.
    * @param userId
    * @return
    */
  def assignNextRegion(userId: UUID): Int = db.withSession { implicit session =>
    val regionIds = MissionTable.selectIncompleteRegions(userId)
    val regionId = scala.util.Random.shuffle(regionIds).head
    update(userId, regionId)
  }

  /**
    * Returns the region id that is currently assigned to the given user
    *
    * @param userId user id
    * @return
    */
  def currentRegion(userId: UUID): Option[Int] = db.withSession { implicit session =>
    try {
      // Get rid of deleted regions
      val ucr = for {
        (ucr, r) <- userCurrentRegions.innerJoin(neighborhoods).on(_.regionId === _.regionId)
      } yield ucr

      Some(ucr.filter(_.userId === userId.toString).list.map(_.regionId).head)
    } catch {
      case e: NoSuchElementException => None
      case _: Throwable => None  // This shouldn't happen.
    }
  }

  /**
    * Check if a user has been assigned to some region.
    *
    * @param userId user id
    * @return
    */
  def isAssigned(userId: UUID): Boolean = db.withSession { implicit session =>
    val _userCurrentRegions = for {
      (_regions, _userCurrentRegions) <- neighborhoods.innerJoin(userCurrentRegions).on(_.regionId === _.regionId)
      if _userCurrentRegions.userId === userId.toString
    } yield _userCurrentRegions

    _userCurrentRegions.list.nonEmpty
  }

  /**
    * Update the current region
    *
    * Reference:
    * http://slick.typesafe.com/doc/2.1.0/queries.html#updating
    *
    * @param userId user ID
    * @param regionId region id
    */
  def update(userId: UUID, regionId: Int): Int = db.withSession { implicit session =>
    val q = for { ucr <- userCurrentRegions if ucr.userId === userId.toString } yield ucr.regionId
    q.update(regionId)
    regionId
  }
}