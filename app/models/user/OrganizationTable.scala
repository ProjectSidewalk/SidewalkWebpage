package models.user

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{Json, OFormat}


case class Organization(orgId: Int, orgName: String, orgDescription: String, isOpen: Boolean, isVisible: Boolean)

object Organization {
  implicit val format: OFormat[Organization] = Json.format[Organization]
}

class OrganizationTable(tag: slick.lifted.Tag) extends Table[Organization](tag, "organization") {
  def orgId = column[Int]("org_id", O.PrimaryKey, O.AutoInc)
  def orgName = column[String]("org_name", O.NotNull)
  def orgDescription = column[String]("org_description", O.NotNull)
  def isOpen = column[Boolean]("is_open", O.NotNull, O.Default(true))
  def isVisible = column[Boolean]("is_visible", O.NotNull, O.Default(true))

  def * = (orgId, orgName, orgDescription, isOpen, isVisible) <> ((Organization.apply _).tupled, Organization.unapply)
}

/**
 * Data access object for the organization table.
 */
object OrganizationTable {
  val db = play.api.db.slick.DB
  val organizations = TableQuery[OrganizationTable]

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
  
  /**
  * Inserts a new organization into the database.
  *
  * @param orgName The name of the organization to be created.
  * @param orgDescription A brief description of the organization.
  * @return The auto-generated ID of the newly created organization.
  */
  def insert(orgName: String, orgDescription: String): Int = db.withSession { implicit session =>
    val newOrganization = Organization(0, orgName, orgDescription, true, true) // orgId is auto-generated.
    (organizations returning organizations.map(_.orgId)) += newOrganization
  }

  /**
  * Gets a list of all teams, regardless of status.
  *
  * @return A list of all teams.
  */
  def getAllTeams(): List[Organization] = db.withSession { implicit session =>
    organizations.list
  }

  /**
  * Gets a list of all "open" teams.
  *
  * @return A list of all open teams.
  */
  def getAllOpenTeams(): List[Organization] = db.withSession { implicit session =>
    organizations.filter(_.isOpen === true).list
  }

  /**
  * Updates the visibility of an organization.
  *
  * @param orgId: The ID of the organization to update.
  * @param isVisible: The new visibility status.
  */
  def updateVisibility(orgId: Int, isVisible: Boolean): Int = db.withSession { implicit session =>
      val query = for {
          org <- organizations if org.orgId === orgId
      } yield (org.isVisible)
      query.update((isVisible))
  }

  /**
  * Updates the status of an organization.
  *
  * @param orgId: The ID of the organization to update.
  * @param isOpen: The new status of the organization.
  */
  def updateStatus(orgId: Int, isOpen: Boolean): Int = db.withSession { implicit session =>
      val query = for {
          org <- organizations if org.orgId === orgId
      } yield (org.isOpen)
      query.update((isOpen))
  }

  /**
  * Gets the organization by the given organization id.
  *
  * @param orgId The id of the organization.
  * @return An Option containing the organization, or None if not found.
  */
  def getOrganization(orgId: Int): Option[Organization] = db.withTransaction { implicit session =>
    organizations.filter(_.orgId === orgId).firstOption
  }
}
