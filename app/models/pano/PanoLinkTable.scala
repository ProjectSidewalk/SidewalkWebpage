package models.pano

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class PanoLink(panoId: String, targetPanoId: String, yawDeg: Double, description: Option[String])

class PanoLinkTableDef(tag: Tag) extends Table[PanoLink](tag, "pano_link") {
  def panoId: Rep[String]              = column[String]("pano_id", O.PrimaryKey)
  def targetPanoId: Rep[String]        = column[String]("target_pano_id")
  def yawDeg: Rep[Double]              = column[Double]("yaw_deg")
  def description: Rep[Option[String]] = column[Option[String]]("description")

  def * = (panoId, targetPanoId, yawDeg, description) <> ((PanoLink.apply _).tupled, PanoLink.unapply)
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
   */
  def insertIfNew(link: PanoLink): DBIO[Int] = {
    panoLinks
      .filter(l => l.panoId === link.panoId && l.targetPanoId === link.targetPanoId)
      .result
      .headOption
      .flatMap {
        case Some(_) => DBIO.successful(0)
        case None    => panoLinks += link
      }
  }
}
