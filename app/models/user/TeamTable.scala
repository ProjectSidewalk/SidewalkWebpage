package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class Team(teamId: Int, name: String, description: String, open: Boolean, visible: Boolean)
// TODO what is this for and should we remove it? It's a companion object for the Team class.
//object Team {
//  implicit val format: OFormat[Team] = Json.format[Team]
//}

class TeamTableDef(tag: slick.lifted.Tag) extends Table[Team](tag, "team") {
  def teamId: Rep[Int] = column[Int]("team_id", O.PrimaryKey, O.AutoInc)
  def name: Rep[String] = column[String]("name")
  def description: Rep[String] = column[String]("description")
  def open: Rep[Boolean] = column[Boolean]("open", O.Default(true))
  def visible: Rep[Boolean] = column[Boolean]("visible", O.Default(true))

  def * = (teamId, name, description, open, visible) <> ((Team.apply _).tupled, Team.unapply)
}

@ImplementedBy(classOf[TeamTable])
trait TeamTableRepository {
}

@Singleton
class TeamTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends TeamTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val teams = TableQuery[TeamTableDef]

//  /**
//   * Gets the team by the given team id.
//   *
//   * @param teamId The id of the team.
//   * @return An Option containing the team, or None if not found.
//   */
//  def getTeam(teamId: Int): Option[Team] = db.withSession { implicit session =>
//    teams.filter(_.teamId === teamId).firstOption
//  }
//
//  /**
//   * Checks if the team with the given id exists.
//   *
//   * @param teamId The id of the team.
//   * @return True if and only if the team with the given id exists.
//   */
//  def containsId(teamId: Int): Boolean = db.withSession { implicit session =>
//    teams.filter(_.teamId === teamId).firstOption.isDefined
//  }
//
//  /**
//   * Gets the team name from the given team id.
//   *
//   * @param teamId The id of the team.
//   * @return The name of the team.
//   */
//  def getTeamName(teamId: Int): Option[String] = db.withSession { implicit session =>
//    teams.filter(_.teamId === teamId).map(_.name).firstOption
//  }
//
//  /**
//   * Gets the team description from the given team id.
//   *
//   * @param teamId The id of the team.
//   * @return The description of the team.
//   */
//  def getTeamDescription(teamId: Int): Option[String] = db.withSession { implicit session =>
//    teams.filter(_.teamId === teamId).map(_.description).firstOption
//  }

  /**
   * Gets a seq of all teams, regardless of status.
   * @return A seq of all teams.
   */
  def getAllTeams: DBIO[Seq[Team]] = {
    teams.result
  }

  /**
   * Gets a seq of all "open" teams.
   * @return A seq of all open teams.
   */
  def getAllOpenTeams: DBIO[Seq[Team]] = {
    teams.filter(_.open === true).result
  }

  /**
   * Updates the visibility of a team.
   * @param teamId The ID of the team to update.
   * @param visible The new visibility status.
   */
  def updateVisibility(teamId: Int, visible: Boolean): DBIO[Int] = {
    teams.filter(_.teamId === teamId).map(_.visible).update(visible)
  }

  /**
   * Updates the status of a team.
   * @param teamId The ID of the team to update.
   * @param open The new status of the team.
   */
  def updateStatus(teamId: Int, open: Boolean): DBIO[Int] = {
    teams.filter(_.teamId === teamId).map(_.open).update(open)
  }

  /**
  * Inserts a new team into the database.
  * @param name The name of the team to be created.
  * @param description A brief description of the team.
  * @return The auto-generated ID of the newly created team.
  */
  def insert(name: String, description: String): DBIO[Int] = {
    (teams returning teams.map(_.teamId)) += Team(0, name, description, open = true, visible = true)
  }
}
