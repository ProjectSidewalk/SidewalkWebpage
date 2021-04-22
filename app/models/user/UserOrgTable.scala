package models.user

import java.util.UUID
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class UserOrg(userOrgId: Int, userId: String, orgId: Int)

class UserOrgTable(tag: slick.lifted.Tag) extends Table[UserOrg](tag, Some("sidewalk"), "user_org") {
  def userOrgId = column[Int]("user_org_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def orgId = column[Int]("org_id", O.NotNull)

  def * = (userOrgId, userId, orgId) <> ((UserOrg.apply _).tupled, UserOrg.unapply)
}

/**
 * Data access object for the user_org table.
 */
object UserOrgTable {
  val db = play.api.db.slick.DB
  val userOrgs = TableQuery[UserOrgTable]

  /**
  * Get all organizations the given user is affiliated with.
  */
  def getAllUserOrgs(userId: UUID): List[Int] = db.withSession { implicit session =>
    userOrgs.filter(_.userId === userId.toString).map(_.orgId).list
  }

  /**
  * Get all users affiliated with the given organization.
  */
  def getAllUsers(orgId: Int): List[String] = db.withSession { implicit session =>
    userOrgs.filter(_.orgId === orgId).map(_.userId).list
  }
  
  /**
    * Inserts a user organization affiliation into the user_org table.
    */
  def save(userId: UUID, orgId: Int): Int = db.withSession { implicit session =>
    userOrgs.insertOrUpdate(UserOrg(0, userId.toString, orgId))
  }

  /**
    * Removes a user organization affiliation from the user_org table.
    */
  def remove(userId: UUID, orgId: Int): Int = db.withSession { implicit session =>
    userOrgs.filter(r => r.userId === userId.toString && r.orgId === orgId).delete
  }
}
