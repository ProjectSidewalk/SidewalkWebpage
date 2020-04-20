package models.daos.slick

import java.sql.Timestamp
import java.util.UUID
import java.security.MessageDigest
import models.AuthToken
import play.api.db.slick._
import models.utils.MyPostgresDriver.simple._
import models.daos.slick.DBTableDefinitions._
import play.Logger
import models.daos.AuthTokenDAO

import scala.concurrent.Future

class AuthTokenDAOSlick extends AuthTokenDAO {
  import play.api.Play.current

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
  def find(id: UUID) = {
    val hashedTokenID = sha256Hasher.digest(id.toString.getBytes)
    DB withSession { implicit session =>
      Future.successful {
        slickAuthTokens.filter(_.id === hashedTokenID).firstOption match {
          case Some(info) => Some(AuthToken(info.id, UUID.fromString(info.userID), info.expirationTimestamp))
          case None => None
        }
      }
    }
  }

  /**
   * Removes expired tokens.
   *
   * @param dateTime The current date time.
   * @return A future to wait for process to be completed
   */
  def removeExpired(currentTime: Timestamp) = {
    DB withSession { implicit session =>
      Future.successful {
        slickAuthTokens.filter(_.expirationTimestamp < currentTime).delete
      }
    }
  }

  /**
   * Saves a token.
   *
   * @param token The token to save.
   * @return The saved token.
   */
  def save(token: AuthToken) = {
    DB withSession { implicit session =>
      Future.successful {
        val dbAuthToken = DBAuthToken(token.id, token.userID.toString, token.expiry)
        slickAuthTokens.insertOrUpdate(dbAuthToken)
        token
      }
    }
  }

  /**
   * Removes the token for the given ID.
   *
   * @param id The ID for which the token should be removed.
   * @return A future to wait for the process to be completed.
   */
  def remove(id: UUID) = {
    val hashedTokenID = sha256Hasher.digest(id.toString.getBytes)
    DB withSession { implicit session =>
      Future.successful {
        slickAuthTokens.filter(_.id === hashedTokenID).delete
      }
    }
  }
}
