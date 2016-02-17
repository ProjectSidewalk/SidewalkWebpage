package models.user

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class Role(roleId: Int, role: String)

class RoleTable(tag: Tag) extends Table[Role](tag, Some("sidewalk"), "role") {
  def roleId = column[Int]("role_id", O.PrimaryKey, O.AutoInc)
  def role = column[String]("role", O.NotNull)

  def * = (roleId, role) <> ((Role.apply _).tupled, Role.unapply)
}

object RoleTable {
  val db = play.api.db.slick.DB
  val roles = TableQuery[RoleTable]

  def save(role: Role): Int = db.withTransaction { implicit session =>
    val roleId: Int =
      (roles returning roles.map(_.roleId)) += role
    roleId
  }
}