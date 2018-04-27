package models.attribute

/**
  * Created by misaugstad on 4/27/17.
  */

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.db.slick

import scala.slick.lifted.{ForeignKeyQuery, ProvenShape}
import scala.slick.jdbc.{StaticQuery => Q}
import scala.language.postfixOps

case class UserClusteringSession(userClusteringSessionId: Int,
                                 isAnonymous: Boolean, userId: Option[String], ipAddress: Option[String],
                                 timeCreated: java.sql.Timestamp)


class UserClusteringSessionTable(tag: Tag) extends Table[UserClusteringSession](tag, Some("sidewalk"), "user_clustering_session") {
  def userClusteringSessionId: Column[Int] = column[Int]("user_clustering_session_id", O.NotNull, O.PrimaryKey, O.AutoInc)
  def isAnonymous: Column[Boolean] = column[Boolean]("is_anonymous", O.NotNull)
  def userId: Column[Option[String]] = column[Option[String]]("user_id")
  def ipAddress: Column[Option[String]] = column[Option[String]]("ip_address")
  def timeCreated: Column[java.sql.Timestamp] = column[java.sql.Timestamp]("time_created", O.NotNull)

  def * : ProvenShape[UserClusteringSession] = (userClusteringSessionId, isAnonymous, userId, ipAddress, timeCreated) <>
    ((UserClusteringSession.apply _).tupled, UserClusteringSession.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("user_clustering_session_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

/**
  * Data access object for the UserClusteringSessionTable table
  */
object UserClusteringSessionTable {
  val db: slick.Database = play.api.db.slick.DB
  val userClusteringSessions: TableQuery[UserClusteringSessionTable] = TableQuery[UserClusteringSessionTable]

  def getAllSessions: List[UserClusteringSession] = db.withTransaction { implicit session =>
    userClusteringSessions.list
  }

  def truncateTable(): Unit = db.withTransaction { implicit session =>
    Q.updateNA("TRUNCATE TABLE user_clustering_session").execute
  }

  def save(newSess: UserClusteringSession): Int = db.withTransaction { implicit session =>
    val newId: Int = (userClusteringSessions returning userClusteringSessions.map(_.userClusteringSessionId)) += newSess
    newId
  }
}
