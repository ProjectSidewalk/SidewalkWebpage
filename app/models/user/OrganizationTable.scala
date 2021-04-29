package models.user

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class Organization(orgId: Int, orgName: String, orgDescription: String)

class OrganizationTable(tag: slick.lifted.Tag) extends Table[Organization](tag, Some("sidewalk"), "organization") {
  def orgId = column[Int]("org_id", O.PrimaryKey, O.AutoInc)
  def orgName = column[String]("org_name", O.NotNull)
  def orgDescription = column[String]("org_description")

  def * = (orgId, orgName, orgDescription) <> ((Organization.apply _).tupled, Organization.unapply)
}

/**
 * Data access object for the organization table.
 */
object OrganizationTable {
  val db = play.api.db.slick.DB
  val organizations = TableQuery[OrganizationTable]

  /**
   * Gets a list of all organizations.
   *
   * @return A list of all organizations.
   */
  def getAllOrganizations: List[Organization] = db.withSession { implicit session =>
    organizations.list
  }

  /**
   * Checks if the organization with the given id exists.
   *
   * @param orgId The id of the organization.
   * @return True if and only if the organization with the given id exists.
   */
  def containsId(orgId: Int): Boolean = db.withSession { implicit session =>
    organizations.filter(_.orgId === orgId).firstOption.isDefined
  }

  /**
   * Gets the organization name from the given organization id.
   *
   * @param orgId The id of the organization.
   * @return The name of the organization.
   */
  def getOrganizationName(orgId: Int): Option[String] = db.withTransaction { implicit session =>
    organizations.filter(_.orgId === orgId).map(_.orgName).firstOption
  }

  /**
   * Gets the organization description from the given organization id.
   *
   * @param orgId The id of the organization.
   * @return The description of the organization.
   */
  def getOrganizationDescription(orgId: Int): Option[String] = db.withTransaction { implicit session =>
    organizations.filter(_.orgId === orgId).map(_.orgDescription).firstOption
  }
}
