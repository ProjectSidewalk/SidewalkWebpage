package models.user

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class Role(roleId: Int, role: String)

class RoleTable(tag: Tag) extends Table[Role](tag, Some("sidewalk"), "role") {
  def roleId = column[Int]("role_id", O.PrimaryKey, O.AutoInc)
  def role = column[String]("role")

  def * = (roleId, role) <> ((Role.apply _).tupled, Role.unapply)
}

object RoleTable {
  val db = play.api.db.slick.DB
  val roles = TableQuery[RoleTable]

  def getRoleNames: List[String] = db.withTransaction { implicit session =>
    roles.map(_.role).list
  }

  def save(role: Role): Int = db.withTransaction { implicit session =>
    val roleId: Int =
      (roles returning roles.map(_.roleId)) += role
    roleId
  }
}