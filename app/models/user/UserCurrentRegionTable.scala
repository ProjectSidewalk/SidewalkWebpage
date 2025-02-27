package models.user

import com.google.inject.ImplementedBy
import models.region.{Region, RegionTable, RegionTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

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
class UserCurrentRegionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider
                                      )(implicit ec: ExecutionContext) extends UserCurrentRegionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val userCurrentRegions = TableQuery[UserCurrentRegionTableDef]
  val regions = TableQuery[RegionTableDef]
  val regionsWithoutDeleted = regions.filter(_.deleted === false)

  // TODO should prob just be rolled up with insertOrUpdate.
  def insert(userId: String, regionId: Int): DBIO[Int] = {
    (userCurrentRegions returning userCurrentRegions.map(_.userCurrentRegionId)) += UserCurrentRegion(0, userId, regionId)
  }

  /**
   * Select a region with high avg street priority, where the user hasn't explored every street; assign it to them.
   * TODO totally skipping implementation during lib upgrades for now.
   */
  def assignRegion(userId: String): DBIO[Option[Region]] = {
//    val newRegion: Option[Region] = RegionTable.selectAHighPriorityRegion(userId)
//    newRegion.map(r => insertOrUpdate(userId, r.regionId)) // If region successfully selected, assign it to them.
//    newRegion
    for {
      newRegion <- regions.filter(_.regionId === 26).result.headOption
      // If region successfully selected, assign it to them.
      regionId <- newRegion match {
        case Some(region) => insertOrUpdate(userId, region.regionId)
        case None => DBIO.successful(0)
      }
    } yield newRegion
  }

  /**
   * Returns the region id that is currently assigned to the given user.
   * TODO during all of this process, we're not actually checking if the region has been deleted. Maybe we include that
   *      in this code, or I add it to my region deleting script.
   */
  def getCurrentRegionId(userId: String): DBIO[Option[Int]] = {
    userCurrentRegions.filter(_.userId === userId).map(_.regionId).result.headOption
  }

  /**
   * Get the neighborhood that is currently assigned to the user.
   */
  def getCurrentRegion(userId: String): DBIO[Option[Region]] = {
    (for {
      _region <- regionsWithoutDeleted
      _userCurrRegion <- userCurrentRegions if _region.regionId === _userCurrRegion.regionId
      if _userCurrRegion.userId === userId
    } yield _region).result.headOption
  }

  /**
    * Update the current region.
    */
  def update(userId: String, regionId: Int): DBIO[Int] = {
    userCurrentRegions.filter(_.userId === userId).map(_.regionId).update(regionId)
  }

  /**
   * Update the current region, or save a new entry if the user does not have one.
   * @return regionId
   */
  def insertOrUpdate(userId: String, regionId: Int): DBIOAction[Int, NoStream, Effect.All] = {
    update(userId, regionId).map { rowsUpdated: Int =>
      if (rowsUpdated == 0) insert(userId, regionId)
      else DBIO.successful(regionId).asInstanceOf[DBIOAction[Int, NoStream, Effect.All]]
    }.flatten
  }

    /**
    * Delete the current region for a user if it exists.
    *
    * @param userId user ID
    * @return
    */
  def delete(userId: String): DBIO[Int] = {
    userCurrentRegions.filter(_.userId === userId).delete
  }
}
