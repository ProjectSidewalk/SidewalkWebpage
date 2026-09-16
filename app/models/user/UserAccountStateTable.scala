package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

/**
 * @param exploreTutorialCompletedAt When the user first finished or skipped the Explore tutorial, in any city.
 * @param sessionsRevokedAt          Sign-in cookies issued before this are no longer accepted (#5305).
 */
case class UserAccountState(
    userId: String,
    exploreTutorialCompletedAt: Option[OffsetDateTime],
    sessionsRevokedAt: Option[OffsetDateTime]
)

class UserAccountStateTableDef(tag: Tag) extends Table[UserAccountState](tag, "user_account_state") {
  def userId: Rep[String]                                     = column[String]("user_id", O.PrimaryKey)
  def exploreTutorialCompletedAt: Rep[Option[OffsetDateTime]] =
    column[Option[OffsetDateTime]]("explore_tutorial_completed_at")
  def sessionsRevokedAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("sessions_revoked_at")

  def * = (userId, exploreTutorialCompletedAt, sessionsRevokedAt) <> (
    (UserAccountState.apply _).tupled,
    UserAccountState.unapply
  )

  def user = foreignKey("user_account_state_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
}

@ImplementedBy(classOf[UserAccountStateTable])
trait UserAccountStateTableRepository {}

/**
 * Things the site records about a user that belong to their account rather than to one city (#3720), like having
 * finished the Explore tutorial. Unlike `user_settings`, the user doesn't choose these. The table lives in the shared
 * `sidewalk_login` schema so that what a user did in one city carries over to every other city.
 *
 * A row is only written once there's something to record, so a missing row means nothing has been recorded yet.
 */
@Singleton
class UserAccountStateTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    ec: ExecutionContext
) extends UserAccountStateTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userAccountStates = TableQuery[UserAccountStateTableDef]

  /** Whether the user has finished or skipped the Explore tutorial in any city. */
  def hasCompletedExploreTutorial(userId: String): DBIO[Boolean] = {
    userAccountStates.filter(s => s.userId === userId && s.exploreTutorialCompletedAt.isDefined).exists.result
  }

  /**
   * Records that the user finished or skipped the Explore tutorial. A retake keeps the original time.
   *
   * @param userId The user who finished it.
   * @return       The number of rows written.
   */
  def markExploreTutorialCompleted(userId: String): DBIO[Int] = {
    sqlu"""
      INSERT INTO sidewalk_login.user_account_state (user_id, explore_tutorial_completed_at)
      VALUES ($userId, now())
      ON CONFLICT (user_id) DO UPDATE SET explore_tutorial_completed_at =
        COALESCE(user_account_state.explore_tutorial_completed_at, EXCLUDED.explore_tutorial_completed_at)
    """
  }

  /** When the account's sign-ins were last revoked, looked up by email because that's what a sign-in cookie holds. */
  def sessionsRevokedAt(email: String): DBIO[Option[OffsetDateTime]] = {
    userAccountStates
      .join(TableQuery[SidewalkUserTableDef])
      .on(_.userId === _.userId)
      .filter(_._2.email === email.toLowerCase)
      .map(_._1.sessionsRevokedAt)
      .result
      .headOption
      .map(_.flatten)
  }

  /**
   * Rejects the user's sign-in cookies issued before `at`, which the caller picks so a cookie it issues next is newer.
   * Capped at the database's clock, so an app server whose clock runs fast can't lock the account out until then.
   *
   * @return The number of rows written.
   */
  def revokeSessions(userId: String, at: OffsetDateTime): DBIO[Int] = {
    sqlu"""
      INSERT INTO sidewalk_login.user_account_state (user_id, sessions_revoked_at)
      VALUES ($userId, LEAST($at, now()))
      ON CONFLICT (user_id) DO UPDATE SET sessions_revoked_at = EXCLUDED.sessions_revoked_at
    """
  }
}
