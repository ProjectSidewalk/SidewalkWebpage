package models.gallery

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class GalleryTaskInteraction(galleryTaskInteractionId: Int, action: String, panoId: Option[String],
                                  note: Option[String], timestamp: java.sql.Timestamp, userId: Option[String])

class GalleryTaskInteractionTable(tag: slick.lifted.Tag) extends Table[GalleryTaskInteraction](tag, "gallery_task_interaction") {
  def galleryTaskInteractionId = column[Int]("gallery_task_interaction_id", O.PrimaryKey, O.AutoInc)
  def action = column[String]("action", O.NotNull)
  def panoId = column[Option[String]]("pano_id", O.Nullable)
  def note = column[Option[String]]("note", O.Nullable)
  def timestamp = column[java.sql.Timestamp]("timestamp", O.NotNull)
  def userId = column[Option[String]]("user_id", O.Nullable)

  def * = (galleryTaskInteractionId, action, panoId, note, timestamp, userId) <> ((GalleryTaskInteraction.apply _).tupled, GalleryTaskInteraction.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("gallery_task_interaction_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
}

object GalleryTaskInteractionTable {
  val db = play.api.db.slick.DB
  val galleryTaskInteractions = TableQuery[GalleryTaskInteractionTable]

  /**
    * Inserts an interaction into the gallery_task_interaction table.
    *
    * @param interaction The interaction to be saved.
    * @return
    */
  def save(interaction: GalleryTaskInteraction): Int = db.withTransaction { implicit session =>
    val interactionId: Int =
      (galleryTaskInteractions returning galleryTaskInteractions.map(_.galleryTaskInteractionId)).insert(interaction)
    interactionId
  }

  /**
    * Inserts a sequence of interactions into the gallery_task_interaction table.
    *
    * @param interactions The interactions to be saved.
    * @return
    */
  def saveMultiple(interactions: Seq[GalleryTaskInteraction]): Seq[Int] = db.withTransaction { implicit session =>
    (galleryTaskInteractions returning galleryTaskInteractions.map(_.galleryTaskInteractionId)) ++= interactions
  }
}
