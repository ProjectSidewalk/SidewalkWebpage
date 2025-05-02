package models.attribute

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

case class GlobalClusteringSession(globalClusteringSessionId: Int, regionId: Int, timeCreated: OffsetDateTime)

class GlobalClusteringSessionTableDef(tag: Tag) extends Table[GlobalClusteringSession](tag, "global_clustering_session") {
  def globalClusteringSessionId: Rep[Int] = column[Int]("global_clustering_session_id", O.PrimaryKey, O.AutoInc)
  def regionId: Rep[Int] = column[Int]("region_id")
  def timeCreated: Rep[OffsetDateTime] = column[OffsetDateTime]("time_created")

  def * = (globalClusteringSessionId, regionId, timeCreated) <>
    ((GlobalClusteringSession.apply _).tupled, GlobalClusteringSession.unapply)

//  def region: ForeignKeyQuery[RegionTable, Region] =
//    foreignKey("global_clustering_session_region_id_fkey", regionId, TableQuery[RegionTableDef])(_.regionId)
}

@ImplementedBy(classOf[GlobalClusteringSessionTable])
trait GlobalClusteringSessionTableRepository { }

@Singleton
class GlobalClusteringSessionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends GlobalClusteringSessionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val globalClusteringSessions = TableQuery[GlobalClusteringSessionTableDef]
  val globalAttributes = TableQuery[GlobalAttributeTableDef]
  val globalAttributeUserAttributes = TableQuery[GlobalAttributeUserAttributeTableDef]
  val userAttributes = TableQuery[UserAttributeTableDef]

  /**
   * Gets list of region_ids where the underlying data has been changed during single-user clustering.
   *
   * Data in the `global_attribute` table that is missing from the `global_attribute_user_attribute` table, or data in
   * the `user_attribute` table that is missing from the `global_attribute_user_attribute` table means that the
   * underlying data changed during single-user clustering. Return all `region_id`s where that's the case.
   */
  def getNeighborhoodsToReCluster: DBIO[Seq[Int]] = {
    // global_attribute left joins with global_attribute_user_attribute, nulls mean underlying changes.
    val lowQualityOrUpdated = globalAttributes
      .joinLeft(globalAttributeUserAttributes).on(_.globalAttributeId === _.globalAttributeId)
      .filter(_._2.isEmpty)
      .map(_._1.regionId)

    // global_attribute_user_attribute right joins with user_attribute, nulls mean underlying changes.
    val newOrUpdated = globalAttributeUserAttributes
      .joinRight(userAttributes).on(_.userAttributeId === _.userAttributeId)
      .filter(_._1.isEmpty)
      .map(_._2.regionId)

    // Combine the two (union removes duplicates).
    (lowQualityOrUpdated union newOrUpdated).result
  }

  /**
   * Deletes the global attributes for the selected region_ids.
   *
   * We run the delete on the `global_clustering_session` table, and it cascades to the `global_attribute` and
   * `global_attribute_user_attribute` tables.
   */
  def deleteGlobalClusteringSessions(regionIds: Seq[Int]): DBIO[Int] = {
    globalClusteringSessions.filter(_.regionId inSet regionIds).delete
  }

  def insert(newSess: GlobalClusteringSession): DBIO[Int] = {
    (globalClusteringSessions returning globalClusteringSessions.map(_.globalClusteringSessionId)) += newSess
  }
}
