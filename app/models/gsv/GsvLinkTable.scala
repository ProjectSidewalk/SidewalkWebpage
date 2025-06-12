package models.gsv

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class GsvLink(gsvPanoramaId: String, targetGsvPanoramaId: String, yawDeg: Double, description: String)

class GsvLinkTableDef(tag: Tag) extends Table[GsvLink](tag, "gsv_link") {
  def gsvPanoramaId: Rep[String] = column[String]("gsv_panorama_id", O.PrimaryKey)
  def targetGsvPanoramaId: Rep[String] = column[String]("target_panorama_id")
  def yawDeg: Rep[Double] = column[Double]("yaw_deg")
  def description: Rep[String] = column[String]("description")

  def * = (gsvPanoramaId, targetGsvPanoramaId, yawDeg, description) <> ((GsvLink.apply _).tupled, GsvLink.unapply)
}

@ImplementedBy(classOf[GsvLinkTable])
trait GsvLinkTableRepository { }

@Singleton
class GsvLinkTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends GsvLinkTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val gsvLinks = TableQuery[GsvLinkTableDef]

  /**
   * This method checks if the link already exists or not.
   * @param panoramaId Google Street View panorama id
   */
  def linkExists(panoramaId: String, targetPanoramaId: String): DBIO[Boolean] = {
    gsvLinks.filter(x => x.gsvPanoramaId === panoramaId && x.targetGsvPanoramaId === targetPanoramaId).exists.result
  }

  def insert(link: GsvLink): DBIO[String] = {
    (gsvLinks returning gsvLinks.map(_.gsvPanoramaId)) += link
  }
}
