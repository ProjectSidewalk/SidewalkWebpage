package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile

import java.util.UUID
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class UserOrg(userOrgId: Int, userId: String, orgId: Int)

class UserOrgTableDef(tag: slick.lifted.Tag) extends Table[UserOrg](tag, "user_org") {
  def userOrgId: Rep[Int] = column[Int]("user_org_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def orgId: Rep[Int] = column[Int]("org_id")

  def * = (userOrgId, userId, orgId) <> ((UserOrg.apply _).tupled, UserOrg.unapply)
}

@ImplementedBy(classOf[UserOrgTable])
trait UserOrgTableRepository {
}

@Singleton
class UserOrgTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserOrgTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val userOrgs = TableQuery[UserOrgTableDef]

  /**
   * Gets the organization the given user is affiliated with.
   *
   * @param userId The id of the user.
   * @return The organization the given user is affiliated with.
   */
//  def getOrg(userId: UUID): Option[Int] = {
//    userOrgs.filter(_.userId === userId.toString).map(_.orgId).firstOption
//  }
//
//  /**
//   * Gets all users affiliated with the given organization.
//   *
//   * @param orgId The id of the org.
//   * @return A list of all users affiliated with the given organization.
//   */
//  def getAllUsers(orgId: Int): List[String] = {
//    userOrgs.filter(_.orgId === orgId).map(_.userId).list
//  }
//
//  /**
//   * Saves a new user-org affiliation if and only if the given orgId is valid.
//   *
//   * @param userId The id of the user.
//   * @param orgId The id of the org.
//   * @return The id of the new user-org affiliation.
//   *         However, if the given orgId is invalid, then it returns 0.
//   */
//  def insert(userId: UUID, orgId: Int): Int = {
//    if (OrganizationTable.containsId(orgId)) {
//      userOrgs.insertOrUpdate(UserOrg(0, userId.toString, orgId))
//    } else {
//      -1
//    }
//  }
//
//  /**
//   * Removes a user-org affiliation.
//   *
//   * @param userId The id of the user.
//   * @param orgId The id of the org.
//   * @return The id of the removed user-org affiliation.
//   */
//  def remove(userId: UUID, orgId: Int): Int = {
//    userOrgs.filter(r => r.userId === userId.toString && r.orgId === orgId).delete
//  }
}
