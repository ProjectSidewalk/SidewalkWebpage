package models.daos

import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import models.AuthToken
import models.daos.AuthTokenDAOImpl._

import org.joda.time.DateTime

import scala.collection.mutable
import scala.concurrent.Future

/**
 * Give access to the [[AuthToken]] object.
 */
class AuthTokenDAOImpl extends AuthTokenDAO {

  /**
   * AuthToken hasher
   *
   * @return A cryptographic hasher utilizing SHA-256
   */
  def sha256Hasher: MessageDigest = MessageDigest.getInstance("SHA-256")

  /**
   * Finds a token by its ID.
   *
   * @param id The unique token ID.
   * @return The found token or None if no token for the given ID could be found.
   */
  def find(id: UUID) = Future.successful {
    val hashedTokenID = sha256Hasher.digest(id.toString.getBytes)
    tokens.get(hashedTokenID)
  }

  /**
   * Removes expired tokens.
   *
   * @param dateTime The current date time.
   * @return A future to wait for the process to be completed
   */
  def removeExpired(currentTime: Timestamp) = Future.successful {
    val expiredTokens = tokens.filter {
      case (_, token) =>
        token.expiry.before(currentTime)
    }

    expiredTokens.foreach { expiredToken =>
      tokens -= expiredToken._1
    }
  }

  /**
   * Saves a token.
   *
   * @param token The token to save.
   * @return The saved token.
   */
  def save(token: AuthToken) = {
    tokens += (token.id -> token)
    Future.successful(token)
  }

  /**
   * Removes the token for the given ID.
   *
   * @param id The ID for which the token should be removed.
   * @return A future to wait for the process to be completed.
   */
  def remove(id: UUID) = {
    val hashedTokenID = sha256Hasher.digest(id.toString.getBytes)
    tokens -= hashedTokenID
    Future.successful(())
  }
}

/**
 * The companion object.
 */
object AuthTokenDAOImpl {

  /**
   * The list of tokens.
   */
  val tokens: mutable.HashMap[Array[Byte], AuthToken] = mutable.HashMap()
}
