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

  def insertOrUpdate(newUser: SidewalkUser): DBIO[String] = {
    (sidewalkUser returning sidewalkUser.map(_.userId)).insertOrUpdate(newUser).map(_.getOrElse(newUser.userId))
  }
}
