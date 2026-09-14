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

  def loginInfo =
    foreignKey("user_password_info_login_info_id_fkey", loginInfoId, TableQuery[LoginInfoTableDef])(_.loginInfoId)

  def loginInfoIdUnique = index("user_password_info_login_info_id_key", loginInfoId, unique = true)
}

@ImplementedBy(classOf[UserPasswordInfoTable])
trait UserPasswordInfoTableRepository {}

@Singleton
class UserPasswordInfoTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends UserPasswordInfoTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val userPasswordInfo = TableQuery[UserPasswordInfoTableDef]
  private val userLoginInfo    = TableQuery[UserLoginInfoTableDef]
  private val sidewalkUser     = TableQuery[SidewalkUserTableDef]

  /** The password behind an email, reached through the account so it's the row reset and change-password write. */
  def findByEmail(email: String): Future[Option[UserPasswordInfo]] = {
    val query = for {
      user     <- sidewalkUser if user.email === email.toLowerCase
      link     <- userLoginInfo if link.userId === user.userId
      password <- userPasswordInfo if password.loginInfoId === link.loginInfoId
    } yield password
    db.run(query.result.headOption)
  }

  def findByUserId(userId: String): Future[Option[UserPasswordInfo]] = {
    val query = for {
      link     <- userLoginInfo if link.userId === userId
      password <- userPasswordInfo if password.loginInfoId === link.loginInfoId
    } yield password
    db.run(query.result.headOption)
  }

  def insert(newUserPasswordInfo: UserPasswordInfo): DBIO[Int] = {
    (userPasswordInfo returning userPasswordInfo.map(_.userPasswordInfoId)) += newUserPasswordInfo
  }

  def updateByUserId(userId: String, pwInfo: PasswordInfo): DBIO[Int] = {
    val loginInfoIds = userLoginInfo.filter(_.userId === userId).map(_.loginInfoId)
    userPasswordInfo
      .filter(_.loginInfoId in loginInfoIds)
      .map(p => (p.hasher, p.password, p.salt))
      .update((pwInfo.hasher, pwInfo.password, pwInfo.salt))
  }
}
