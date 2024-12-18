package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}

case class Organization(orgId: Int, orgName: String, orgDescription: String)

class OrganizationTableDef(tag: slick.lifted.Tag) extends Table[Organization](tag, "organization") {
  def orgId: Rep[Int] = column[Int]("org_id", O.PrimaryKey, O.AutoInc)
  def orgName: Rep[String] = column[String]("org_name")
  def orgDescription: Rep[String] = column[String]("org_description")

  def * = (orgId, orgName, orgDescription) <> ((Organization.apply _).tupled, Organization.unapply)
}

@ImplementedBy(classOf[OrganizationTable])
trait OrganizationTableRepository {
}

@Singleton
class OrganizationTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends OrganizationTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val organizations = TableQuery[OrganizationTableDef]

  /**
   * Gets a list of all organizations.
   *
   * @return A list of all organizations.
   */
//  def getAllOrganizations: List[Organization] = {
//    organizations.list
//  }
//
//  /**
//   * Checks if the organization with the given id exists.
//   *
//   * @param orgId The id of the organization.
//   * @return True if and only if the organization with the given id exists.
//   */
//  def containsId(orgId: Int): Boolean = {
//    organizations.filter(_.orgId === orgId).firstOption.isDefined
//  }
//
//  /**
//   * Gets the organization name from the given organization id.
//   *
//   * @param orgId The id of the organization.
//   * @return The name of the organization.
//   */
//  def getOrganizationName(orgId: Int): Option[String] = {
//    organizations.filter(_.orgId === orgId).map(_.orgName).firstOption
//  }
//
//  /**
//   * Gets the organization description from the given organization id.
//   *
//   * @param orgId The id of the organization.
//   * @return The description of the organization.
//   */
//  def getOrganizationDescription(orgId: Int): Option[String] = {
//    organizations.filter(_.orgId === orgId).map(_.orgDescription).firstOption
//  }
//
//  /**
//  * Inserts a new organization into the database.
//  *
//  * @param orgName The name of the organization to be created.
//  * @param orgDescription A brief description of the organization.
//  * @return The auto-generated ID of the newly created organization.
//  */
//  def insert(orgName: String, orgDescription: String): Int = {
//    val newOrganization = Organization(0, orgName, orgDescription) // orgId is auto-generated.
//    (organizations returning organizations.map(_.orgId)) += newOrganization
//  }
}
