package service

import com.google.inject.ImplementedBy
import models.user._
import models.utils.MyPostgresProfile
import play.api.cache.AsyncCacheApi
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.silhouette.api.LoginInfo
import play.silhouette.api.services.IdentityService
import play.silhouette.api.util.{PasswordHasher, PasswordInfo}
import play.silhouette.impl.exceptions.{IdentityNotFoundException, InvalidPasswordException}
import play.silhouette.impl.providers.CredentialsProvider.ID
import java.security.MessageDigest
import java.time.OffsetDateTime
import java.util.UUID
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

/**
 * Handles user authentication actions.
 */
@ImplementedBy(classOf[AuthenticationServiceImpl])
trait AuthenticationService extends IdentityService[SidewalkUserWithRole] {
  // This function is needed to extend IdentityService.
  def retrieve(loginInfo: LoginInfo): Future[Option[SidewalkUserWithRole]]

  def createUser(
      user: SidewalkUserWithRole,
      providerId: String,
      pwInfo: PasswordInfo,
      oldUserId: Option[String]
  ): Future[SidewalkUserWithRole]
  def findByUserId(userId: String): Future[Option[SidewalkUserWithRole]]
  def findByUsername(username: String): Future[Option[SidewalkUserWithRole]]
  def findByEmail(email: String): Future[Option[SidewalkUserWithRole]]
  def getDefaultAnonUser: Future[SidewalkUserWithRole]
  def generateUniqueAnonUser(): Future[SidewalkUserWithRole]
  def addUserStatEntryIfNew(userId: String): Future[Int]
  def updatePassword(userId: String, pwInfo: PasswordInfo): Future[Int]
  def authenticate(email: String, pw: String): Future[LoginInfo]
  def createToken(userID: String, expiryMinutes: Int = 60): Future[String]
  def validateToken(id: String): Future[Option[AuthToken]]
  def removeToken(id: String): Future[Int]
  def cleanAuthTokens: Future[Int]
  def setCommunityServiceStatus(userId: String, newCommServiceStatus: Boolean): Future[Int]
  def setInfra3dAccess(userId: String, newAccess: Boolean): Future[Int]
  def updateRole(userId: String, newRole: Role.Value): Future[Int]
}

