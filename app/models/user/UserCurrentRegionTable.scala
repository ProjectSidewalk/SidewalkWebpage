package models.user

import com.google.inject.ImplementedBy
import models.region.{Region, RegionTable, RegionTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.util.UUID
import javax.inject.{Inject, Singleton}

case class UserCurrentRegion(userCurrentRegionId: Int, userId: String, regionId: Int)

class UserCurrentRegionTableDef(tag: Tag) extends Table[UserCurrentRegion](tag, "user_current_region") {
  def userCurrentRegionId: Rep[Int] = column[Int]("user_current_region_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def regionId: Rep[Int] = column[Int]("region_id")


  def * = (userCurrentRegionId, userId, regionId) <> ((UserCurrentRegion.apply _).tupled, UserCurrentRegion.unapply)
}

@ImplementedBy(classOf[UserCurrentRegionTable])
trait UserCurrentRegionTableRepository {
}

@Singleton
class UserCurrentRegionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserCurrentRegionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val userCurrentRegions = TableQuery[UserCurrentRegionTableDef]
  val regions = TableQuery[RegionTableDef]

//  val regionsWithoutDeleted = RegionTable.regionsWithoutDeleted

  // TODO should prob just be rolled up with insertOrUpdate.
  def insert(userId: UUID, regionId: Int): DBIO[Int] = {
    (userCurrentRegions returning userCurrentRegions.map(_.userCurrentRegionId)) += UserCurrentRegion(0, userId.toString, regionId)
  }
//
//  /**
//    * Select a region with high avg street priority, where the user hasn't explored every street; assign it to them.
//    */
//  def assignRegion(userId: UUID): Option[Region] = {
//    val newRegion: Option[Region] = RegionTable.selectAHighPriorityRegion(userId)
//    newRegion.map(r => saveOrUpdate(userId, r.regionId)) // If region successfully selected, assign it to them.
//    newRegion
//  }
//
//  /**
//    * Returns the region id that is currently assigned to the given user.
//    */
//  def currentRegion(userId: UUID): Option[Int] = {
//    userCurrentRegions.filter(_.userId === userId.toString).map(_.regionId).firstOption
//  }
//
//  /**
//    * Check if a user is assigned to some region.
//    */
//  def isAssigned(userId: UUID): Boolean = {
//    userCurrentRegions.filter(_.userId === userId.toString).size.run > 0
//  }
//
//  /**
//    * Update the current region.
//    *
//    * Reference:
//    * http://slick.typesafe.com/doc/2.1.0/queries.html#updating
//    *
//    * @param userId user ID
//    * @param regionId region id
//    * @return the number of rows updated
//    */
//  def update(userId: UUID, regionId: Int): Int = {
//    val q = for { ucr <- userCurrentRegions if ucr.userId === userId.toString } yield ucr.regionId
//    q.update(regionId)
//  }
//
//  /**
//    * Update the current region, or save a new entry if the user does not have one.
//    *
//    * Reference:
//    * http://slick.typesafe.com/doc/2.1.0/queries.html#updating
//    *
//    * @param userId user ID
//    * @param regionId region id
//    * @return region id
//    */
//  def saveOrUpdate(userId: UUID, regionId: Int): Int = {
//    val rowsUpdated: Int = update(userId, regionId)
//    // If no rows are updated, a new record needs to be created
//    if (rowsUpdated == 0) {
//      insert(userId, regionId)
//    }
//    regionId
//  }
//
//    /**
//    * Delete the current region for a user if it exists.
//    *
//    * @param userId user ID
//    * @return
//    */
//  def delete(userId: UUID): Int = {
//    userCurrentRegions.filter(_.userId === userId.toString).delete
//  }
}
