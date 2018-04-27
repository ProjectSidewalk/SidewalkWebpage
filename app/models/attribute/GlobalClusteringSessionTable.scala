package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick

import scala.slick.lifted.ProvenShape
import scala.slick.jdbc.{StaticQuery => Q}
import scala.language.postfixOps

case class GlobalClusteringSession(globalClusteringSessionId: Int, timeCreated: java.sql.Timestamp)


class GlobalClusteringSessionTable(tag: Tag) extends Table[GlobalClusteringSession](tag, Some("sidewalk"), "global_clustering_session") {
  def globalClusteringSessionId: Column[Int] = column[Int]("global_clustering_session_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def timeCreated: Column[java.sql.Timestamp] = column[java.sql.Timestamp]("time_created", O.NotNull)

  def * : ProvenShape[GlobalClusteringSession] = (globalClusteringSessionId, timeCreated) <>
    ((GlobalClusteringSession.apply _).tupled, GlobalClusteringSession.unapply)
}

/**
  * Data access object for the GlobalClusteringSessionTable table
  */
object GlobalClusteringSessionTable {
  val db: slick.Database = play.api.db.slick.DB
  val globalClusteringSessions: TableQuery[GlobalClusteringSessionTable] = TableQuery[GlobalClusteringSessionTable]

  def getAllSessions: List[GlobalClusteringSession] = db.withTransaction { implicit session =>
    globalClusteringSessions.list
  }

  def truncateTable(): Unit = db.withTransaction { implicit session =>
    Q.updateNA("TRUNCATE TABLE global_clustering_session").execute
  }

  def save(newSess: GlobalClusteringSession): Int = db.withTransaction { implicit session =>
    val newId: Int = (globalClusteringSessions returning globalClusteringSessions.map(_.globalClusteringSessionId)) += newSess
    newId
  }
}
