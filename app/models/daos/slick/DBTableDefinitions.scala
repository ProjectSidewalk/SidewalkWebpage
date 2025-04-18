package models.daos.slick

import models.utils.MyPostgresDriver.simple._
import java.sql.Timestamp
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


  val slickUsers = TableQuery[UserTable]
  val slickLoginInfos = TableQuery[LoginInfos]
  val slickUserLoginInfos = TableQuery[UserLoginInfoTable]
  val slickPasswordInfos = TableQuery[PasswordInfoTable]
  val slickAuthTokens = TableQuery[AuthTokenTable]

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
}
