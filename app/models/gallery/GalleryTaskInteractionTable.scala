package models.gallery

import com.google.inject.ImplementedBy

import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current
import slick.lifted.MappedToBase.mappedToIsomorphism

import java.sql.Timestamp
import javax.inject.{Inject, Singleton}


case class GalleryTaskInteraction(galleryTaskInteractionId: Int, action: String, panoId: Option[String],
                                  note: Option[String], timestamp: Timestamp, userId: Option[String])

class GalleryTaskInteractionTableDef(tag: slick.lifted.Tag) extends Table[GalleryTaskInteraction](tag, "gallery_task_interaction") {
  def galleryTaskInteractionId: Rep[Int] = column[Int]("gallery_task_interaction_id", O.PrimaryKey, O.AutoInc)
  def action: Rep[String] = column[String]("action")
  def panoId: Rep[Option[String]] = column[Option[String]]("pano_id")
  def note: Rep[Option[String]] = column[Option[String]]("note")
  def timestamp: Rep[Timestamp] = column[Timestamp]("timestamp")
  def userId: Rep[Option[String]] = column[Option[String]]("user_id")

  def * = (galleryTaskInteractionId, action, panoId, note, timestamp, userId) <> ((GalleryTaskInteraction.apply _).tupled, GalleryTaskInteraction.unapply)

//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("gallery_task_interaction_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
}

@ImplementedBy(classOf[GalleryTaskInteractionTable])
trait GalleryTaskInteractionTableRepository {
}

@Singleton
class GalleryTaskInteractionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends GalleryTaskInteractionTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val galleryTaskInteractions = TableQuery[GalleryTaskInteractionTableDef]

  /**
    * Inserts an interaction into the gallery_task_interaction table.
    *
    * @param interaction The interaction to be saved.
    * @return
    */
//  def save(interaction: GalleryTaskInteraction): Int = {
//    (galleryTaskInteractions returning galleryTaskInteractions.map(_.galleryTaskInteractionId)).insert(interaction)
//  }
//
//  /**
//    * Inserts a sequence of interactions into the gallery_task_interaction table.
//    *
//    * @param interactions The interactions to be saved.
//    * @return
//    */
//  def saveMultiple(interactions: Seq[GalleryTaskInteraction]): Seq[Int] = {
//    (galleryTaskInteractions returning galleryTaskInteractions.map(_.galleryTaskInteractionId)) ++= interactions
//  }
}
