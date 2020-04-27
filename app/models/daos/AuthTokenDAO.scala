package models.daos

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

import models.AuthToken
import org.joda.time.DateTime

import scala.concurrent.Future

/**
 * Give access to the [[AuthToken]] object.
 */
trait AuthTokenDAO {

  /**
   * Finds a token by its ID.
   *
   * @param id The unique token ID.
   * @return The found token or None if no token for the given ID could be found.
   */
  def find(id: UUID): Future[Option[AuthToken]]

  /**
   * Removes tokens that have expired before specified Timestamp
   *
   * @param dateTime The current date time.
   * @return a future to wait for the process to be completed
   */
  def removeExpired(dateTime: Timestamp): Future[Unit]

  /**
   * Saves a token.
   *
   * @param token The token to save.
   * @return The saved token.
   */
  def save(token: AuthToken): Future[AuthToken]

  /**
   * Removes the token for the given ID.
   *
   * @param id The ID for which the token should be removed.
   * @return A future to wait for the process to be completed.
   */
  def remove(id: UUID): Future[Unit]
}
