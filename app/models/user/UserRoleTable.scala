package models.user

import com.google.inject.ImplementedBy
import models.user.UserRoleTable.roleToId
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class UserRole(userRoleId: Int, userId: String, roleId: Int, communityService: Boolean)

class UserRoleTableDef(tag: Tag) extends Table[UserRole](tag, "user_role") {
  def userRoleId: Rep[Int]           = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String]            = column[String]("user_id")
  def roleId: Rep[Int]               = column[Int]("role_id")
  def communityService: Rep[Boolean] = column[Boolean]("community_service")

  def * = (userRoleId, userId, roleId, communityService) <> ((UserRole.apply _).tupled, UserRole.unapply)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object UserRoleTable {
  val roleToId: Map[String, Int] = Map(
    "Registered"    -> 1,
    "Turker"        -> 2,
    "Researcher"    -> 3,
    "Administrator" -> 4,
    "Owner"         -> 5,
    "Anonymous"     -> 6
  )
  val roleIdToRole: Map[Int, String] = roleToId.map(_.swap)
}

@ImplementedBy(classOf[UserRoleTable])
trait UserRoleTableRepository {}

@Singleton
class UserRoleTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends UserRoleTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userRoles = TableQuery[UserRoleTableDef]
  val roles     = TableQuery[RoleTableDef]

  /**
   * Adds a new role for a user in the database.
   * @param userId The ID of the user to whom the role is being added
   * @param newRole The role to be added to the user
   * @param communityService Optional parameter to indicate if the user is doing community service, defaults to false
   * @return A DBIO action that returns the newly added UserRole
   */
  def addRole(userId: String, newRole: String, communityService: Boolean = false): DBIO[UserRole] = {
    (userRoles returning userRoles) += UserRole(0, userId, roleToId(newRole), communityService)
  }

  /**
   * Updates the role of a user in the database.
   * @param userId The ID of the user whose role is to be updated
   * @param newRole The new role to set for the user
   * @param communityService Optional parameter to indicate if the user is doing community service, defaults to false
   * @return A DBIO action that returns the number of rows affected
   */
  def updateRole(userId: String, newRole: String, communityService: Boolean = false): DBIO[Int] = {
    userRoles
      .filter(_.userId === userId)
      .map(r => (r.roleId, r.communityService))
      .update((roleToId(newRole), communityService))
  }

  /**
   * Updates the community service status of the user.
   * @param userId The ID of the user whose community service status is to be updated
   * @param newCommServ The new community service status to set
   * @return A DBIO action that returns the number of rows affected
   */
  def updateCommunityService(userId: String, newCommServ: Boolean): DBIO[Int] = {
    userRoles.filter(_.userId === userId).map(_.communityService).update(newCommServ)
  }
}
