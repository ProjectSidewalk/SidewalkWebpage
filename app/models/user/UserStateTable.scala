package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._

/** @param exploreTutorialCompletedAt When the user first finished or skipped the Explore tutorial, in any city. */
case class UserState(userId: String, exploreTutorialCompletedAt: Option[OffsetDateTime])

class UserStateTableDef(tag: Tag) extends Table[UserState](tag, "user_state") {
  def userId: Rep[String]                                     = column[String]("user_id", O.PrimaryKey)
  def exploreTutorialCompletedAt: Rep[Option[OffsetDateTime]] =
    column[Option[OffsetDateTime]]("explore_tutorial_completed_at")

  def * = (userId, exploreTutorialCompletedAt) <> ((UserState.apply _).tupled, UserState.unapply)

  def user = foreignKey("user_state_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
}

@ImplementedBy(classOf[UserStateTable])
trait UserStateTableRepository {}

/**
 * Things the site records about a user that belong to their account rather than to one city (#3720), like having
 * finished the Explore tutorial. Unlike `user_settings`, the user doesn't choose these. The table lives in the shared
 * `sidewalk_login` schema so that what a user did in one city carries over to every other city.
 *
 * A row is only written once there's something to record, so a missing row means nothing has been recorded yet.
 */
@Singleton
class UserStateTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends UserStateTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userStates = TableQuery[UserStateTableDef]

  /** Whether the user has finished or skipped the Explore tutorial in any city. */
  def hasCompletedExploreTutorial(userId: String): DBIO[Boolean] = {
    userStates.filter(s => s.userId === userId && s.exploreTutorialCompletedAt.isDefined).exists.result
  }

  /**
   * Records that the user finished or skipped the Explore tutorial. A retake keeps the original time, since that's when
   * they first learned the tool.
   *
   * @param userId The user who finished it.
   * @return       The number of rows written.
   */
  def markExploreTutorialCompleted(userId: String): DBIO[Int] = {
    sqlu"""
      INSERT INTO sidewalk_login.user_state (user_id, explore_tutorial_completed_at)
      VALUES ($userId, now())
      ON CONFLICT (user_id) DO UPDATE SET explore_tutorial_completed_at =
        COALESCE(user_state.explore_tutorial_completed_at, EXCLUDED.explore_tutorial_completed_at)
    """
  }
}
