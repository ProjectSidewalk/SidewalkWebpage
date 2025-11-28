package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import javax.inject.{Inject, Singleton}

case class Role(roleId: Int, role: String)

class RoleTableDef(tag: Tag) extends Table[Role](tag, "role") {
  def roleId: Rep[Int]  = column[Int]("role_id", O.PrimaryKey, O.AutoInc)
  def role: Rep[String] = column[String]("role")

  def * = (roleId, role) <> ((Role.apply _).tupled, Role.unapply)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object RoleTable {
  val SCISTARTER_ROLES: Seq[String] = Seq("Registered", "Researcher", "Administrator", "Owner")
  val RESEARCHER_ROLES: Seq[String] = Seq("Researcher", "Administrator", "Owner")
  val ADMIN_ROLES: Seq[String]      = Seq("Administrator", "Owner")
  val VALID_ROLES: Seq[String] = Seq("Registered", "Turker", "Researcher", "Administrator", "Owner", "Anonymous", "AI")
  val ROLES_RESEARCHER_COLLAPSED: Seq[String] = Seq("Registered", "Turker", "Researcher", "Anonymous", "AI")
}

@ImplementedBy(classOf[RoleTable])
trait RoleTableRepository {}

@Singleton
class RoleTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends RoleTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val roles = TableQuery[RoleTableDef]

  def getRoles: DBIO[Seq[Role]] = roles.result
}
