package models.attribute

import com.google.inject.ImplementedBy
import models.region.{Region, RegionTable}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.db.slick

import java.sql.Timestamp
import javax.inject.{Inject, Singleton}
import scala.language.postfixOps

case class GlobalClusteringSession(globalClusteringSessionId: Int, regionId: Int, timeCreated: Timestamp)

class GlobalClusteringSessionTableDef(tag: Tag) extends Table[GlobalClusteringSession](tag, "global_clustering_session") {
  def globalClusteringSessionId: Rep[Int] = column[Int]("global_clustering_session_id", O.PrimaryKey, O.AutoInc)
  def regionId: Rep[Int] = column[Int]("region_id")
  def timeCreated: Rep[Timestamp] = column[Timestamp]("time_created")

  def * = (globalClusteringSessionId, regionId, timeCreated) <>
    ((GlobalClusteringSession.apply _).tupled, GlobalClusteringSession.unapply)

//  def region: ForeignKeyQuery[RegionTable, Region] =
//    foreignKey("global_clustering_session_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
}

@ImplementedBy(classOf[GlobalClusteringSessionTable])
trait GlobalClusteringSessionTableRepository {
  def insert(newSess: GlobalClusteringSession): DBIO[Int]
}

@Singleton
class GlobalClusteringSessionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends GlobalClusteringSessionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val globalClusteringSessions: TableQuery[GlobalClusteringSessionTableDef] = TableQuery[GlobalClusteringSessionTableDef]
  val globalAttributeUserAttributes: TableQuery[GlobalAttributeUserAttributeTableDef] = TableQuery[GlobalAttributeUserAttributeTableDef]

  /**
   * Gets list of region_ids where the underlying data has been changed during single-user clustering.
   *
   * Data in the `global_attribute` table that is missing from the `global_attribute_user_attribute` table, or data in
   * the `user_attribute` table that is missing from the `global_attribute_user_attribute` table, means that the
   * underlying data changed during single-user clustering. Return all `region_id`s where that's the case.
   */
//  def getNeighborhoodsToReCluster: List[Int] = {
//    // global_attribute left joins with global_attribute_user_attribute, nulls mean underlying changes.
//    val lowQualityOrUpdated = GlobalAttributeTable.globalAttributes
//      .joinLeft(globalAttributeUserAttributes).on(_.globalAttributeId === _.globalAttributeId)
//      .filter(_._2.globalAttributeId.?.isEmpty)
//      .map(_._1.regionId)
//
//    // global_attribute_user_attribute right joins with user_attribute, nulls mean underlying changes.
//    val newOrUpdated = globalAttributeUserAttributes
//      .rightJoin(UserAttributeTable.userAttributes).on(_.userAttributeId === _.userAttributeId)
//      .filter(_._1.userAttributeId.?.isEmpty)
//      .map(_._2.regionId)
//
//    // Combine the two (union removes duplicates)
//    (lowQualityOrUpdated union newOrUpdated).list
//  }
//
//  /**
//    * Truncates global_clustering_session, global_attribute, and global_attribute_user_attribute.
//    */
//  def truncateTables(): Unit = {
//    Q.updateNA("TRUNCATE TABLE global_clustering_session CASCADE").execute
//  }
//
//  /**
//   * Deletes the global attributes for the selected region_ids.
//   *
//   * We run the delete on the `global_clustering_session` table, and it cascades to the `global_attribute` and
//   * `global_attribute_user_attribute` tables.
//   */
//  def deleteGlobalClusteringSessions(regionIds: List[Int]): Int = {
//    globalClusteringSessions.filter(_.regionId inSet regionIds).delete
//  }

  def insert(newSess: GlobalClusteringSession): DBIO[Int] = {
      (globalClusteringSessions returning globalClusteringSessions.map(_.globalClusteringSessionId)) += newSess
  }
}