@Singleton
class AuthenticationServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext,
    passwordHasher: PasswordHasher,
    cacheApi: AsyncCacheApi,
    sidewalkUserTable: SidewalkUserTable,
    loginInfoTable: LoginInfoTable,
    userLoginInfoTable: UserLoginInfoTable,
    userPasswordInfoTable: UserPasswordInfoTable,
    userRoleTable: UserRoleTable,
    userStatTable: UserStatTable,
    authTokenTable: AuthTokenTable,
    configService: ConfigService
) extends AuthenticationService
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  def sha256Hasher: MessageDigest = MessageDigest.getInstance("SHA-256")

  /**
   * Retrieves a user that matches the specified login info.
   * @param loginInfo The login info to retrieve a user.
   * @return The retrieved user or None if no user could be retrieved for the given login info.
   */
  def retrieve(loginInfo: LoginInfo): Future[Option[SidewalkUserWithRole]] =
    sidewalkUserTable.findByEmail(loginInfo.providerKey)

  /**
   * Retrieves the default anonymous user. Only used for logging in rare cases at this point.
   */
  def getDefaultAnonUser: Future[SidewalkUserWithRole] = {
    cacheApi.getOrElseUpdate[SidewalkUserWithRole]("getDefaultAnonUser") {
      findByUsername("anonymous").flatMap {
        case Some(user) => Future.successful(user)
        case None       => throw new IdentityNotFoundException("No default anonymous user found.")
      }
    }
  }

  def findByUserId(userId: String): Future[Option[SidewalkUserWithRole]] = sidewalkUserTable.findByUserId(userId)

  def findByUsername(username: String): Future[Option[SidewalkUserWithRole]] =
    sidewalkUserTable.findByUsername(username)

  def findByEmail(email: String): Future[Option[SidewalkUserWithRole]] = sidewalkUserTable.findByEmail(email)

  /**
   * Generates unique anonymous user credentials. Does not save in the database.
   * @return The generated user.
   */
  def generateUniqueAnonUser(): Future[SidewalkUserWithRole] = {
    // Helper function to check if user exists.
    def isUserAvailable(username: String, email: String): Future[Boolean] = {
      for {
        usernameExists <- findByUsername(username)
        emailExists    <- findByEmail(email)
      } yield usernameExists.isEmpty && emailExists.isEmpty
    }

    // Main recursive function.
    def tryGenerateUser(): Future[SidewalkUserWithRole] = {
      val username = Random.alphanumeric.filter(!_.isUpper).take(16).mkString
      val email    = s"anonymous@$username.com"

      isUserAvailable(username, email).flatMap {
        case true =>
          Future.successful(
            SidewalkUserWithRole(UUID.randomUUID().toString, username, email, Role.Anonymous, false, false)
          )
        case false => tryGenerateUser()
      }
    }

    tryGenerateUser()
  }

  /**
   * Creates a new user or transfers an existing user based on the provided information.
   * @param user The user to create or transfer
   * @param providerId The provider ID for the user; always "credentials" as of Jul 2025 bc we have no auth w/ socials
   * @param pwInfo The password information for the user, including hasher, password, and salt
   * @param oldUserId User ID of existing user to transfer; if provided, the user will be updated instead of inserted
   * @return The inserted or updated user
   */
  def createUser(
      user: SidewalkUserWithRole,
      providerId: String,
      pwInfo: PasswordInfo,
      oldUserId: Option[String] = None
  ): Future[SidewalkUserWithRole] = {
    oldUserId match {
      case Some(id) if id == user.userId => transferUser(user, pwInfo)
      case _                             => insertNewUser(user, providerId, pwInfo)
    }
  }

  /**
   * Inserts a new user into the database, along with all required info such as authentication, role, and stats.
   * @param user The user to save
   * @param providerId The provider ID for the user; always "credentials" as of Jul 2025 bc we have no auth w/ socials
   * @param pwInfo The password information for the user, including hasher, password, and salt
   * @return The saved user
   */
  private def insertNewUser(
      user: SidewalkUserWithRole,
      providerId: String,
      pwInfo: PasswordInfo
  ): Future[SidewalkUserWithRole] = {
    val dbActions = for {
      _                 <- sidewalkUserTable.insert(SidewalkUser(user.userId, user.username, user.email))
      loginInfoId: Long <- loginInfoTable.insert(DBLoginInfo(0, providerId, user.email.toLowerCase))
      _                 <- userLoginInfoTable.insert(UserLoginInfo(0, user.userId, loginInfoId))
      _ <- userPasswordInfoTable.insert(UserPasswordInfo(0, pwInfo.hasher, pwInfo.password, pwInfo.salt, loginInfoId))
      _ <- userRoleTable.addRole(user.userId, user.role, user.communityService)
      _ <- insertUserStatForNewUser(user.userId)
    } yield user
    db.run(dbActions.transactionally)
  }

  /**
   * Seeds the `user_stat` row for a user being created, failing if they somehow already have one.
   *
   * Unlike [[addUserStatEntryIfNew]], a conflict here is not a benign race: a userId being created for the first time
   * cannot already own a row, so one existing means the id isn't new (e.g. a `createUser` that should have taken the
   * `transferUser` branch). Swallowing it would commit an account wearing a stranger's stats and privacy flags, so
   * this fails instead and rolls the sign-up transaction back.
   *
   * @param userId The user being created.
   * @return DBIO action returning 1, or a failed action if a row already existed.
   */
  private def insertUserStatForNewUser(userId: String): DBIO[Int] = {
    val (onLeaderboard, publicProfile) = configService.defaultPrivacyFlags
    userStatTable.insertIfNew(userId, onLeaderboard, publicProfile).flatMap { rowsInserted =>
      if (rowsInserted == 0) DBIO.failed(new RuntimeException(s"user_stat row already exists for new user $userId"))
      else DBIO.successful(rowsInserted)
    }
  }

  /**
   * Transfers an existing user to a new set of credentials, updating their username, email, password, and role.
   * @param user What the user should look like after the transfer; userId is used to update all other fields
   * @param pwInfo The password information for the user, including hasher, password, and salt
   * @return The user post-transfer
   */
  private def transferUser(user: SidewalkUserWithRole, pwInfo: PasswordInfo): Future[SidewalkUserWithRole] = {
    val dbActions = for {
      _ <- sidewalkUserTable.updateUsername(user.userId, user.username)
      _ <- updateEmailDBIO(user.userId, user.email)
      _ <- updatePasswordDBIO(user.userId, pwInfo)
      _ <- userRoleTable.updateRole(user.userId, user.role, user.communityService)
    } yield user
    db.run(dbActions.transactionally)
  }

  /**
   * Updates the username of a user.
   * @param userId The user ID of the user whose username is to be updated
   * @param newUsername The new username to set for the user
   * @return A Future containing the number of rows updated
   */
  def updateUsername(userId: String, newUsername: String): Future[Int] = {
    db.run(sidewalkUserTable.updateUsername(userId, newUsername))
  }

  /**
   * Updates the email of a user; requires editing entries in both the sidewalk_user and login_info tables.
   * @param userId The user ID of the user whose email is to be updated
   * @param newEmail The new email address to set for the user
   * @return A Future containing the number of rows updated in both tables
   */
  def updateEmail(userId: String, newEmail: String): Future[Int] = {
    db.run(updateEmailDBIO(userId, newEmail))
  }

  /**
   * Updates the email of a user; requires editing entries in both the sidewalk_user and login_info tables.
   * @param userId The user ID of the user whose email is to be updated
   * @param newEmail The new email address to set for the user
   * @return A Future containing the number of rows updated in both tables
   */
  private def updateEmailDBIO(userId: String, newEmail: String): DBIO[Int] = {
    (for {
      sidewalkUserRowsUpdated <- sidewalkUserTable.updateEmail(userId, newEmail)
      userLoginInfoOption     <- userLoginInfoTable.find(userId)
      loginInfoRowsUpdated    <- userLoginInfoOption match {
        case Some(userLoginInfo) => loginInfoTable.updateProviderKey(userLoginInfo.loginInfoId, newEmail.toLowerCase)
        case None                => DBIO.successful(0) // No login info found for this user
      }
      // Ensure both updates were successful. Returning DBIO.failed to force rollback if either update fails.
      result <-
        if (sidewalkUserRowsUpdated == 0 || loginInfoRowsUpdated == 0) {
          DBIO.failed(new RuntimeException("Transaction failed: one or more updates affected 0 rows"))
        } else {
          DBIO.successful(Math.min(sidewalkUserRowsUpdated, loginInfoRowsUpdated))
        }
    } yield result).transactionally
  }

  /**
   * Adds a user stat entry if it does not already exist. Necessary on first visit to each new city.
   *
   * `CustomSecurityService` calls this for every request from an identified user, so a cache miss issues a single
   * conflict-tolerant INSERT rather than a read followed by a conditional insert: the parallel requests of a first
   * page load would all read "no row" and each insert one, which is how the duplicates #4604 cleaned up were made.
   *
   * The tradeoff is that a cache miss is now a write rather than a read — it needs a writable connection (so this
   * request can't be served by a read replica) and it burns a `user_stat_id` sequence value even when it inserts
   * nothing, since `nextval` is evaluated before the conflict is detected. Both are bounded by the 1-day cache, so
   * the rate is roughly one per active user per day per instance rather than one per request.
   *
   * @param userId The user ID for which to add the stat entry.
   * @return The number of rows added (0 if the entry already exists).
   */
  def addUserStatEntryIfNew(userId: String): Future[Int] = {
    val cacheKey = s"userStatExists:$userId"
    cacheApi.get[Boolean](cacheKey).flatMap {
      case Some(true) => Future.successful(0) // User stat already exists.
      case _          =>
        val (onLeaderboard, publicProfile) = configService.defaultPrivacyFlags
        db.run(userStatTable.insertIfNew(userId, onLeaderboard, publicProfile)).map { rowsAdded =>
          cacheApi.set(cacheKey, true, 1.day)
          rowsAdded
        }
    }
  }

  def updatePassword(userId: String, pwInfo: PasswordInfo): Future[Int] = {
    db.run(updatePasswordDBIO(userId, pwInfo))
  }

  private def updatePasswordDBIO(userId: String, pwInfo: PasswordInfo): DBIO[Int] = {
    userLoginInfoTable.find(userId).flatMap {
      case Some(userLoginInfo) =>
        userPasswordInfoTable.update(userLoginInfo.loginInfoId, pwInfo)
      case None => DBIO.failed(new IdentityNotFoundException(s"No login info found for user ID: $userId"))
    }
  }

  def authenticate(email: String, pw: String): Future[LoginInfo] = {
    loginInfoTable.findByEmail(email).flatMap {
      case Some(loginInfoId) =>
        userPasswordInfoTable.find(loginInfoId).flatMap {
          case Some(pwInfo) =>
            if (passwordHasher.matches(PasswordInfo(pwInfo.hasher, pwInfo.password, pwInfo.salt), pw)) {
              Future.successful(LoginInfo(ID, email))
            } else {
              throw new InvalidPasswordException(s"Invalid password for user with email: $email")
            }
          case None => throw new IdentityNotFoundException(s"No account found for user with email: $email")
        }
      case None => throw new IdentityNotFoundException(s"No account found for user with email: $email")
    }
  }

  /**
   * Creates a new auth token and saves it in the backing store.
   * @param userID The user ID for which the token should be created.
   * @param expiryMinutes The number of minutes until a token expires.
   * @return The saved auth token.
   */
  def createToken(userID: String, expiryMinutes: Int = 60): Future[String] = {
    val tokenId: String = UUID.randomUUID().toString
    val hashedTokenID   = sha256Hasher.digest(tokenId.getBytes)
    val token           = AuthToken(hashedTokenID, userID, OffsetDateTime.now.plusMinutes(expiryMinutes.toLong))
    db.run(authTokenTable.insert(token)).map(_ => tokenId)
  }

  /**
   * Validates a token ID.
   * @param id The token ID to validate.
   * @return The token if it's valid, None otherwise.
   */
  def validateToken(id: String): Future[Option[AuthToken]] = {
    val hashedTokenID: Array[Byte] = sha256Hasher.digest(id.getBytes)
    db.run(authTokenTable.find(hashedTokenID))
      .map(_.flatMap { authToken =>
        if (authToken.expirationTimestamp.isBefore(OffsetDateTime.now)) None else Some(authToken)
      })
  }

  def removeToken(id: String): Future[Int] = {
    val hashedTokenID: Array[Byte] = sha256Hasher.digest(id.getBytes)
    db.run(authTokenTable.remove(hashedTokenID))
  }

  def cleanAuthTokens: Future[Int] = db.run(authTokenTable.removeExpired(OffsetDateTime.now))

  def updateRole(userId: String, newRole: Role.Value): Future[Int] =
    db.run(userRoleTable.updateRole(userId, newRole))

  def setCommunityServiceStatus(userId: String, newCommServiceStatus: Boolean): Future[Int] =
    db.run(userRoleTable.updateCommunityService(userId, newCommServiceStatus))

  def setInfra3dAccess(userId: String, newAccess: Boolean): Future[Int] =
    db.run(userRoleTable.updateInfra3dAccess(userId, newAccess))
}
