package models.user

import models.utils.MyPostgresDriver.simple._
import play.api.Play
import play.api.Play.current
import java.util.UUID
import scala.util.control.NonFatal

case class UserRole(userRoleId: Int, userId: String, roleId: Int, communityService: Boolean)

class UserRoleTable(tag: Tag) extends Table[UserRole](tag, Play.configuration.getString("db-schema"), "user_role") {
  def userRoleId = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def roleId = column[Int]("role_id", O.NotNull)
  def communityService = column[Boolean]("community_service", O.NotNull)

  def * = (userRoleId, userId, roleId, communityService) <> ((UserRole.apply _).tupled, UserRole.unapply)
}

object UserRoleTable {
  val db = play.api.db.slick.DB
  val userRoles = TableQuery[UserRoleTable]
  val roles = TableQuery[RoleTable]

  def roleMapping: Map[String, Int] = db.withSession {
    implicit session => roles.list.map(r => r.role -> r.roleId).toMap
  }

  /**
    * Gets the users role. If no role is found, the role of "Registered" is assigned and returned.
    */
  def getRole(userId: UUID): String = db.withSession { implicit session =>
    val _roles = for {
      (_userRoles, _roles) <- userRoles.innerJoin(roles).on(_.roleId === _.roleId) if _userRoles.userId === userId.toString
    } yield _roles
    try {
      _roles.list.map(_.role).head
    } catch {
      // No role found, give them Registered role.
      case NonFatal(t) =>
        setRole(userId, "Registered", communityService = Some(false))
        "Registered"
    }
  }

  def setRole(userId: UUID, newRole: String, communityService: Option[Boolean]): Int = db.withTransaction { implicit session =>
    setRole(userId, roleMapping(newRole), communityService)
  }

  def setRole(userId: UUID, newRole: Int, communityService: Option[Boolean]): Int = db.withTransaction { implicit session =>
    val currRole: Option[UserRole] = userRoles.filter(_.userId === userId.toString).firstOption
    val commServ: Boolean = communityService.getOrElse(currRole.map(_.communityService).getOrElse(false))
    userRoles.insertOrUpdate(UserRole(currRole.map(_.userRoleId).getOrElse(0), userId.toString, newRole, commServ))
  }
}
