package models.services

import java.util.UUID
import models.AuthToken
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.language.postfixOps

/**
 * Handles actions to auth tokens.
 */
trait AuthTokenService {

  /**
   * Creates a new auth token and saves it in the backing store.
   *
   * @param userID The user ID for which the token should be created.
   * @param expiry The duration a token expires.
   * @return The saved auth token id.
   */
  def create(userID: UUID, expiry: FiniteDuration = 60 minutes): Future[UUID]

  /**
   * Validates a token ID.
   *
   * @param id The token ID to validate.
   * @return The token if it's valid, None otherwise.
   */
  def validate(id: UUID): Future[Option[AuthToken]]

  /**
   * Cleans expired tokens.
   *
   * @return The list of deleted tokens.
   */
  def clean: Future[Unit]

  /**
   * Remove token associated with given token id.
   *
   * @param id the id of the token to remove.
   * @return A future to wait for the process to be completed.
   */
  def remove(id: UUID): Future[Unit]
}
