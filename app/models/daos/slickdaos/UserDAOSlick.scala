package models.daos.slickdaos

import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import models.user.{UserRoleTable, User}
import play.api.db.slick._
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

class UserDAOSlick extends UserDAO {
  import play.api.Play.current

  /**
   * Finds a user by its login info.
   *
   * @param loginInfo The login info of the user to find.
   * @return The found user or None if no user for the given login info could be found.
   */
  def find(loginInfo: LoginInfo) = {
    DB withSession { implicit session =>
      Future.successful {
        slickLoginInfos.filter(
          x => x.providerID === loginInfo.providerID && x.providerKey === loginInfo.providerKey
        ).headOption match {
          case Some(info) =>
            slickUserLoginInfos.filter(_.loginInfoId === info.id).headOption match {
              case Some(userLoginInfo) =>
                slickUsers.filter(_.userId === userLoginInfo.userID).headOption match {
                  case Some(user) =>
                    val role = UserRoleTable.getRole(UUID.fromString(user.userId))
                    Some(User(UUID.fromString(user.userId), loginInfo, user.username, user.email, Some(role)))
                  case None => None
                }
              case None => None
            }
          case None => None
        }
      }
    }
  }

  /**
   * Finds a user by its user ID.
   *
   * @param userID The ID of the user to find.
   * @return The found user or None if no user for the given ID could be found.
   */
  def find(userID: UUID) = {
    DB withSession { implicit session =>
      Future.successful {
        slickUsers.filter(
          _.userId === userID.toString
        ).headOption match {
          case Some(user) =>
            slickUserLoginInfos.filter(_.userID === user.userId).headOption match {
              case Some(info) =>
                slickLoginInfos.filter(_.loginInfoId === info.loginInfoId).headOption match {
                  case Some(loginInfo) =>
                    val role = UserRoleTable.getRole(UUID.fromString(user.userId))
                    Some(User(UUID.fromString(user.userId), LoginInfo(loginInfo.providerID, loginInfo.providerKey), user.username, user.email, Some(role)))
                  case None => None
                }
              case None => None
            }
          case None => None
        }
      }
    }
  }

  def find(username: String) = {
    DB withSession { implicit session =>
      Future.successful {
        slickUsers.filter(_.username === username).headOption match {
          case Some(user) =>
            slickUserLoginInfos.filter(_.userID === user.userId).headOption match {
              case Some(info) =>
                slickLoginInfos.filter(_.loginInfoId === info.loginInfoId).headOption match {
                  case Some(loginInfo) =>
                    val role = UserRoleTable.getRole(UUID.fromString(user.userId))
                    Some(User(UUID.fromString(user.userId), LoginInfo(loginInfo.providerID, loginInfo.providerKey), user.username, user.email, Some(role)))
                  case None => None
                }
              case None => None
            }
          case None => None
        }
      }
    }
  }

  /**
   * Saves a user.
   *
   * @param user The user to save.
   * @return The saved user.
   */
  def save(user: User) = {
    DB withSession { implicit session =>
      Future.successful {
        val dbUser = DBUser(user.userId.toString, user.username, user.email)
        slickUsers.filter(_.userId === dbUser.userId).headOption match {
          case Some(userFound) => slickUsers.filter(_.userId === dbUser.userId).update(dbUser)
          case None => slickUsers.insert(dbUser)
        }
        var dbLoginInfo = DBLoginInfo(None, user.loginInfo.providerID, user.loginInfo.providerKey)
        // Insert if it does not exist yet
        slickLoginInfos.filter(info => info.providerID === dbLoginInfo.providerID && info.providerKey === dbLoginInfo.providerKey).headOption match {
          case None => slickLoginInfos.insert(dbLoginInfo)
          case Some(info) => Logger.debug("Nothing to insert since info already exists: " + info)
        }
        dbLoginInfo = slickLoginInfos.filter(info => info.providerID === dbLoginInfo.providerID && info.providerKey === dbLoginInfo.providerKey).head
        // Now make sure they are connected
        slickUserLoginInfos.filter(info => info.userID === dbUser.userId && info.loginInfoId === dbLoginInfo.id).headOption match {
          case Some(info) =>
          // They are connected already, we could as well omit this case ;)
          case None =>
            slickUserLoginInfos += DBUserLoginInfo(dbUser.userId, dbLoginInfo.id.get)
        }
        user // We do not change the user => return it
      }
    }
  }
}
