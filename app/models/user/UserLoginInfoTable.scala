package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._

case class UserLoginInfo(userLoginInfoId: Int, userId: String, loginInfoId: Long)

class UserLoginInfoTableDef(tag: Tag) extends Table[UserLoginInfo](tag, "user_login_info") {
  def userLoginInfoId: Rep[Int] = column[Int]("user_login_info_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def loginInfoId: Rep[Long] = column[Long]("login_info_id")
  def * = (userLoginInfoId, userId, loginInfoId) <> (UserLoginInfo.tupled, UserLoginInfo.unapply)
}

@ImplementedBy(classOf[UserLoginInfoTable])
trait UserLoginInfoTableRepository { }

@Singleton
class UserLoginInfoTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends UserLoginInfoTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userLoginInfo = TableQuery[UserLoginInfoTableDef]

  def find(userId: String): DBIO[Option[UserLoginInfo]] = {
    userLoginInfo.filter(_.userId === userId).result.headOption
  }

  def insert(newUserLoginInfo: UserLoginInfo): DBIO[Int] = {
    (userLoginInfo returning userLoginInfo.map(_.userLoginInfoId)) += newUserLoginInfo
  }
}
