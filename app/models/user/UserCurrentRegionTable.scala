package models.user

import com.google.inject.ImplementedBy
import models.region.{Region, RegionTableDef}
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
trait UserCurrentRegionTableRepository { }

@Singleton
class UserCurrentRegionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider
                                      )(implicit ec: ExecutionContext) extends UserCurrentRegionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val userCurrentRegions = TableQuery[UserCurrentRegionTableDef]
  val regions = TableQuery[RegionTableDef]
  val regionsWithoutDeleted = regions.filter(_.deleted === false)

  /**
   * Returns the region id that is currently assigned to the given user.
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
  def insertOrUpdate(userId: String, regionId: Int): DBIO[Int] = {
    update(userId, regionId).map { rowsUpdated: Int =>
      if (rowsUpdated == 0) (userCurrentRegions returning userCurrentRegions.map(_.userCurrentRegionId)) += UserCurrentRegion(0, userId, regionId)
      else DBIO.successful(regionId)
    }.flatten
  }

    /**
   * Delete the current region for a user if it exists.
   * @param userId user ID
   */
  def delete(userId: String): DBIO[Int] = {
    userCurrentRegions.filter(_.userId === userId).delete
  }
}
