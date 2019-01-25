package models.user

import models.region.{ NamedRegion, RegionTable }
import models.street.StreetEdgeTable
import models.utils.MyPostgresDriver.api._
import java.util.UUID

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

case class UserCurrentRegion(userCurrentRegionId: Int, userId: String, regionId: Int)

class UserCurrentRegionTable(tag: Tag) extends Table[UserCurrentRegion](tag, Some("sidewalk"), "user_current_region") {
  def userCurrentRegionId = column[Int]("user_current_region_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id")
  def regionId = column[Int]("region_id")

  def * = (userCurrentRegionId, userId, regionId) <> ((UserCurrentRegion.apply _).tupled, UserCurrentRegion.unapply)
}

object UserCurrentRegionTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val userCurrentRegions = TableQuery[UserCurrentRegionTable]
  val regions = TableQuery[RegionTable]

  val regionsWithoutDeleted = regions.filter(_.deleted === false)
  val neighborhoods = regions.filter(_.deleted === false).filter(_.regionTypeId === 2)

  val experiencedUserMileageThreshold = 2.0

  def save(userId: UUID, regionId: Int): Future[Int] = {
    val userCurrentRegion = UserCurrentRegion(0, userId.toString, regionId)
    db.run(
      (userCurrentRegions returning userCurrentRegions.map(_.userCurrentRegionId)) += userCurrentRegion)
  }

  /**
   * Checks if the given user is "experienced" (have audited at least 2 miles).
   *
   * @param userId
   * @return
   */
  def isUserExperienced(userId: UUID): Future[Boolean] =
    StreetEdgeTable.getDistanceAudited(userId).map(_ > experiencedUserMileageThreshold)

  /**
   * Select an easy region w/ high avg street priority where the user hasn't completed all missions; assign it to them.
   * @param userId
   * @return
   */
  def assignEasyRegion(userId: UUID): Future[Option[NamedRegion]] = {
    RegionTable.selectAHighPriorityEasyRegion(userId).flatMap {
      case Some(region) =>
        saveOrUpdate(userId, region.regionId) // If region successfully selected, assign it to them.
          .map(_ => Some(region))
      case None => Future.successful(None)
    }
  }

  /**
   * Select a region with high avg street priority, where the user hasn't completed all missions; assign it to them.
   *
   * @param userId
   * @return
   */
  def assignRegion(userId: UUID): Future[Option[NamedRegion]] = {
    // If user is inexperienced, restrict them to only easy regions when selecting a high priority region.
    val regionFuture = isUserExperienced(userId).flatMap {
      case true => RegionTable.selectAHighPriorityRegion(userId)
      case false => RegionTable.selectAHighPriorityEasyRegion(userId)
    }

    regionFuture.flatMap {
      case Some(region) =>
        saveOrUpdate(userId, region.regionId) // If region successfully selected, assign it to them.
          .map(_ => Some(region))
      case None => Future.successful(None)
    }
  }

  /**
   * Returns the region id that is currently assigned to the given user
   *
   * @param userId user id
   * @return
   */
  def currentRegion(userId: UUID): Future[Option[Int]] = {
    // Get rid of deleted regions
    val ucr = for {
      (ucr, r) <- userCurrentRegions.join(neighborhoods).on(_.regionId === _.regionId)
    } yield ucr

    db.run(
      ucr.filter(_.userId === userId.toString).map(_.regionId).result.headOption)
  }

  /**
   * Check if a user has been assigned to some region.
   *
   * @param userId user id
   * @return
   */
  def isAssigned(userId: UUID): Future[Boolean] = {
    val _userCurrentRegions = for {
      (_, _userCurrentRegions) <- neighborhoods.join(userCurrentRegions).on(_.regionId === _.regionId)
      if _userCurrentRegions.userId === userId.toString
    } yield _userCurrentRegions

    db.run(_userCurrentRegions.length.result)
      .map(_ > 0)
  }

  /**
   * Update the current region
   *
   * Reference:
   * http://slick.typesafe.com/doc/2.1.0/queries.html#updating
   *
   * @param userId user ID
   * @param regionId region id
   * @return the number of rows updated
   */
  def update(userId: UUID, regionId: Int): Future[Int] = db.run({
    val q = for { ucr <- userCurrentRegions if ucr.userId === userId.toString } yield ucr.regionId
    q.update(regionId).transactionally
  })

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
  def saveOrUpdate(userId: UUID, regionId: Int): Future[Int] = {
    update(userId, regionId).flatMap {
      case 0 => save(userId, regionId) // If no rows are updated, a new record needs to be created
      case n => Future.successful(n)
    }.map(_ => regionId)
  }
}
