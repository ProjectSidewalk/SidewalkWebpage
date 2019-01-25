package models.user

import models.daos.slickdaos.DBTableDefinitions.{ DBUser, UserTable }
import models.utils.MyPostgresDriver.api._
import java.util.UUID

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

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

  def roleMapping: Future[Map[String, Int]] = db.run(
    roles.map(r => (r.role, r.roleId)).result).map(_.toMap)

  /**
   * Gets the users role. If no role is found, the role of "Registered" is assigned and returned.
   *
   * @param userId
   * @return
   */
  def getRole(userId: UUID): Future[String] = {
    db.run(
      (for {
        (_userRoles, _roles) <- userRoles.join(roles).on(_.roleId === _.roleId) if _userRoles.userId === userId.toString
      } yield _roles.role).result.headOption).flatMap {
        case Some(role) => Future.successful(role)
        case None => setRole(userId, "Registered")
          .map(_ => "Registered")
      }
  }

  def setRole(userId: UUID, newRole: String): Future[Int] = {
    roleMapping.flatMap { roleToIds =>
      setRole(userId, roleToIds(newRole))
    }
  }

  def setRole(userId: UUID, newRole: Int): Future[Int] = {
    db.run(
      userRoles.filter(_.userId === userId.toString).map(_.userRoleId).result.headOption).flatMap { userRoleId =>
        db.run(
          userRoles.insertOrUpdate(UserRole(userRoleId.getOrElse(0), userId.toString, newRole)).transactionally)
      }
  }

  def isResearcher(userId: UUID): Future[Boolean] = {
    getRole(userId).map(List("Researcher", "Administrator", "Owner").contains)
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