package models.story

import com.google.inject.ImplementedBy
import models.label.LabelTableDef
import models.user.SidewalkUserTableDef
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * A lived-experience story attached to a label (#4054): the author's personal account of how this barrier affected
 * them, public on submit and retractable by the author.
 *
 * @param storyId         Primary key.
 * @param labelId         The label the story is anchored to.
 * @param userId          The author. Anonymous-session users are real DB users, so they can own stories too.
 * @param storyText       The story itself.
 * @param displayNameMode `anonymous` (default) or `username` — what the public sees as the author.
 * @param visibility      Moderation state (see StoryVisibility). Hidden = admin quarantine (reversible, preserves
 *                        abuse evidence); retraction is a real row DELETE instead.
 * @param moderatedBy     The admin who last changed visibility; None if never moderated.
 * @param moderatedAt     When visibility last changed.
 * @param createdAt       When the story was posted.
 */
case class Story(
    storyId: Int,
    labelId: Int,
    userId: String,
    storyText: String,
    displayNameMode: String,
    visibility: StoryVisibility.Value,
    moderatedBy: Option[String],
    moderatedAt: Option[OffsetDateTime],
    createdAt: OffsetDateTime
) {

  /**
   * The single viewer-visibility policy for a story (#4054): everyone sees a visible story; a hidden one stays in
   * sight of admins and its author (who keeps the right to retract it). StoryTable.getForLabel encodes this same
   * policy as a SQL predicate — keep the two in sync.
   */
  def viewableBy(viewerUserId: Option[String], isAdmin: Boolean): Boolean =
    isAdmin || visibility == StoryVisibility.Visible || viewerUserId.contains(userId)
}

object Story {
  val DisplayNameAnonymous = "anonymous"
  val DisplayNameUsername  = "username"

  val validDisplayNameModes: Set[String] = Set(DisplayNameAnonymous, DisplayNameUsername)
}

class StoryTableDef(tag: Tag) extends Table[Story](tag, "story") {
  def storyId: Rep[Int]                        = column[Int]("story_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]                        = column[Int]("label_id")
  def userId: Rep[String]                      = column[String]("user_id")
  def storyText: Rep[String]                   = column[String]("story_text")
  def displayNameMode: Rep[String]             = column[String]("display_name_mode")
  def visibility: Rep[StoryVisibility.Value]   = column[StoryVisibility.Value]("visibility")
  def moderatedBy: Rep[Option[String]]         = column[Option[String]]("moderated_by")
  def moderatedAt: Rep[Option[OffsetDateTime]] = column[Option[OffsetDateTime]]("moderated_at")
  def createdAt: Rep[OffsetDateTime]           = column[OffsetDateTime]("created_at")

  def * = (storyId, labelId, userId, storyText, displayNameMode, visibility, moderatedBy, moderatedAt, createdAt) <> (
    (Story.apply _).tupled,
    Story.unapply
  )
}

@ImplementedBy(classOf[StoryTable])
trait StoryTableRepository {}

/**
 * Queries for stories and their attached media. Deletes here are real row deletes (retraction contract, #4054);
 * `story_media` rows cascade in the DB, so callers fetch media rows first when they need to remove files from disk.
 */
@Singleton
class StoryTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext
) extends StoryTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val stories    = TableQuery[StoryTableDef]
  val storyMedia = TableQuery[StoryMediaTableDef]
  val users      = TableQuery[SidewalkUserTableDef]
  val labels     = TableQuery[LabelTableDef]

  def insert(story: Story): DBIO[Int] = {
    (stories returning stories.map(_.storyId)) += story
  }

  def insertMedia(media: StoryMedia): DBIO[Int] = {
    (storyMedia returning storyMedia.map(_.storyMediaId)) += media
  }

  /** The label must exist and not be soft-deleted for a story to attach to it. */
  def labelExists(labelId: Int): DBIO[Boolean] = {
    labels.filter(l => l.labelId === labelId && l.deleted === false).exists.result
  }

  /** The label's type id, or None when the label doesn't exist. Drives the card's problem-vs-feature story copy. */
  def labelTypeIdForLabel(labelId: Int): DBIO[Option[Int]] = {
    labels.filter(_.labelId === labelId).map(_.labelTypeId).result.headOption
  }

  def userHasStoryOnLabel(labelId: Int, userId: String): DBIO[Boolean] = {
    stories.filter(s => s.labelId === labelId && s.userId === userId).exists.result
  }

  /** Counts the user's stories posted since `since` — the always-on submission rate limit. */
  def countByUserSince(userId: String, since: OffsetDateTime): DBIO[Int] = {
    stories.filter(s => s.userId === userId && s.createdAt >= since).length.result
  }

  def getMediaForStory(storyId: Int): DBIO[Seq[StoryMedia]] = {
    storyMedia.filter(_.storyId === storyId).result
  }

  def getMediaWithStory(storyMediaId: Int): DBIO[Option[(StoryMedia, Story)]] = {
    storyMedia
      .filter(_.storyMediaId === storyMediaId)
      .join(stories)
      .on(_.storyId === _.storyId)
      .result
      .headOption
  }

  /**
   * Stories to show on the label-detail card: everyone's visible stories, plus the viewer's own hidden story (the
   * author keeps sight of their quarantined story and the right to retract it), plus everything for admins.
   */
  def getForLabel(
      labelId: Int,
      viewerUserId: Option[String],
      isAdmin: Boolean
  ): DBIO[Seq[(Story, Option[StoryMedia], String)]] = {
    // The SQL twin of Story.viewableBy — keep the two in sync.
    val visible = stories.filter { s =>
      val base = s.labelId === labelId
      if (isAdmin) base
      else base && (s.visibility === StoryVisibility.Visible || s.userId === viewerUserId.getOrElse(""))
    }
    visible
      .join(users)
      .on(_.userId === _.userId)
      .joinLeft(storyMedia)
      .on(_._1.storyId === _.storyId)
      .sortBy(_._1._1.createdAt.desc)
      .result
      .map(_.map { case ((story, user), media) => (story, media, user.username) })
  }

  /** All of one user's stories (including hidden ones), for the dashboard management surface. */
  def getForUser(userId: String): DBIO[Seq[(Story, Option[StoryMedia], Int)]] = {
    stories
      .filter(_.userId === userId)
      .join(labels)
      .on(_.labelId === _.labelId)
      .joinLeft(storyMedia)
      .on(_._1.storyId === _.storyId)
      .sortBy(_._1._1.createdAt.desc)
      .result
      .map(_.map { case ((story, label), media) => (story, media, label.labelTypeId) })
  }

  /** Most recent stories across all users (hidden included), for the admin moderation queue. */
  def getRecent(n: Int): DBIO[Seq[(Story, Option[StoryMedia], String, Int)]] = {
    stories
      .join(users)
      .on(_.userId === _.userId)
      .join(labels)
      .on(_._1.labelId === _.labelId)
      .joinLeft(storyMedia)
      .on(_._1._1.storyId === _.storyId)
      .sortBy(_._1._1._1.createdAt.desc)
      .take(n)
      .result
      .map(_.map { case (((story, user), label), media) => (story, media, user.username, label.labelTypeId) })
  }

  def setVisibility(
      storyId: Int,
      visibility: StoryVisibility.Value,
      adminUserId: String,
      now: OffsetDateTime
  ): DBIO[Int] = {
    stories
      .filter(_.storyId === storyId)
      .map(s => (s.visibility, s.moderatedBy, s.moderatedAt))
      .update((visibility, Some(adminUserId), Some(now)))
  }

  /** The story only if `userId` owns it — the ownership gate for in-place edits. */
  def getOwned(storyId: Int, userId: String): DBIO[Option[Story]] = {
    stories.filter(s => s.storyId === storyId && s.userId === userId).result.headOption
  }

  /**
   * Updates the author-editable fields only; visibility/moderation columns are deliberately untouched, so a
   * moderator-hidden story stays hidden through an edit.
   */
  def updateOwnedContent(storyId: Int, userId: String, text: String, displayNameMode: String): DBIO[Int] = {
    stories
      .filter(s => s.storyId === storyId && s.userId === userId)
      .map(s => (s.storyText, s.displayNameMode))
      .update((text, displayNameMode))
  }

  def deleteMediaForStory(storyId: Int): DBIO[Int] = {
    storyMedia.filter(_.storyId === storyId).delete
  }

  /**
   * Deletes specific media rows by id. Used by the photo-replace path to retire the old row *after* the replacement
   * is safely on disk, and to compensate the new row if placement fails — deleteMediaForStory can't, since during
   * that swap both the old and new rows briefly coexist. An empty id list deletes nothing.
   */
  def deleteMediaRows(storyMediaIds: Seq[Int]): DBIO[Int] = {
    storyMedia.filter(_.storyMediaId inSet storyMediaIds).delete
  }

  def updateMediaAltText(storyId: Int, altText: Option[String]): DBIO[Int] = {
    storyMedia.filter(_.storyId === storyId).map(_.altText).update(altText)
  }

  /** Deletes the story only if `userId` owns it. Returns the number of rows deleted (0 = not found or not owner). */
  def deleteOwned(storyId: Int, userId: String): DBIO[Int] = {
    stories.filter(s => s.storyId === storyId && s.userId === userId).delete
  }

  def delete(storyId: Int): DBIO[Int] = {
    stories.filter(_.storyId === storyId).delete
  }
}
