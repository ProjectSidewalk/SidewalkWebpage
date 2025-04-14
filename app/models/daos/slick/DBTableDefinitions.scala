package models.daos.slick

import models.utils.MyPostgresDriver.simple._
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

object DBTableDefinitions {

  case class DBUser (userId: String, username: String, email: String )

  class UserTable(tag: Tag) extends Table[DBUser](tag, "sidewalk_user") {
    def userId = column[String]("user_id", O.PrimaryKey)
    def username = column[String]("username")
    def email = column[String]("email")
    def * = (userId, username, email) <> (DBUser.tupled, DBUser.unapply)
  }

  case class DBLoginInfo (id: Option[Long], providerID: String, providerKey: String )

  class LoginInfos(tag: Tag) extends Table[DBLoginInfo](tag, "login_info") {
    def loginInfoId = column[Long]("login_info_id", O.PrimaryKey, O.AutoInc)
    def providerID = column[String]("provider_id")
    def providerKey = column[String]("provider_key")
    def * = (loginInfoId.?, providerID, providerKey) <> (DBLoginInfo.tupled, DBLoginInfo.unapply)
  }

  case class DBUserLoginInfo (userID: String, loginInfoId: Long)

  class UserLoginInfoTable(tag: Tag) extends Table[DBUserLoginInfo](tag, "user_login_info") {
    def userID = column[String]("user_id", O.NotNull)
    def loginInfoId = column[Long]("login_info_id", O.NotNull)
    def * = (userID, loginInfoId) <> (DBUserLoginInfo.tupled, DBUserLoginInfo.unapply)
  }

  case class DBPasswordInfo (hasher: String, password: String, salt: Option[String], loginInfoId: Long)

  class PasswordInfoTable(tag: Tag) extends Table[DBPasswordInfo](tag, "user_password_info") {
    def hasher = column[String]("hasher")
    def password = column[String]("password")
    def salt = column[Option[String]]("salt")
    def loginInfoId = column[Long]("login_info_id")
    def * = (hasher, password, salt, loginInfoId) <> (DBPasswordInfo.tupled, DBPasswordInfo.unapply)
  }

  case class DBAuthToken (id: Array[Byte], userID: String, expirationTimestamp: Timestamp)

  class AuthTokenTable(tag: Tag) extends Table[DBAuthToken](tag, "auth_tokens") {
    def id = column[Array[Byte]]("id")
    def userID = column[String]("user_id", O.PrimaryKey)
    def expirationTimestamp = column[Timestamp]("expiration_timestamp")
    def * = (id, userID, expirationTimestamp) <> (DBAuthToken.tupled, DBAuthToken.unapply)
  }

  // New case class for global user statistics
  case class GlobalUserStats(
    userId: String,
    tutorialCompleted: Boolean,
    firstLoginDate: Option[Timestamp],
    createdAt: Timestamp,
    updatedAt: Timestamp
  )

  // New table definition for global_user_stats
  class GlobalUserStatsTable(tag: Tag) extends Table[GlobalUserStats](tag, "global_user_stats") {
    def userId = column[String]("user_id", O.PrimaryKey)
    def tutorialCompleted = column[Boolean]("tutorial_completed", O.NotNull)
    def firstLoginDate = column[Option[Timestamp]]("first_login_date")
    def createdAt = column[Timestamp]("created_at", O.NotNull)
    def updatedAt = column[Timestamp]("updated_at", O.NotNull)
    
    def * = (userId, tutorialCompleted, firstLoginDate, createdAt, updatedAt) <> (GlobalUserStats.tupled, GlobalUserStats.unapply)
    
    def user = foreignKey("global_user_stats_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
  }

  val slickUsers = TableQuery[UserTable]
  val slickLoginInfos = TableQuery[LoginInfos]
  val slickUserLoginInfos = TableQuery[UserLoginInfoTable]
  val slickPasswordInfos = TableQuery[PasswordInfoTable]
  val slickAuthTokens = TableQuery[AuthTokenTable]
  val slickGlobalUserStats = TableQuery[GlobalUserStatsTable]

  object UserTable {
    import play.api.Play.current

    val db = play.api.db.slick.DB

    def find(username: String): Option[DBUser] = db.withSession { implicit session =>
      slickUsers.filter(_.username === username).firstOption
    }
    def findEmail(email: String): Option[DBUser] = db.withSession { implicit session =>
      slickUsers.filter(_.email === email).firstOption
    }
    def findById(userId: UUID): Option[DBUser] = db.withSession { implicit session =>
      slickUsers.filter(_.userId === userId.toString).firstOption
    }

    def count: Int = db.withSession { implicit session =>
      slickUsers.size.run
    }
  }

  // New object for GlobalUserStats operations
  object GlobalUserStatsTable {
    import play.api.Play.current

    val db = play.api.db.slick.DB
    
    /**
     * Check if a user has completed the tutorial globally
     */
    def hasCompletedTutorial(userId: String): Boolean = db.withSession { implicit session =>
      slickGlobalUserStats.filter(_.userId === userId).map(_.tutorialCompleted).firstOption.getOrElse(false)
    }
    
    /**
     * Mark that a user has completed the tutorial
     */
    def markTutorialCompleted(userId: String): Int = db.withSession { implicit session =>
      val now = new Timestamp(Instant.now.toEpochMilli)
      
      // Check if the user already has a record
      val existingRecord = slickGlobalUserStats.filter(_.userId === userId).firstOption
      
      if (existingRecord.isDefined) {
        // Update existing record
        slickGlobalUserStats
          .filter(_.userId === userId)
          .map(g => (g.tutorialCompleted, g.updatedAt))
          .update((true, now))
      } else {
        // Insert new record
        slickGlobalUserStats += GlobalUserStats(userId, true, None, now, now)
        1 // Return 1 for one row inserted
      }
    }
    
    /**
     * Create or update the global stats for a user
     */
    def createOrUpdate(userId: String): Unit = db.withSession { implicit session =>
      val now = new Timestamp(Instant.now.toEpochMilli)
      
      // Check if user already has stats
      val exists = slickGlobalUserStats.filter(_.userId === userId).exists.run
      
      if (!exists) {
        // Insert new record with default values
        slickGlobalUserStats += GlobalUserStats(userId, false, Some(now), now, now)
      }
    }
  }
}