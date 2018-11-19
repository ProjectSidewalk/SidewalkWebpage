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
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val roles = TableQuery[RoleTable]

  def getRoleNames: Future[List[String]] = db.run(
    roles.map(_.role).to[List].result
  )

  def save(role: Role): Future[Int] = db.run(
    ((roles returning roles.map(_.roleId)) += role).transactionally
  )
}