package models.daos.slickdaos

import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import models.user.{UserRoleTable, User}
import models.utils.MyPostgresDriver.api._
import models.daos.slickdaos.DBTableDefinitions._
// import com.mohiva.play.silhouette.core.LoginInfo
import com.mohiva.play.silhouette.api.LoginInfo
import scala.concurrent.Future
import java.util.UUID
import play.Logger
import models.daos.UserDAO

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

class UserDAOSlick extends UserDAO {
  import play.api.Play.current

  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db

  /**
   * Finds a user by its login info.
   *
   * @param loginInfo The login info of the user to find.
   * @return The found user or None if no user for the given login info could be found.
   */
  def find(loginInfo: LoginInfo): Future[Option[User]] = {
    db.run(slickLoginInfos.filter(
      x => x.providerID === loginInfo.providerID && x.providerKey === loginInfo.providerKey
    ).result.headOption).flatMap {
      case Some(info) =>
        db.run(slickUserLoginInfos.filter(_.loginInfoId === info.id).result.headOption).flatMap {
          case Some(userLoginInfo) =>
            db.run(slickUsers.filter(_.userId === userLoginInfo.userID).result.headOption).flatMap {
              case Some(user) =>
                UserRoleTable.getRole(UUID.fromString(user.userId)).map { role =>
                  Some(User(UUID.fromString(user.userId), loginInfo, user.username, user.email, Some(role)))
                }
              case None => Future.successful(None)
            }
          case None => Future.successful(None)
        }
      case None => Future.successful(None)
    }
  }

  /**
   * Finds a user by its user ID.
   *
   * @param userID The ID of the user to find.
   * @return The found user or None if no user for the given ID could be found.
   */
  def find(userID: UUID): Future[Option[User]] = {
    db.run(slickUsers.filter(_.userId === userID.toString).result.headOption).flatMap {
      case Some(user) =>
        db.run(slickUserLoginInfos.filter(_.userID === user.userId).result.headOption).flatMap {
          case Some(info) =>
            db.run(slickLoginInfos.filter(_.loginInfoId === info.loginInfoId).result.headOption).flatMap {
              case Some(loginInfo) =>
                UserRoleTable.getRole(UUID.fromString(user.userId)).map { role =>
                  Some(User(UUID.fromString(user.userId), LoginInfo(loginInfo.providerID, loginInfo.providerKey), user.username, user.email, Some(role)))
                }
              case None => Future.successful(None)
            }
          case None => Future.successful(None)
        }
      case None => Future.successful(None)
    }
  }

  def find(username: String): Future[Option[User]] = {
    db.run(slickUsers.filter(_.username === username).result.headOption).flatMap {
      case Some(user) =>
        db.run(slickUserLoginInfos.filter(_.userID === user.userId).result.headOption) flatMap {
          case Some(info) =>
            db.run(slickLoginInfos.filter(_.loginInfoId === info.loginInfoId).result.headOption) flatMap {
              case Some(loginInfo) =>
                UserRoleTable.getRole(UUID.fromString(user.userId)).map { role =>
                  Some(User(UUID.fromString(user.userId), LoginInfo(loginInfo.providerID, loginInfo.providerKey), user.username, user.email, Some(role)))
                }
              case None => Future.successful(None)
            }
          case None => Future.successful(None)
        }
      case None => Future.successful(None)
    }
  }

  /**
   * Saves a user.
   *
   * @param user The user to save.
   * @return The saved user.
   */
  def save(user: User) = {
    val dbUser = DBUser(user.userId.toString, user.username, user.email)
    def userFuture = db.run(slickUsers.filter(_.userId === dbUser.userId).result.headOption) flatMap {
      case Some(userFound) => db.run(slickUsers.filter(_.userId === dbUser.userId).update(dbUser))
      case None => db.run(slickUsers += dbUser)
    }

    // Insert if it does not exist yet
    var dbLoginInfo = DBLoginInfo(None, user.loginInfo.providerID, user.loginInfo.providerKey)
    def loginInfoFuture = db.run(slickLoginInfos.filter(
      info => info.providerID === dbLoginInfo.providerID && info.providerKey === dbLoginInfo.providerKey
    ).result.headOption) flatMap {
      case Some(info) =>
        Logger.debug("Nothing to insert since info already exists: " + info)
        Future.successful(0)
      case None =>
        db.run(slickLoginInfos += dbLoginInfo)
    }

    def connectionFuture = db.run(slickLoginInfos.filter(
      info => info.providerID === dbLoginInfo.providerID && info.providerKey === dbLoginInfo.providerKey).result.head).flatMap { dbLoginInfo =>
      db.run(slickUserLoginInfos.filter(info => info.userID === dbUser.userId && info.loginInfoId === dbLoginInfo.id).result.headOption).flatMap {
        case Some(info) => Future.successful(0)
        case None => db.run(slickUserLoginInfos += DBUserLoginInfo(dbUser.userId, dbLoginInfo.id.get))
      }
    }

    // Execute the futures sequentially, and wrap unchanged User in the future to finish off.
    for {
      _user <- userFuture
      _loginInfo <- loginInfoFuture
      _connection <- connectionFuture
    } yield user // We do not change the user => return it
  }
}
