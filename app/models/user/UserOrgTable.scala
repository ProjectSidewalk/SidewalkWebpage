package models.user

import java.util.UUID
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class UserOrg(userOrgId: Int, userId: String, orgId: Int)

class UserOrgTable(tag: slick.lifted.Tag) extends Table[UserOrg](tag, "user_org") {
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
   * Gets all organizations the given user is affiliated with.
   *
   * @param userId The id of the user.
   * @return A list of all organizations the given user is affiliated with.
   */
  def getAllOrgs(userId: UUID): List[Int] = db.withSession { implicit session =>
    userOrgs.filter(_.userId === userId.toString).map(_.orgId).list
  }

  /**
   * Gets all users affiliated with the given organization.
   *
   * @param orgId The id of the org.
   * @return A list of all users affiliated with the given organization.
   */
  def getAllUsers(orgId: Int): List[String] = db.withSession { implicit session =>
    userOrgs.filter(_.orgId === orgId).map(_.userId).list
  }
  
  /**
   * Saves a new user-org affiliation if and only if the given orgId is valid.
   *
   * @param userId The id of the user.
   * @param orgId The id of the org.
   * @return The id of the new user-org affiliation. 
   *         However, if the given orgId is invalid, then it returns 0.
   */
  def save(userId: UUID, orgId: Int): Int = db.withSession { implicit session =>
    if (OrganizationTable.containsId(orgId)) {
      userOrgs.insertOrUpdate(UserOrg(0, userId.toString, orgId))
    } else {
      -1
    }
  }

  /**
   * Removes a user-org affiliation.
   *
   * @param userId The id of the user.
   * @param orgId The id of the org.
   * @return The id of the removed user-org affiliation.
   */
  def remove(userId: UUID, orgId: Int): Int = db.withSession { implicit session =>
    userOrgs.filter(r => r.userId === userId.toString && r.orgId === orgId).delete
  }
}
