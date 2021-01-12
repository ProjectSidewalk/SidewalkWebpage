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
