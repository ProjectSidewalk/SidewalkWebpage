package models.user

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.util.UUID

case class UserRole(userRoleId: Int, userId: String, roleId: Int)

class UserRoleTable(tag: Tag) extends Table[UserRole](tag, Some("sidewalk"), "user_role") {
  def userRoleId = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def roleId = column[Int]("role_id", O.NotNull)


  def * = (userRoleId, userId, roleId) <> ((UserRole.apply _).tupled, UserRole.unapply)
}

object UserRoleTable {
  val db = play.api.db.slick.DB
  val userRoles = TableQuery[UserRoleTable]
  val roles = TableQuery[RoleTable]

  val roleMapping = Map("User" -> 1, "Administrator" -> 2)


  def addUserRole(userId: UUID): Int = db.withTransaction { implicit session =>
    val userRole = UserRole(0, userId.toString, roleMapping("User"))
    val userRoleId: Int =
      (userRoles returning userRoles.map(_.userRoleId)) += userRole
    userRoleId
  }

  def getRoles(userId: UUID): Seq[String] = db.withSession { implicit session =>
    val _roles = for {
      (_userRoles, _roles) <- userRoles.innerJoin(roles).on(_.roleId === _.roleId) if _userRoles.userId === userId.toString
    } yield _roles
    _roles.list.map(_.role)
  }

}