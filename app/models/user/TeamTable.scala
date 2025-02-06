package models.user

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import play.api.libs.json.{Json, OFormat}


case class Team(teamId: Int, name: String, description: String, open: Boolean, visible: Boolean)

object Team {
  implicit val format: OFormat[Team] = Json.format[Team]
}

class TeamTable(tag: slick.lifted.Tag) extends Table[Team](tag, "team") {
  def teamId = column[Int]("team_id", O.PrimaryKey, O.AutoInc)
  def name = column[String]("name", O.NotNull)
  def description = column[String]("description", O.NotNull)
  def open = column[Boolean]("open", O.NotNull, O.Default(true))
  def visible = column[Boolean]("visible", O.NotNull, O.Default(true))

  def * = (teamId, name, description, open, visible) <> ((Team.apply _).tupled, Team.unapply)
}

/**
 * Data access object for the team table.
 */
object TeamTable {
  val db = play.api.db.slick.DB
  val teams = TableQuery[TeamTable]

  /**
   * Checks if the team with the given id exists.
   *
   * @param teamId The id of the team.
   * @return True if and only if the team with the given id exists.
   */
  def containsId(teamId: Int): Boolean = db.withSession { implicit session =>
    teams.filter(_.teamId === teamId).firstOption.isDefined
  }

  /**
   * Gets the team name from the given team id.
   *
   * @param teamId The id of the team.
   * @return The name of the team.
   */
  def getTeamName(teamId: Int): Option[String] = db.withSession { implicit session =>
    teams.filter(_.teamId === teamId).map(_.name).firstOption
  }

  /**
   * Gets the team description from the given team id.
   *
   * @param teamId The id of the team.
   * @return The description of the team.
   */
  def getTeamDescription(teamId: Int): Option[String] = db.withSession { implicit session =>
    teams.filter(_.teamId === teamId).map(_.description).firstOption
  }
  
  /**
  * Inserts a new team into the database.
  *
  * @param name The name of the team to be created.
  * @param description A brief description of the team.
  * @return The auto-generated ID of the newly created team.
  */
  def insert(name: String, description: String): Int = db.withSession { implicit session =>
    val newTeam = Team(0, name, description, true, true) // teamId is auto-generated.
    (teams returning teams.map(_.teamId)) += newTeam
  }

  /**
  * Gets a list of all teams, regardless of status.
  *
  * @return A list of all teams.
  */
  def getAllTeams(): List[Team] = db.withSession { implicit session =>
    teams.list
  }

  /**
  * Gets a list of all "open" teams.
  *
  * @return A list of all open teams.
  */
  def getAllOpenTeams(): List[Team] = db.withSession { implicit session =>
    teams.filter(_.open === true).list
  }

  /**
  * Updates the visibility of an team.
  *
  * @param teamId: The ID of the team to update.
  * @param visible: The new visibility status.
  */
  def updateVisibility(teamId: Int, visible: Boolean): Int = db.withSession { implicit session =>
    teams.filter(_.teamId === teamId).map(_.visible).update(visible)
  }

  /**
  * Updates the status of an team.
  *
  * @param teamId: The ID of the team to update.
  * @param open: The new status of the team.
  */
  def updateStatus(teamId: Int, open: Boolean): Int = db.withSession { implicit session =>
    teams.filter(_.teamId === teamId).map(_.open).update(open)
  }

  /**
  * Gets the team by the given team id.
  *
  * @param teamId The id of the team.
  * @return An Option containing the team, or None if not found.
  */
  def getTeam(teamId: Int): Option[Team] = db.withSession { implicit session =>
    teams.filter(_.teamId === teamId).firstOption
  }
}
