package models.attribute

/**
 * Created by misaugstad on 4/27/17.
 */

import models.region.{ Region, RegionTable }
import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import slick.lifted.ProvenShape
import scala.language.postfixOps

case class GlobalClusteringSession(globalClusteringSessionId: Int, regionId: Int, timeCreated: java.sql.Timestamp)

class GlobalClusteringSessionTable(tag: Tag) extends Table[GlobalClusteringSession](tag, Some("sidewalk"), "global_clustering_session") {
  def globalClusteringSessionId: Rep[Int] = column[Int]("global_clustering_session_id", O.PrimaryKey, O.AutoInc)
  def regionId: Rep[Int] = column[Int]("region_id")
  def timeCreated: Rep[java.sql.Timestamp] = column[java.sql.Timestamp]("time_created")

  def * : ProvenShape[GlobalClusteringSession] = (globalClusteringSessionId, regionId, timeCreated) <>
    ((GlobalClusteringSession.apply _).tupled, GlobalClusteringSession.unapply)

  def region = foreignKey("global_clustering_session_region_id_fkey", regionId, TableQuery[RegionTable])(_.regionId)
}

/**
 * Data access object for the GlobalClusteringSessionTable table
 */
object GlobalClusteringSessionTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val globalClusteringSessions: TableQuery[GlobalClusteringSessionTable] = TableQuery[GlobalClusteringSessionTable]

  def getAllGlobalClusteringSessions: Future[Seq[GlobalClusteringSession]] = {
    db.run(globalClusteringSessions.result)
  }

  /**
   * Truncates global_clustering_session, global_attribute, and global_attribute_user_attribute.
   */
  def truncateTables(): Future[Int] = db.run {
    sqlu"""TRUNCATE TABLE global_clustering_session CASCADE"""
  }

  def save(newAttribute: GlobalClusteringSession): Future[Int] = db.run {
    (globalClusteringSessions returning globalClusteringSessions.map(_.globalClusteringSessionId)) += newAttribute
  }
}
