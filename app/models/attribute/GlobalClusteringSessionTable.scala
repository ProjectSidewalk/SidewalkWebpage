package models.attribute

import models.region.{Region, RegionTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick
import scala.slick.lifted.{ForeignKeyQuery, ProvenShape}
import scala.slick.jdbc.{StaticQuery => Q}
import scala.language.postfixOps

case class GlobalClusteringSession(globalClusteringSessionId: Int, regionId: Int, timeCreated: java.sql.Timestamp)

class GlobalClusteringSessionTable(tag: Tag) extends Table[GlobalClusteringSession](tag, Some("sidewalk"), "global_clustering_session") {
  def globalClusteringSessionId: Column[Int] = column[Int]("global_clustering_session_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def regionId: Column[Int] = column[Int]("region_id", O.NotNull)
  def timeCreated: Column[java.sql.Timestamp] = column[java.sql.Timestamp]("time_created", O.NotNull)

  def * : ProvenShape[GlobalClusteringSession] = (globalClusteringSessionId, regionId, timeCreated) <>
    ((GlobalClusteringSession.apply _).tupled, GlobalClusteringSession.unapply)

  def region: ForeignKeyQuery[RegionTable, Region] =
    foreignKey("global_clustering_session_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

/**
  * Data access object for the GlobalClusteringSessionTable table.
  */
object GlobalClusteringSessionTable {
  val db: slick.Database = play.api.db.slick.DB
  val globalClusteringSessions: TableQuery[GlobalClusteringSessionTable] = TableQuery[GlobalClusteringSessionTable]
  val globalAttributeUserAttributes: TableQuery[GlobalAttributeUserAttributeTable] = TableQuery[GlobalAttributeUserAttributeTable]

  /**
   * Gets list of region_ids where the underlying data has been changed during single-user clustering.
   *
   * Data in the `global_attribute` table that is missing from the `global_attribute_user_attribute` table means that
   * the user who contributed the data has added data or has been marked as low quality. Data in the `user_attribute`
   * table that is missing from the `global_attribute_user_attribute` table means that this is a new user or they've
   * added new data. SELECT DISTINCT on the associated region_ids from both queries yields all regions to update.
   */
  def getNeighborhoodsToReCluster: List[Int] = db.withSession { implicit session =>
    // global_attribute left joins with global_attribute_user_attribute, nulls mean low quality/updated users.
    val lowQualityOrUpdated = GlobalAttributeTable.globalAttributes
      .leftJoin(globalAttributeUserAttributes).on(_.globalAttributeId === _.globalAttributeId)
      .filter(_._2.globalAttributeId.?.isEmpty)
      .map(_._1.regionId)

    // global_attribute_user_attribute right joins with user_attribute, nulls mean new/updated users.
    val newOrUpdated = globalAttributeUserAttributes
      .rightJoin(UserAttributeTable.userAttributes).on(_.userAttributeId === _.userAttributeId)
      .filter(_._1.userAttributeId.?.isEmpty)
      .map(_._2.regionId)

    // Combine the two (union removes duplicates)
    (lowQualityOrUpdated union newOrUpdated).list
  }

  /**
    * Truncates global_clustering_session, global_attribute, and global_attribute_user_attribute.
    */
  def truncateTables(): Unit = db.withTransaction { implicit session =>
    Q.updateNA("TRUNCATE TABLE global_clustering_session CASCADE").execute
  }

  def save(newSess: GlobalClusteringSession): Int = db.withTransaction { implicit session =>
    val newId: Int = (globalClusteringSessions returning globalClusteringSessions.map(_.globalClusteringSessionId)) += newSess
    newId
  }
}
