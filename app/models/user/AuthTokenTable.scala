package models.user

import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.DatabaseConfigProvider

import javax.inject._
import play.api.db.slick.HasDatabaseConfigProvider
import com.google.inject.ImplementedBy

import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.Future
import scala.concurrent.duration.FiniteDuration

case class AuthToken(id: Array[Byte], userID: String, expirationTimestamp: Timestamp)

class AuthTokenTableDef(tag: Tag) extends Table[AuthToken](tag, Some("sidewalk_login"), "auth_tokens") {
  def id: Rep[Array[Byte]] = column[Array[Byte]]("id")
  def userID: Rep[String] = column[String]("user_id", O.PrimaryKey)
  def expirationTimestamp: Rep[Timestamp] = column[Timestamp]("expiration_timestamp")
  def * = (id, userID, expirationTimestamp) <> (AuthToken.tupled, AuthToken.unapply)
}

@ImplementedBy(classOf[AuthTokenTable])
trait AuthTokenTableRepository {
}

@Singleton
class AuthTokenTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends AuthTokenTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._

  val authTokens = TableQuery[AuthTokenTableDef]

  def sha256Hasher: MessageDigest = MessageDigest.getInstance("SHA-256")

  /**
   * Finds a token by its ID.
   *
   * @param id The unique token ID.
   * @return The found token or None if no token for the given ID could be found.
   */
//  def find(id: UUID): Future[Option[AuthToken]] = {
//    val hashedTokenID = sha256Hasher.digest(id.toString.getBytes)
//    DB withSession { implicit session =>
//      Future.successful {
//        slickAuthTokens.filter(_.id === hashedTokenID).firstOption match {
//          case Some(info) => Some(AuthToken(info.id, UUID.fromString(info.userID), info.expirationTimestamp))
//          case None => None
//        }
//      }
//    }
//  }
//
//  /**
//   * Removes tokens that have expired before specified Timestamp.
//   *
//   * @param currentTime The current Timestamp.
//   * @return A future to wait for process to be completed.
//   */
//  def removeExpired(currentTime: Timestamp) = {
//    DB withSession { implicit session =>
//      Future.successful {
//        slickAuthTokens.filter(_.expirationTimestamp < currentTime).delete
//      }
//    }
//  }

  // NOTE THESE TWO FROM SERVICE
  /**
   * Creates a new auth token and saves it in the backing store.
   *
   * @param userID The user ID for which the token should be created.
   * @param expiry The duration a token expires.
   * @return The saved auth token.
   */
//  def create(userID: UUID, expiry: FiniteDuration = 60 minutes) = {
//    val tokenID = UUID.randomUUID()
//    val hashedTokenID = sha256Hasher.digest(tokenID.toString.getBytes)
//    val token = AuthToken(hashedTokenID, userID, new Timestamp(Instant.now.toEpochMilli + expiry.toMillis.toLong))
//    authTokenDAO.insert(token).flatMap {
//      case _ => Future.successful(tokenID)
//    }
//  }
  /**
   * Validates a token ID.
   *
   * @param id The token ID to validate.
   * @return The token if it's valid, None otherwise.
   */
//  def validate(id: UUID) = {
//    authTokenDAO.find(id).flatMap {
//      case Some(authToken) => Future.successful {
//        if (authToken.expiry.before(new Timestamp(Instant.now.toEpochMilli))) None else Some(authToken)
//      }
//
//      case None => Future.successful(None)
//    }
//  }



//
//  /**
//   * Saves a token.
//   *
//   * @param token The token to save.
//   * @return The saved token.
//   */
//  def insert(token: AuthToken): Future[AuthToken] = {
//    DB withSession { implicit session =>
//      Future.successful {
//        val dbAuthToken = DBAuthToken(token.id, token.userID.toString, token.expiry)
//        slickAuthTokens.insertOrUpdate(dbAuthToken)
//        token
//      }
//    }
//  }
//
//  /**
//   * Removes the token for the given ID.
//   *
//   * @param id The ID for which the token should be removed.
//   * @return A future to wait for the process to be completed.
//   */
//  def remove(id: UUID) = {
//    val hashedTokenID = sha256Hasher.digest(id.toString.getBytes)
//    DB withSession { implicit session =>
//      Future.successful {
//        slickAuthTokens.filter(_.id === hashedTokenID).delete
//      }
//    }
//  }
}
