package service.user

import com.google.inject.ImplementedBy
import com.mohiva.play.silhouette.api.LoginInfo
import com.mohiva.play.silhouette.api.services.IdentityService
import com.mohiva.play.silhouette.api.util.{PasswordHasher, PasswordInfo}
import com.mohiva.play.silhouette.impl.exceptions.{IdentityNotFoundException, InvalidPasswordException}
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider.{ID, InvalidPassword, UnknownCredentials}
import models.user.{DBLoginInfo, LoginInfoTable, SidewalkUser, SidewalkUserTable, SidewalkUserWithRole, UserLoginInfo, UserLoginInfoTable, UserPasswordInfo, UserPasswordInfoTable, UserRoleTable}
import models.utils.MyPostgresDriver
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.util.UUID
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

/**
 * Handles actions to users.
 */
@ImplementedBy(classOf[UserServiceImpl])
trait UserService extends IdentityService[SidewalkUserWithRole] {
  // This function is needed to extend IdentityService.
  def retrieve(loginInfo: LoginInfo): Future[Option[SidewalkUserWithRole]]

  def insert(user: SidewalkUserWithRole, providerId: String, pwInfo: PasswordInfo): Future[SidewalkUserWithRole]
  def findByUserId(userId: String): Future[Option[SidewalkUserWithRole]]
  def findByUsername(username: String): Future[Option[SidewalkUserWithRole]]
  def findByEmail(email: String): Future[Option[SidewalkUserWithRole]]
  def generateUniqueAnonUser(): Future[SidewalkUserWithRole]
  def authenticate(email: String, pw: String): Future[LoginInfo]
}

@Singleton
class UserServiceImpl @Inject() (
                                  protected val dbConfigProvider: DatabaseConfigProvider,
                                  implicit val ec: ExecutionContext,
                                  passwordHasher: PasswordHasher,
                                  sidewalkUserTable: SidewalkUserTable,
                                  loginInfoTable: LoginInfoTable,
                                  userLoginInfoTable: UserLoginInfoTable,
                                  userPasswordInfoTable: UserPasswordInfoTable,
                                  userRoleTable: UserRoleTable
                                ) extends UserService with HasDatabaseConfigProvider[MyPostgresDriver] {

  import driver.api._

  /**
   * Retrieves a user that matches the specified login info.
   *
   * @param loginInfo The login info to retrieve a user.
   * @return The retrieved user or None if no user could be retrieved for the given login info.
   */
  def retrieve(loginInfo: LoginInfo): Future[Option[SidewalkUserWithRole]] = {
    sidewalkUserTable.findByEmail(loginInfo.providerKey)
//    sidewalkUserTable.findByEmail(loginInfo.providerKey).flatMap {
//      case Some(user) => Future.successful(Some(User(UUID.fromString(user.userId), loginInfo, user.username, user.email, None)))
//      case None => Future.successful(None)
//    }
  }

  def findByUserId(userId: String): Future[Option[SidewalkUserWithRole]] = sidewalkUserTable.findByUserId(userId)

  def findByUsername(username: String): Future[Option[SidewalkUserWithRole]] = sidewalkUserTable.findByUsername(username)

  def findByEmail(email: String): Future[Option[SidewalkUserWithRole]] = sidewalkUserTable.findByEmail(email)

  /**
   * Generates unique anonymous user credentials. Does not save in the database.
   *
   * @return The generated user.
   */
  def generateUniqueAnonUser(): Future[SidewalkUserWithRole] = {
    // Helper function to check if user exists.
    def isUserAvailable(username: String, email: String): Future[Boolean] = {
      for {
        usernameExists <- findByUsername(username)
        emailExists <- findByEmail(email)
      } yield usernameExists.isEmpty && emailExists.isEmpty
    }

    // Main recursive function.
    def tryGenerateUser(): Future[SidewalkUserWithRole] = {
      val username = Random.alphanumeric.filter(!_.isUpper).take(16).mkString
      val email = s"anonymous@$username.com"

      isUserAvailable(username, email).flatMap {
        case true => Future.successful(SidewalkUserWithRole(UUID.randomUUID().toString, username, email, "Anonymous", false))
        case false => tryGenerateUser()
      }
    }

    tryGenerateUser()
  }

  /**
   * Saves a user.
   *
   * @param user The user to save.
   * @return The saved user.
   */
  def insert(user: SidewalkUserWithRole, providerId: String, pwInfo: PasswordInfo) = {
    val dbActions = for {
      _ <- sidewalkUserTable.insert(SidewalkUser(user.userId, user.username, user.email))
      loginInfoId: Long <- loginInfoTable.insert(DBLoginInfo(0, providerId, user.email.toLowerCase))
      _ <- userLoginInfoTable.insert(UserLoginInfo(0, user.userId, loginInfoId))
      _ <- userPasswordInfoTable.insert(UserPasswordInfo(0, pwInfo.hasher, pwInfo.password, pwInfo.salt, loginInfoId))
      _ <- userRoleTable.setRole(user.userId, user.role, Some(user.communityService))
    } yield {
      user
    }

    db.run(dbActions.transactionally)
  }

  def authenticate(email: String, pw: String): Future[LoginInfo] = {
    loginInfoTable.find(email).flatMap {
      case Some(loginInfoId) =>
        userPasswordInfoTable.find(loginInfoId).flatMap {
          case Some(pwInfo) =>
            if (passwordHasher.matches(PasswordInfo(pwInfo.hasher, pwInfo.password, pwInfo.salt), pw)) {
              Future.successful(LoginInfo(ID, email))
            } else {
              throw new InvalidPasswordException(InvalidPassword.format(ID))
            }
          case None => throw new IdentityNotFoundException(UnknownCredentials.format(ID))
        }
      case None => throw new IdentityNotFoundException(UnknownCredentials.format(ID))
    }
  }
}