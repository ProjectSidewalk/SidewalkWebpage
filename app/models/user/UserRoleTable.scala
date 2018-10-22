package models.user

import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.api._
import play.api.Play.current
import java.util.UUID

import scala.util.control.NonFatal

case class UserRole(userRoleId: Int, userId: String, roleId: Int)

class UserRoleTable(tag: Tag) extends Table[UserRole](tag, Some("sidewalk"), "user_role") {
  def userRoleId = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id")
  def roleId = column[Int]("role_id")


  def * = (userRoleId, userId, roleId) <> ((UserRole.apply _).tupled, UserRole.unapply)
}

object UserRoleTable {
  val db = play.api.db.slick.DB
  val userRoles = TableQuery[UserRoleTable]
  val roles = TableQuery[RoleTable]
  val userTable = TableQuery[UserTable]

  def roleMapping: Map[String, Int] = db.withSession {
    implicit session => roles.list.map(r => r.role -> r.roleId).toMap
  }


  /**
    * Gets the users role. If no role is found, the role of "Registered" is assigned and returned.
    *
    * @param userId
    * @return
    */
  def getRole(userId: UUID): String = db.withSession { implicit session =>
    val _roles = for {
      (_userRoles, _roles) <- userRoles.innerJoin(roles).on(_.roleId === _.roleId) if _userRoles.userId === userId.toString
    } yield _roles
    try {
      _roles.list.map(_.role).head
    } catch {
      // no role found, give them Registered role
      case NonFatal(t) =>
        setRole(userId, "Registered")
        "Registered"
    }
  }

  def setRole(userId: UUID, newRole: String): Int = db.withTransaction { implicit session =>
    setRole(userId, roleMapping(newRole))
  }

  def setRole(userId: UUID, newRole: Int): Int = db.withTransaction { implicit session =>
    val userRoleId: Option[Int] = userRoles.filter(_.userId === userId.toString).map(_.userRoleId).list.headOption
    userRoles.insertOrUpdate(UserRole(userRoleId.getOrElse(0), userId.toString, newRole))
  }

  def isResearcher(userId: UUID): Boolean = db.withSession { implicit session =>
    List("Researcher", "Administrator", "Owner").contains(getRole(userId))
  }

  def getUsersByType(userType: String): Query[UserTable, DBUser, Seq] = {
    val turkerUsers = for {
      _roleIds <- userRoles
      _roles <- roles if _roles.roleId === _roleIds.roleId && _roles.role === userType
      _users <- userTable if _users.userId === _roleIds.userId
    } yield _users
    turkerUsers
  }
}