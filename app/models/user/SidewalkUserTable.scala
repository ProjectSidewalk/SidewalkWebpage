package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.silhouette.api.Identity

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

case class SidewalkUser(userId: String, username: String, email: String)
case class SidewalkUserWithRole(
    userId: String,
    username: String,
    email: String,
    role: String,
    communityService: Boolean
) extends Identity {
  require(RoleTable.VALID_ROLES.contains(role), s"Invalid role: $role")
}

class SidewalkUserTableDef(tag: Tag) extends Table[SidewalkUser](tag, "sidewalk_user") {
  def userId: Rep[String]   = column[String]("user_id", O.PrimaryKey)
  def username: Rep[String] = column[String]("username")
  def email: Rep[String]    = column[String]("email")
  def *                     = (userId, username, email) <> (SidewalkUser.tupled, SidewalkUser.unapply)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object SidewalkUserTable {
  val aiUserId: String = "51b0b927-3c8a-45b2-93de-bd878d1e5cf4"
}

@ImplementedBy(classOf[SidewalkUserTable])
trait SidewalkUserTableRepository {}

@Singleton
class SidewalkUserTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    ec: ExecutionContext
) extends SidewalkUserTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val sidewalkUser         = TableQuery[SidewalkUserTableDef]
  val userRole             = TableQuery[UserRoleTableDef]
  val roles                = TableQuery[RoleTableDef]
  val sidewalkUserWithRole = sidewalkUser
    .join(userRole)
    .on(_.userId === _.userId)
    .join(roles)
    .on(_._2.roleId === _.roleId)
    .map { case ((user, userRole), role) =>
      (user.userId, user.username, user.email, role.role, userRole.communityService)
    }

  def findByUserId(userId: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._1 === userId).result.headOption).map(_.map(SidewalkUserWithRole.tupled))
  }

  def findByUsername(username: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._2 === username).result.headOption).map(_.map(SidewalkUserWithRole.tupled))
  }

  def findByEmail(email: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._3 === email).result.headOption).map(_.map(SidewalkUserWithRole.tupled))
  }

  /**
   * Updates the username of a user.
   * @param userId The user ID of the user whose username is to be updated
   * @param newUsername The new username to set for the user
   * @return A DBIO action that returns the number of rows updated
   */
  def updateUsername(userId: String, newUsername: String): DBIO[Int] = {
    sidewalkUser.filter(_.userId === userId).map(_.username).update(newUsername)
  }

  /**
   * Updates the email of a user. NOTE: MUST be accompanied by updating login_info, handled by AuthenticationService.
   * @param userId The user ID of the user whose email is to be updated
   * @param newEmail The new email address to set for the user
   * @return A DBIO action that returns the number of rows updated
   */
  def updateEmail(userId: String, newEmail: String): DBIO[Int] = {
    sidewalkUser.filter(_.userId === userId).map(_.email).update(newEmail)
  }

  def insert(newUser: SidewalkUser): DBIO[String] = {
    (sidewalkUser returning sidewalkUser.map(_.userId)) += newUser
  }
}
