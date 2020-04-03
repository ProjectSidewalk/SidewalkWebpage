package models.daos.slick

import java.sql.Timestamp
import java.util.UUID
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
   * Finds a token by its ID.
   *
   * @param id The unique token ID.
   * @return The found token or None if no token for the given ID could be found.
   */
  def find(id: UUID) = {
    DB withSession { implicit session =>
      Future.successful {
        slickAuthTokens.filter(
          x => x.id === id.toString
        ).firstOption match {
          case Some(info) => Some(AuthToken(UUID.fromString(info.id), UUID.fromString(info.userID), info.timestamp))
          case None => None
        }
      }
    }
  }

  /**
   * Finds expired tokens.
   *
   * @param dateTime The current date time.
   */
  def findExpired(currentTime: Timestamp) = {
    DB withSession { implicit session =>
      Future.successful {
        val expiredTokens = slickAuthTokens.filter(_.timestamp < currentTime).list.map { authToken =>
          AuthToken(UUID.fromString(authToken.id), UUID.fromString(authToken.userID), authToken.timestamp)
        }.seq
        expiredTokens
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
        val dbAuthToken = DBAuthToken(token.id.toString, token.userID.toString, token.expiry)
        slickAuthTokens.filter(x => x.userID === dbAuthToken.userID).firstOption match {
          case Some(authToken) => Logger.debug("Auth Token for user already exists: " + authToken)
          case None =>
            slickAuthTokens insert dbAuthToken
        }
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
    DB withSession { implicit session =>
      Future.successful {
        slickAuthTokens.filter(x => x.id === id.toString).delete
      }
    }
  }
}