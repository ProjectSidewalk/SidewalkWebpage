package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.silhouette.api.util.PasswordInfo

import javax.inject._
import scala.concurrent.Future

case class UserPasswordInfo(
    userPasswordInfoId: Int,
    hasher: String,
    password: String,
    salt: Option[String],
    loginInfoId: Long
)

class UserPasswordInfoTableDef(tag: Tag) extends Table[UserPasswordInfo](tag, "user_password_info") {
  def userPasswordInfoId: Rep[Int] = column[Int]("user_password_info_id", O.PrimaryKey, O.AutoInc)
  def hasher: Rep[String]          = column[String]("hasher")
  def password: Rep[String]        = column[String]("password")
  def salt: Rep[Option[String]]    = column[Option[String]]("salt")
  def loginInfoId: Rep[Long]       = column[Long]("login_info_id")
  def *                            =
    (userPasswordInfoId, hasher, password, salt, loginInfoId) <> (UserPasswordInfo.tupled, UserPasswordInfo.unapply)
}

@ImplementedBy(classOf[UserPasswordInfoTable])
trait UserPasswordInfoTableRepository {}

@Singleton
class UserPasswordInfoTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends UserPasswordInfoTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val userPasswordInfo = TableQuery[UserPasswordInfoTableDef]

  def find(loginInfoId: Long): Future[Option[UserPasswordInfo]] = {
    db.run(userPasswordInfo.filter(_.loginInfoId === loginInfoId).result.headOption)
  }

  def insert(newUserPasswordInfo: UserPasswordInfo): DBIO[Int] = {
    (userPasswordInfo returning userPasswordInfo.map(_.userPasswordInfoId)) += newUserPasswordInfo
  }

  def update(loginInfoId: Long, newUserPasswordInfo: PasswordInfo): DBIO[Int] = {
    userPasswordInfo
      .filter(_.loginInfoId === loginInfoId)
      .map(p => (p.hasher, p.password, p.salt))
      .update((newUserPasswordInfo.hasher, newUserPasswordInfo.password, newUserPasswordInfo.salt))
  }
}
