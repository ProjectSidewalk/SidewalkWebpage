package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.Future

case class DBLoginInfo(id: Long, providerID: String, providerKey: String)

class LoginInfoTableDef(tag: Tag) extends Table[DBLoginInfo](tag, "login_info") {
  def loginInfoId: Rep[Long] = column[Long]("login_info_id", O.PrimaryKey, O.AutoInc)
  def providerId: Rep[String] = column[String]("provider_id")
  def providerKey: Rep[String] = column[String]("provider_key")
  def * = (loginInfoId, providerId, providerKey) <> (DBLoginInfo.tupled, DBLoginInfo.unapply)
}

@ImplementedBy(classOf[LoginInfoTable])
trait LoginInfoTableRepository { }

@Singleton
class LoginInfoTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)
  extends LoginInfoTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  val passwordInfo = TableQuery[LoginInfoTableDef]

  def find(email: String): Future[Option[Long]] = {
    db.run(passwordInfo.filter(_.providerKey === email).map(_.loginInfoId).result.headOption)
  }

  def insert(loginInfo: DBLoginInfo): DBIO[Long] = {
    (passwordInfo returning passwordInfo.map(_.loginInfoId)) += loginInfo
  }
}
