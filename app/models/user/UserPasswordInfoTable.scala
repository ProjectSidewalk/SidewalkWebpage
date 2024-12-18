package models.user

import models.utils.MyPostgresDriver
import play.api.db.slick.DatabaseConfigProvider

import javax.inject._
import play.api.db.slick.HasDatabaseConfigProvider
import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver.api._

import scala.concurrent.Future

case class UserPasswordInfo(userPasswordInfoId: Int, hasher: String, password: String, salt: Option[String], loginInfoId: Long)

class UserPasswordInfoTableDef(tag: Tag) extends Table[UserPasswordInfo](tag, Some("sidewalk_login"), "user_password_info") {
  def userPasswordInfoId: Rep[Int] = column[Int]("user_password_info_id", O.PrimaryKey, O.AutoInc)
  def hasher: Rep[String] = column[String]("hasher")
  def password: Rep[String] = column[String]("password")
  def salt: Rep[Option[String]] = column[Option[String]]("salt")
  def loginInfoId: Rep[Long] = column[Long]("login_info_id")
  def * = (userPasswordInfoId, hasher, password, salt, loginInfoId) <> (UserPasswordInfo.tupled, UserPasswordInfo.unapply)
}

@ImplementedBy(classOf[UserPasswordInfoTable])
trait UserPasswordInfoTableRepository {
  def find(loginInfoId: Long): Future[Option[UserPasswordInfo]]
  def insert(userPasswordInfo: UserPasswordInfo): DBIO[Int]
}

@Singleton
class UserPasswordInfoTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserPasswordInfoTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._

  val userPasswordInfo = TableQuery[UserPasswordInfoTableDef]

  def find(loginInfoId: Long): Future[Option[UserPasswordInfo]] = {
    db.run(userPasswordInfo.filter(_.loginInfoId === loginInfoId).result.headOption)
  }

  def insert(newUserPasswordInfo: UserPasswordInfo): DBIO[Int] = {
    (userPasswordInfo returning userPasswordInfo.map(_.userPasswordInfoId)) += newUserPasswordInfo
  }
}
