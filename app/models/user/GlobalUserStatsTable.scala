package models.user

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import models.utils.MyPostgresDriver.simple._

case class GlobalUserStats(userId: UUID,
                           tutorialCompleted: Boolean,
                           tutorialCompletedAt: Option[Timestamp])

class GlobalUserStatsTable(tag: Tag)
  extends Table[GlobalUserStats](tag, Some("sidewalk_login"), "global_user_stats") {

  def userId              = column[UUID]   ("user_id",           O.PrimaryKey)
  def tutorialCompleted   = column[Boolean]("tutorial_completed", O.NotNull)
  def tutorialCompletedAt = column[Option[Timestamp]]("tutorial_completed_at")

  def * = (userId, tutorialCompleted, tutorialCompletedAt) <> ((GlobalUserStats.apply _).tupled, GlobalUserStats.unapply)
}

object GlobalUserStatsTable {
  val globalStats = TableQuery[GlobalUserStatsTable]

  def hasCompleted(userId: UUID)(implicit s: Session): Boolean =
    globalStats.filter(_.userId === userId).map(_.tutorialCompleted).firstOption.getOrElse(false)

  def markCompleted(userId: UUID)(implicit s: Session): Unit = {
    val now = new Timestamp(Instant.now.toEpochMilli)
    globalStats.insertOrUpdate(GlobalUserStats(userId, tutorialCompleted = true, Some(now)))
  }
}
