package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import java.util.UUID
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

case class UserRole(userRoleId: Int, userId: String, roleId: Int, communityService: Boolean)

class UserRoleTableDef(tag: Tag) extends Table[UserRole](tag, Some("sidewalk_login"), "user_role") {
  def userRoleId: Rep[Int] = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def roleId: Rep[Int] = column[Int]("role_id")
  def communityService: Rep[Boolean] = column[Boolean]("community_service")

  def * = (userRoleId, userId, roleId, communityService) <> ((UserRole.apply _).tupled, UserRole.unapply)
}

@ImplementedBy(classOf[UserRoleTable])
trait UserRoleTableRepository {
  def setRole(userId: String, newRole: String, communityService: Option[Boolean]): DBIO[Option[UserRole]]
}

@Singleton
class UserRoleTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider)(implicit ec: ExecutionContext)
  extends UserRoleTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  val userRoles = TableQuery[UserRoleTableDef]
  val roles = TableQuery[RoleTableDef]

  def roleMapping: DBIO[Map[String, Int]] = {
    roles.result.map { roles =>
      roles.map(r => r.role -> r.roleId).toMap
    }
  }
//
//  /**
//    * Gets the users role. If no role is found, the role of "Registered" is assigned and returned.
//    */
//  def getRole(userId: UUID): String = {
//    val _roles = for {
//      (_userRoles, _roles) <- userRoles.innerJoin(roles).on(_.roleId === _.roleId) if _userRoles.userId === userId.toString
//    } yield _roles
//    try {
//      _roles.list.map(_.role).head
//    } catch {
//      // No role found, give them Registered role.
//      case NonFatal(t) =>
//        setRole(userId, "Registered", communityService = Some(false))
//        "Registered"
//    }
//  }

  def setRole(userId: String, newRole: String, communityService: Option[Boolean]): DBIO[Option[UserRole]] = {
    roleMapping.flatMap { roleMap => setRole(userId, roleMap(newRole), communityService) }
  }

  def setRole(userId: String, newRole: Int, communityService: Option[Boolean]): DBIO[Option[UserRole]] = {
    for {
      currRole <- userRoles.filter(_.userId === userId).result.headOption // TODO should we rewrite getRole and use that instead?
      commServ: Boolean = communityService.getOrElse(currRole.map(_.communityService).getOrElse(false))
      result <- (userRoles returning userRoles).insertOrUpdate(
        UserRole(currRole.map(_.userRoleId).getOrElse(0), userId, newRole, commServ)
      )
    } yield {
      result
    }
  }

//   /**
//    * Sets the community service status of the user.
//    */
//  def setCommunityService(userId: UUID, newCommServ: Boolean): Int = {
//    userRoles.filter(_.userId === userId.toString).map(_.communityService).update(newCommServ)
//  }
}
