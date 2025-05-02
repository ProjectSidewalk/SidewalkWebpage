package models.gallery

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class GalleryTaskEnvironment(galleryTaskEnvironmentId: Int, browser: Option[String],
                                browserVersion: Option[String], browserWidth: Option[Int], browserHeight: Option[Int],
                                availWidth: Option[Int], availHeight: Option[Int], screenWidth: Option[Int],
                                screenHeight: Option[Int], operatingSystem: Option[String], ipAddress: Option[String],
                                language: String, userId: Option[String])

class GalleryTaskEnvironmentTableDef(tag: Tag) extends Table[GalleryTaskEnvironment](tag, "gallery_task_environment") {
  def galleryTaskEnvironmentId: Rep[Int] = column[Int]("gallery_task_environment_id", O.PrimaryKey, O.AutoInc)
  def browser: Rep[Option[String]] = column[Option[String]]("browser")
  def browserVersion: Rep[Option[String]] = column[Option[String]]("browser_version")
  def browserWidth: Rep[Option[Int]] = column[Option[Int]]("browser_width")
  def browserHeight: Rep[Option[Int]] = column[Option[Int]]("browser_height")
  def availWidth: Rep[Option[Int]] = column[Option[Int]]("avail_width")
  def availHeight: Rep[Option[Int]] = column[Option[Int]]("avail_height")
  def screenWidth: Rep[Option[Int]] = column[Option[Int]]("screen_width")
  def screenHeight: Rep[Option[Int]] = column[Option[Int]]("screen_height")
  def operatingSystem: Rep[Option[String]] = column[Option[String]]("operating_system")
  def ipAddress: Rep[Option[String]] = column[Option[String]]("ip_address")
  def language: Rep[String] = column[String]("language")
  def userId: Rep[Option[String]] = column[Option[String]]("user_id")

  def * = (galleryTaskEnvironmentId, browser, browserVersion, browserWidth, browserHeight, availWidth,
    availHeight, screenWidth, screenHeight, operatingSystem, ipAddress, language, userId) <> ((GalleryTaskEnvironment.apply _).tupled, GalleryTaskEnvironment.unapply)

//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("gallery_task_environment_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
}

@ImplementedBy(classOf[GalleryTaskEnvironmentTable])
trait GalleryTaskEnvironmentTableRepository { }

@Singleton
class GalleryTaskEnvironmentTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends GalleryTaskEnvironmentTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  val galleryTaskEnvironments = TableQuery[GalleryTaskEnvironmentTableDef]

  def insert(env: GalleryTaskEnvironment): DBIO[Int] = {
    (galleryTaskEnvironments returning galleryTaskEnvironments.map(_.galleryTaskEnvironmentId)) += env
  }
}
