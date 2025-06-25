package models.gallery

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

case class GalleryTaskInteraction(
    galleryTaskInteractionId: Int,
    action: String,
    panoId: Option[String],
    note: Option[String],
    timestamp: OffsetDateTime,
    userId: Option[String]
)

class GalleryTaskInteractionTableDef(tag: slick.lifted.Tag)
    extends Table[GalleryTaskInteraction](tag, "gallery_task_interaction") {
  def galleryTaskInteractionId: Rep[Int] = column[Int]("gallery_task_interaction_id", O.PrimaryKey, O.AutoInc)
  def action: Rep[String]                = column[String]("action")
  def panoId: Rep[Option[String]]        = column[Option[String]]("pano_id")
  def note: Rep[Option[String]]          = column[Option[String]]("note")
  def timestamp: Rep[OffsetDateTime]     = column[OffsetDateTime]("timestamp")
  def userId: Rep[Option[String]]        = column[Option[String]]("user_id")

  def * = (galleryTaskInteractionId, action, panoId, note, timestamp, userId) <> (
    (GalleryTaskInteraction.apply _).tupled,
    GalleryTaskInteraction.unapply
  )

//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("gallery_task_interaction_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
}

@ImplementedBy(classOf[GalleryTaskInteractionTable])
trait GalleryTaskInteractionTableRepository {}

@Singleton
class GalleryTaskInteractionTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends GalleryTaskInteractionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val galleryTaskInteractions = TableQuery[GalleryTaskInteractionTableDef]

  def insert(interaction: GalleryTaskInteraction): DBIO[Int] = {
    (galleryTaskInteractions returning galleryTaskInteractions.map(_.galleryTaskInteractionId)) += interaction
  }

  def insertMultiple(interactions: Seq[GalleryTaskInteraction]): DBIO[Seq[Int]] = {
    (galleryTaskInteractions returning galleryTaskInteractions.map(_.galleryTaskInteractionId)) ++= interactions
  }
}
