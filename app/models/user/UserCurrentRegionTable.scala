package models.user

import models.audit.AuditTaskTable
import models.mission.MissionTable
import models.region.{NamedRegion, RegionCompletion, RegionCompletionTable, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.util.UUID

import models.street.{StreetEdgePriorityTable, StreetEdgeRegionTable, StreetEdgeTable}

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

  // these regions are buggy, and we steer new users away from them
  val difficultRegionIds = List(251, 281, 317, 366)
  val experiencedUserMileageThreshold = 2.0

  def save(userId: UUID, regionId: Int): Int = db.withTransaction { implicit session =>
    val userCurrentRegion = UserCurrentRegion(0, userId.toString, regionId)
    val userCurrentRegionId: Int =
      (userCurrentRegions returning userCurrentRegions.map(_.userCurrentRegionId)) += userCurrentRegion
    userCurrentRegionId
  }

  /**
    * Checks if the given user is "experienced" (have audited at least 2 miles).
    *
    * @param userId
    * @return
    */
  def isUserExperienced(userId: UUID): Boolean = db.withSession { implicit session =>
    StreetEdgeTable.getDistanceAudited(userId) > experiencedUserMileageThreshold
  }

  /**
    * Select an easy region (if any left) where the user hasn't completed all missions and assign that region to them.
    * @param userId
    * @return
    */
  def assignEasyRegion(userId: UUID): Int = db.withSession { implicit session =>
    val regionIds: Set[Int] = MissionTable.selectIncompleteRegions(userId)

    // Assign one of the unaudited regions that are easy.
    // TODO: Assign one of the least-audited regions that are easy.
    val completions: List[RegionCompletion] =
      RegionCompletionTable.regionCompletions
        .filter(_.regionId inSet regionIds)
        .filterNot(_.regionId inSet difficultRegionIds)
        .filter(region => region.auditedDistance / region.totalDistance < 0.9999)
        .sortBy(region => region.auditedDistance / region.totalDistance).take(10).list

    val regionId: Int = completions match {
      case Nil =>
        // Indicates amongst the unaudited regions of the user, there are no unaudited regions across all users
        // In this case, pick any easy region amongst regions that are not audited by the user
        scala.util.Random.shuffle(regionIds).filterNot(difficultRegionIds.contains(_)).head
      case _ =>
        // Pick an easy region that is unaudited.
        // TODO: Pick an easy region that is least audited.
        scala.util.Random.shuffle(completions).head.regionId

    }
    if (!isAssigned(userId)) {
      save(userId, regionId)
      regionId
    } else {
      update(userId, regionId)
    }
  }

  /**
    * Select a region where the user hasn't completed all the missions and assign that region to them.
    * @param userId
    * @return
    */
  def assignNextRegion(userId: UUID): Int = db.withSession { implicit session =>
    val regionIds: Set[Int] = MissionTable.selectIncompleteRegions(userId)

    val highestPriorityRegions: List[(Int, Option[Double])] = StreetEdgeRegionTable.streetEdgeRegionTable
      .filter(_.regionId inSet regionIds)
      .innerJoin(StreetEdgePriorityTable.streetEdgePriorities).on(_.streetEdgeId === _.streetEdgeId)
      .map { case (_edgeRegion, _edgePriority) => (_edgeRegion.regionId, _edgePriority.priority) }
      .groupBy(_._1).map { case (_regionId, group) => (_regionId, group.map(_._2).avg) }
      .sortBy(_._2.desc).take(5).list

    println(highestPriorityRegions)
    val chosenRegionId: Option[Int] = scala.util.Random.shuffle(highestPriorityRegions).headOption.map(_._1)
    chosenRegionId match {
      case Some(regionId) => update(userId, regionId)
      case _ =>
        scala.util.Random.shuffle(regionIds).headOption match {
          case Some(anyIncompleteRegionId) => update(userId, anyIncompleteRegionId)
          case _ =>
            val anyRegion: Int = scala.util.Random.shuffle(RegionTable.regionsWithoutDeleted.map(_.regionId).list).head
            update(userId, anyRegion)
        }
    }
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