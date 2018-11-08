package models.user

import models.daos.slickdaos.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver.api._
import play.api.Play.current
import java.util.UUID

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global

import scala.util.control.NonFatal

case class UserRole(userRoleId: Int, userId: String, roleId: Int)

class UserRoleTable(tag: Tag) extends Table[UserRole](tag, Some("sidewalk"), "user_role") {
  def userRoleId = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id")
  def roleId = column[Int]("role_id")


  def * = (userRoleId, userId, roleId) <> ((UserRole.apply _).tupled, UserRole.unapply)
}

object UserRoleTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val userRoles = TableQuery[UserRoleTable]
  val roles = TableQuery[RoleTable]
  val userTable = TableQuery[UserTable]

  def roleMapping: Future[Map[String, Int]] = db.run(roles.result).map {
    rolesList => rolesList.map(r => r.role -> r.roleId).toMap
  }


  /**
    * Gets the users role. If no role is found, the role of "Registered" is assigned and returned.
    *
    * @param userId
    * @return
    */
  def getRole(userId: UUID): Future[String] = {
    val _rolesQuery = for {
      (_userRoles, _roles) <- userRoles.join(roles).on(_.roleId === _.roleId) if _userRoles.userId === userId.toString
    } yield _roles
    db.run(_rolesQuery.result) map { _roles =>
      try {
        _roles.map(_.role).head
      } catch {
        // no role found, give them Registered role
        case NonFatal(t) =>
          setRole(userId, "Registered")
          "Registered"
      }
    }
  }

  def setRole(userId: UUID, newRole: String): Future[Int] = {
    for {
      newRoleId <- roleMapping(newRole)
      rowsUpdated <- setRole(userId, newRoleId)
    } yield rowsUpdated
  }

  def setRole(userId: UUID, newRole: Int): Future[Int] = {
    db.run(userRoles.filter(_.userId === userId.toString).map(_.userRoleId).result.headOption) flatMap { userRoleId =>
      userRoles.insertOrUpdate(UserRole(userRoleId.getOrElse(0), userId.toString, newRole))
    }
  }

  def isResearcher(userId: UUID): Future[Boolean] = {
    getRole(userId) map { _role => List("Researcher", "Administrator", "Owner").contains(_role) }
  }

  def getUsersByType(userType: String): Query[UserTable, DBUser, Seq] = {
    for {
      _roleIds <- userRoles
      _roles <- roles if _roles.roleId === _roleIds.roleId && _roles.role === userType
      _users <- userTable if _users.userId === _roleIds.userId
    } yield _users
  }
}