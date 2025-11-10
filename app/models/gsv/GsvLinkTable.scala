package models.gsv

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class GsvLink(gsvPanoramaId: String, targetGsvPanoramaId: String, yawDeg: Double, description: Option[String])

class GsvLinkTableDef(tag: Tag) extends Table[GsvLink](tag, "gsv_link") {
  def gsvPanoramaId: Rep[String]       = column[String]("gsv_panorama_id", O.PrimaryKey)
  def targetGsvPanoramaId: Rep[String] = column[String]("target_panorama_id")
  def yawDeg: Rep[Double]              = column[Double]("yaw_deg")
  def description: Rep[Option[String]] = column[Option[String]]("description")

  def * = (gsvPanoramaId, targetGsvPanoramaId, yawDeg, description) <> ((GsvLink.apply _).tupled, GsvLink.unapply)
}

@ImplementedBy(classOf[GsvLinkTable])
trait GsvLinkTableRepository {}

@Singleton
class GsvLinkTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider, implicit val ec: ExecutionContext)
    extends GsvLinkTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val gsvLinks = TableQuery[GsvLinkTableDef]

  /**
   * Save a GsvLink object to the GsvLink table if it isn't already in the table.
   */
  def insertIfNew(link: GsvLink): DBIO[Int] = {
    gsvLinks
      .filter(l => l.gsvPanoramaId === link.gsvPanoramaId && l.targetGsvPanoramaId === link.targetGsvPanoramaId)
      .result
      .headOption
      .flatMap {
        case Some(_) => DBIO.successful(0)
        case None    => gsvLinks += link
      }
  }
}
