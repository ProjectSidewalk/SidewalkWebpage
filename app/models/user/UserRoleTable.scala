package models.user

import com.google.inject.ImplementedBy
import models.user.UserRoleTable.roleToId
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.Configuration
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class UserRole(
    userRoleId: Int,
    userId: String,
    roleId: Int,
    communityService: Boolean,
    zurichInfra3dAccess: Boolean,
    winterthurInfra3dAccess: Boolean
)

class UserRoleTableDef(tag: Tag) extends Table[UserRole](tag, "user_role") {
  def userRoleId: Rep[Int]                  = column[Int]("user_role_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String]                   = column[String]("user_id")
  def roleId: Rep[Int]                      = column[Int]("role_id")
  def communityService: Rep[Boolean]        = column[Boolean]("community_service")
  def zurichInfra3dAccess: Rep[Boolean]     = column[Boolean]("zurich_infra3d_access")
  def winterthurInfra3dAccess: Rep[Boolean] = column[Boolean]("winterthur_infra3d_access")

  def * = (userRoleId, userId, roleId, communityService, zurichInfra3dAccess, winterthurInfra3dAccess) <>
    ((UserRole.apply _).tupled, UserRole.unapply)

  def user = foreignKey("user_role_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def role = foreignKey("user_role_role_id_fkey", roleId, TableQuery[RoleTableDef])(_.roleId)
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
class UserRoleTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider, config: Configuration)
    extends UserRoleTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val userRoles              = TableQuery[UserRoleTableDef]
  val roles                  = TableQuery[RoleTableDef]
  private val cityId: String = config.get[String]("city-id")

  /**
   * The <city>_infra3d_access column for the current city, or a literal false for cities without infra3D imagery.
   * @param row The user_role row to read the column from
   */
  def infra3dAccessForCurrentCity(row: UserRoleTableDef): Rep[Boolean] = cityId match {
    case "zurich-infra3d"     => row.zurichInfra3dAccess
    case "winterthur-infra3d" => row.winterthurInfra3dAccess
    case _                    => false.bind
  }

  /**
   * Adds a new role for a user in the database.
   * @param userId The ID of the user to whom the role is being added
   * @param newRole The role to be added to the user
   * @param communityService Optional parameter to indicate if the user is doing community service, defaults to false
   * @return A DBIO action that returns the newly added UserRole
   */
  def addRole(userId: String, newRole: String, communityService: Boolean = false): DBIO[UserRole] = {
    (userRoles returning userRoles) +=
      UserRole(0, userId, roleToId(newRole), communityService, zurichInfra3dAccess = false,
        winterthurInfra3dAccess = false)
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

  /**
   * Updates the infra3D imagery access flag for the city this deployment serves. No-op for non-infra3d cities.
   * @param userId The ID of the user whose access is to be updated
   * @param newAccess The new access status to set
   * @return A DBIO action that returns the number of rows affected (0 for non-infra3d cities)
   */
  def updateInfra3dAccess(userId: String, newAccess: Boolean): DBIO[Int] = {
    val rows = userRoles.filter(_.userId === userId)
    cityId match {
      case "zurich-infra3d"     => rows.map(_.zurichInfra3dAccess).update(newAccess)
      case "winterthur-infra3d" => rows.map(_.winterthurInfra3dAccess).update(newAccess)
      case _                    => DBIO.successful(0)
    }
  }
}
