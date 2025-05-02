package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class UserRole(userRoleId: Int, userId: String, roleId: Int, communityService: Boolean)

class UserRoleTableDef(tag: Tag) extends Table[UserRole](tag, "user_role") {
  def userRoleId: Rep[Int] = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def roleId: Rep[Int] = column[Int]("role_id")
  def communityService: Rep[Boolean] = column[Boolean]("community_service")

  def * = (userRoleId, userId, roleId, communityService) <> ((UserRole.apply _).tupled, UserRole.unapply)
}

@ImplementedBy(classOf[UserRoleTable])
trait UserRoleTableRepository { }

@Singleton
class UserRoleTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends UserRoleTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userRoles = TableQuery[UserRoleTableDef]
  val roles = TableQuery[RoleTableDef]

  def roleMapping: DBIO[Map[String, Int]] = {
    roles.result.map { roles => roles.map(r => r.role -> r.roleId).toMap }
  }

  def setRole(userId: String, newRole: String, communityService: Option[Boolean] = None): DBIO[Option[UserRole]] = {
    roleMapping.flatMap { roleMap => setRole(userId, roleMap(newRole), communityService) }
  }

  def setRole(userId: String, newRole: Int, communityService: Option[Boolean]): DBIO[Option[UserRole]] = {
    for {
      currRole: Option[UserRole] <- userRoles.filter(_.userId === userId).result.headOption
      commServ: Boolean = communityService.getOrElse(currRole.map(_.communityService).getOrElse(false))
      result <- (userRoles returning userRoles).insertOrUpdate(
        UserRole(currRole.map(_.userRoleId).getOrElse(0), userId, newRole, commServ)
      )
    } yield result
  }

 /**
  * Sets the community service status of the user.
  */
  def setCommunityService(userId: String, newCommServ: Boolean): DBIO[Int] = {
    userRoles.filter(_.userId === userId).map(_.communityService).update(newCommServ)
  }
}
