package models.services

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.security.MessageDigest
import javax.inject.Inject
import models.AuthToken
import models.daos.AuthTokenDAO
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.language.postfixOps
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Handles actions to auth tokens.
 *
 * @param authTokenDAO The auth token DAO implementation.
 */
class AuthTokenServiceImpl @Inject() (authTokenDAO: AuthTokenDAO) extends AuthTokenService {

  /**
   * AuthToken hasher.
   *
   * @return A cryptographic hasher utilizing SHA-256.
   */
  def sha256Hasher: MessageDigest = MessageDigest.getInstance("SHA-256")

  /**
   * Creates a new auth token and saves it in the backing store.
   *
   * @param userID The user ID for which the token should be created.
   * @param expiry The duration a token expires.
   * @return The saved auth token.
   */
  def create(userID: UUID, expiry: FiniteDuration = 60 minutes) = {
    val tokenID = UUID.randomUUID()
    val hashedTokenID = sha256Hasher.digest(tokenID.toString.getBytes)
    val token = AuthToken(hashedTokenID, userID, new Timestamp(Instant.now.toEpochMilli + expiry.toMillis.toLong))
    authTokenDAO.save(token).flatMap {
      case _ => Future.successful(tokenID)
    }
  }

  /**
   * Validates a token ID.
   *
   * @param id The token ID to validate.
   * @return The token if it's valid, None otherwise.
   */
  def validate(id: UUID) = {
    authTokenDAO.find(id).flatMap {
      case Some(authToken) => Future.successful {
        if (authToken.expiry.before(new Timestamp(Instant.now.toEpochMilli))) None else Some(authToken)
      }

      case None => Future.successful(None)
    }
  }

  /**
   * Cleans expired tokens.
   *
   * @return The list of deleted tokens.
   */
  def clean = authTokenDAO.removeExpired(new Timestamp(Instant.now.toEpochMilli))

  /**
   * Remove token associated with given token id.
   *
   * @param id the id of the token to remove.
   * @return A future to wait for the process to be completed.
   */
  def remove(id: UUID) = authTokenDAO.remove(id)
}
