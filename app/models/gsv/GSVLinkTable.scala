package models.gsv

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class GSVLink(gsvPanoramaId: String, targetGsvPanoramaId: String, yawDeg: Double, description: String)

class GSVLinkTableDef(tag: Tag) extends Table[GSVLink](tag, "gsv_link") {
  def gsvPanoramaId: Rep[String] = column[String]("gsv_panorama_id", O.PrimaryKey)
  def targetGsvPanoramaId: Rep[String] = column[String]("target_panorama_id")
  def yawDeg: Rep[Double] = column[Double]("yaw_deg")
  def description: Rep[String] = column[String]("description")

  def * = (gsvPanoramaId, targetGsvPanoramaId, yawDeg, description) <> ((GSVLink.apply _).tupled, GSVLink.unapply)
}

@ImplementedBy(classOf[GSVLinkTable])
trait GSVLinkTableRepository {
  def insert(link: GSVLink): DBIO[String]
}

@Singleton
class GSVLinkTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends GSVLinkTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val gsvLinks = TableQuery[GSVLinkTableDef]

  /**
    * This method checks if the link already exists or not.
    *
    * @param panoramaId Google Street View panorama id
    */
//  def linkExists(panoramaId: String, targetPanoramaId: String): Boolean = {
//    gsvLinks.filter(x => x.gsvPanoramaId === panoramaId && x.targetGsvPanoramaId === targetPanoramaId).list.nonEmpty
//  }

  def insert(link: GSVLink): DBIO[String] = {
    (gsvLinks returning gsvLinks.map(_.gsvPanoramaId)) += link
  }
}
