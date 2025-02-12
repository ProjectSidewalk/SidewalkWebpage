package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.Future

case class Role(roleId: Int, role: String)

class RoleTableDef(tag: Tag) extends Table[Role](tag, Some("sidewalk_login"), "role") {
  def roleId: Rep[Int] = column[Int]("role_id", O.PrimaryKey, O.AutoInc)
  def role: Rep[String] = column[String]("role")

  def * = (roleId, role) <> ((Role.apply _).tupled, Role.unapply)
}

@ImplementedBy(classOf[RoleTable])
trait RoleTableRepository {
  def getRoles: DBIO[Seq[Role]]
}

@Singleton
class RoleTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends RoleTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val roles = TableQuery[RoleTableDef]

  def getRoles: DBIO[Seq[Role]] = roles.result

//  def getRoleNames: List[String] = {
//    roles.map(_.role).list
//  }
}
