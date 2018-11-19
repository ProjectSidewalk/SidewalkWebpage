package models.daos.slickdaos

import models.user.{UserRoleTable, User}
import models.daos.slickdaos.DBTableDefinitions._
import com.mohiva.play.silhouette.api.LoginInfo
import scala.concurrent.Future
import java.util.UUID
import play.Logger
import models.daos.UserDAO

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile

import models.utils.MyPostgresDriver.api._
import scala.concurrent.ExecutionContext.Implicits.global

class UserDAOSlick extends UserDAO {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db

  /**
   * Finds a user by its login info.
   *
   * @param loginInfo The login info of the user to find.
   * @return The found user or None if no user for the given login info could be found.
   */
  def find(loginInfo: LoginInfo): Future[Option[User]] = {
    db.run(
      slickLoginInfos.filter(
        x => x.providerID === loginInfo.providerID && x.providerKey === loginInfo.providerKey
      ).result.headOption
    ).flatMap {
      case Some(info) => db.run(
        slickUserLoginInfos.filter(_.loginInfoId === info.id).result.headOption
      )
      case None => Future.successful(None)
    }.flatMap {
      case Some(userLoginInfo) => db.run(
        slickUsers.filter(_.userId === userLoginInfo.userID).result.headOption
      )
      case None => Future.successful(None)
    }.flatMap {
      case Some(user) =>
        UserRoleTable.getRole(UUID.fromString(user.userId))
          .map { role =>
            Some(User(UUID.fromString(user.userId), loginInfo, user.username, user.email, Some(role)))
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
    var user: DBUser = null
    db.run(
      slickUsers.filter(_.userId === userID.toString).result.headOption
    ).flatMap {
      case Some(u) =>
        user = u
          db.run(
          slickUserLoginInfos.filter(_.userID === u.userId).result.headOption
        )
      case None => Future.successful(None)
    }.flatMap {
      case Some(info) => db.run(
        slickLoginInfos.filter(_.loginInfoId === info.loginInfoId).result.headOption
      )
      case None => Future.successful(None)
    }.flatMap {
      case Some(loginInfo) =>
        UserRoleTable.getRole(UUID.fromString(user.userId))
          .map { role =>
            Some(User(UUID.fromString(user.userId), LoginInfo(loginInfo.providerID, loginInfo.providerKey), user.username, user.email, Some(role)))
          }
      case None => Future.successful(None)
    }
  }

  def find(username: String): Future[Option[User]] = {
    var user: DBUser = null
    db.run(
      slickUsers.filter(_.username === username).result.headOption
    ).flatMap {
      case Some(u) =>
        user = u
        db.run(
          slickUserLoginInfos.filter(_.userID === u.userId).result.headOption
        )
      case None => Future.successful(None)
    }.flatMap {
      case Some(info) => db.run(
        slickLoginInfos.filter(_.loginInfoId === info.loginInfoId).result.headOption
      )
      case None => Future.successful(None)
    }.flatMap {
      case Some(loginInfo) =>
        UserRoleTable.getRole(UUID.fromString(user.userId))
          .map { role =>
            Some(User(UUID.fromString(user.userId), LoginInfo(loginInfo.providerID, loginInfo.providerKey), user.username, user.email, Some(role)))
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
  def save(user: User): Future[User] = {
    val dbUser = DBUser(user.userId.toString, user.username, user.email)
    db.run(slickUsers.filter(_.userId === dbUser.userId).result.headOption)
        .flatMap {
          case Some(_) => db.run(slickUsers.filter(_.userId === dbUser.userId).update(dbUser).transactionally)
          case None => db.run(slickUsers.+=(dbUser).transactionally)
        }.flatMap { _ =>
          val dbLoginInfo = DBLoginInfo(None, user.loginInfo.providerID, user.loginInfo.providerKey)
          // Insert if it does not exist yet
          db.run(
            slickLoginInfos.filter(info => info.providerID === dbLoginInfo.providerID && info.providerKey === dbLoginInfo.providerKey).result.headOption
          ).flatMap {
            case None => db.run(slickLoginInfos.+=(dbLoginInfo).transactionally)
            case Some(info) =>
              Logger.debug("Nothing to insert since info already exists: " + info)
              Future.successful(1)
          }.map(_ => dbLoginInfo)
        }.flatMap { dbLoginInfo =>
          // re-fetch `dbLoginInfo`
          db.run(
            slickLoginInfos.filter(info => info.providerID === dbLoginInfo.providerID && info.providerKey === dbLoginInfo.providerKey).result.head
          )
        }.flatMap { dbLoginInfo =>
          // Now make sure they are connected
          db.run(
            slickUserLoginInfos.filter(info => info.userID === dbUser.userId && info.loginInfoId === dbLoginInfo.id).result.headOption
          ).flatMap {
            case Some(_) => Future.successful(0)
            // They are connected already, we could as well omit this case ;)
            case None => db.run(
              (slickUserLoginInfos += DBUserLoginInfo(dbUser.userId, dbLoginInfo.id.get)).transactionally
            )
          }
        }.map(_ => user)
  }
}
