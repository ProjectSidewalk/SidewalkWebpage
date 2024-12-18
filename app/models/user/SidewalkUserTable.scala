package models.user

import models.utils.MyPostgresDriver
import play.api.db.slick.DatabaseConfigProvider

import javax.inject._
import play.api.db.slick.HasDatabaseConfigProvider
import com.google.inject.ImplementedBy
import com.mohiva.play.silhouette.api.Identity
import models.utils.MyPostgresDriver.api._

import play.api.libs.concurrent.Execution.Implicits.defaultContext
import scala.concurrent.Future

case class SidewalkUser(userId: String, username: String, email: String)
case class SidewalkUserWithRole(userId: String, username: String, email: String, role: String, communityService: Boolean) extends Identity {
  require(List("Registered", "Turker", "Researcher", "Administrator", "Owner", "Anonymous").contains(role), s"Invalid role: $role")
}

class SidewalkUserTableDef(tag: Tag) extends Table[SidewalkUser](tag, Some("sidewalk_login"), "sidewalk_user") {
  def userId: Rep[String] = column[String]("user_id", O.PrimaryKey)
  def username: Rep[String] = column[String]("username")
  def email: Rep[String] = column[String]("email")
  def * = (userId, username, email) <> (SidewalkUser.tupled, SidewalkUser.unapply)
}

@ImplementedBy(classOf[SidewalkUserTable])
trait SidewalkUserTableRepository {
  def findByUserId(userId: String): Future[Option[SidewalkUserWithRole]]
  def findByUsername(username: String): Future[Option[SidewalkUserWithRole]]
  def findByEmail(email: String): Future[Option[SidewalkUserWithRole]]
  def insert(sidewalkUser: SidewalkUser): DBIO[String]
}

@Singleton
class SidewalkUserTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends SidewalkUserTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._

  val sidewalkUser = TableQuery[SidewalkUserTableDef]
  val userRole = TableQuery[UserRoleTableDef]
  val roles = TableQuery[RoleTableDef]
  val sidewalkUserWithRole = sidewalkUser
    .join(userRole).on(_.userId === _.userId)
    .join(roles).on(_._2.roleId === _.roleId)
    .map { case ((user, userRole), role) => (user.userId, user.username, user.email, role.role, userRole.communityService) }

  def findByUserId(userId: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._1 === userId).result.headOption).map(_.map(SidewalkUserWithRole.tupled))
  }

  def findByUsername(username: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._2 === username).result.headOption).map(_.map(SidewalkUserWithRole.tupled))
  }

  def findByEmail(email: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._3 === email).result.headOption).map(_.map(SidewalkUserWithRole.tupled))
  }

  def insert(newUser: SidewalkUser): DBIO[String] = {
    (sidewalkUser returning sidewalkUser.map(_.userId)) += newUser
  }
}
