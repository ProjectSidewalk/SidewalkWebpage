package models.pano

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class PanoLink(panoId: String, targetPanoId: String, yawDeg: Double, description: Option[String])

class PanoLinkTableDef(tag: Tag) extends Table[PanoLink](tag, "pano_link") {
  def panoId: Rep[String]              = column[String]("pano_id")
  def targetPanoId: Rep[String]        = column[String]("target_pano_id")
  def yawDeg: Rep[Double]              = column[Double]("yaw_deg")
  def description: Rep[Option[String]] = column[Option[String]]("description")

  def * = (panoId, targetPanoId, yawDeg, description) <> ((PanoLink.apply _).tupled, PanoLink.unapply)

  def pano = foreignKey("pano_link_pano_id_fkey", panoId, TableQuery[PanoDataTableDef])(_.panoId)
  def pk   = primaryKey("gsv_link_pkey", (panoId, targetPanoId))
}

@ImplementedBy(classOf[PanoLinkTable])
trait PanoLinkTableRepository {}

@Singleton
class PanoLinkTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext
) extends PanoLinkTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val panoLinks = TableQuery[PanoLinkTableDef]

  /**
   * Save a PanoLink object to the PanoLink table if it isn't already in the table.
   *
   * `ON CONFLICT DO NOTHING` rather than a check-then-insert, so concurrent submissions of the same link (e.g. a
   * `pagehide` flush racing a mission-complete POST) can't fail on a duplicate key (#4587).
   *
   * @return Number of rows inserted (0 if the link was already recorded).
   */
  def insertIfNew(link: PanoLink): DBIO[Int] = {
    sqlu"""
      INSERT INTO pano_link (pano_id, target_pano_id, yaw_deg, description)
      VALUES (${link.panoId}, ${link.targetPanoId}, ${link.yawDeg}, ${link.description})
      ON CONFLICT DO NOTHING
    """
  }
}
