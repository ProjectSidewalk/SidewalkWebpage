package models.user

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import javax.inject._
import com.google.inject.ImplementedBy
import java.time.OffsetDateTime
import scala.concurrent.ExecutionContext

case class AuthToken(id: Array[Byte], userID: String, expirationTimestamp: OffsetDateTime)

class AuthTokenTableDef(tag: Tag) extends Table[AuthToken](tag, Some("sidewalk_login"), "auth_tokens") {
  def id: Rep[Array[Byte]] = column[Array[Byte]]("id")
  def userID: Rep[String] = column[String]("user_id", O.PrimaryKey)
  def expirationTimestamp: Rep[OffsetDateTime] = column[OffsetDateTime]("expiration_timestamp")
  def * = (id, userID, expirationTimestamp) <> (AuthToken.tupled, AuthToken.unapply)
}

@ImplementedBy(classOf[AuthTokenTable])
trait AuthTokenTableRepository {
}

@Singleton
class AuthTokenTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext) extends AuthTokenTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  val authTokens = TableQuery[AuthTokenTableDef]

  /**
   * Finds a token by its ID.
   *
   * @param id The unique token ID.
   * @return The found token or None if no token for the given ID could be found.
   */
  def find(hashedTokenID: Array[Byte]): DBIO[Option[AuthToken]] = {
    authTokens.filter(_.id === hashedTokenID).result.headOption
  }

  // TODO also called clean from the Actor.
//  /**
//   * Removes tokens that have expired before specified Timestamp.
//   *
//   * @param currentTime The current Timestamp.
//   * @return A future to wait for process to be completed.
//   */
//  def removeExpired(currentTime: OffsetDateTime) = {
//    DB withSession { implicit session =>
//      Future.successful {
//        slickAuthTokens.filter(_.expirationTimestamp < currentTime).delete
//      }
//    }
//  }

  /**
   * Saves a token.
   *
   * @param token The token to save.
   * @return The saved token.
   */
  def insert(token: AuthToken): DBIO[AuthToken] = {
    authTokens.insertOrUpdate(token).map(_ => token)
  }

  /**
   * Removes the token for the given ID.
   *
   * @param id The ID for which the token should be removed.
   */
  def remove(hashedTokenID: Array[Byte]): DBIO[Int] = {
    authTokens.filter(_.id === hashedTokenID).delete
  }
}
