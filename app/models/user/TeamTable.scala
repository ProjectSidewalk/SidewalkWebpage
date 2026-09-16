package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class Team(teamId: Int, name: String, description: String, open: Boolean, visible: Boolean)

// `name` also carries DB-only UNIQUE/CHECK constraints Slick has no DSL for; see evolution 393 (#5342).
class TeamTableDef(tag: slick.lifted.Tag) extends Table[Team](tag, "team") {
  def teamId: Rep[Int]         = column[Int]("team_id", O.PrimaryKey, O.AutoInc)
  def name: Rep[String]        = column[String]("name")
  def description: Rep[String] = column[String]("description")
  def open: Rep[Boolean]       = column[Boolean]("open", O.Default(true))
  def visible: Rep[Boolean]    = column[Boolean]("visible", O.Default(true))

  def * = (teamId, name, description, open, visible) <> ((Team.apply _).tupled, Team.unapply)
}

@ImplementedBy(classOf[TeamTable])
trait TeamTableRepository {}

@Singleton
class TeamTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends TeamTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val teams = TableQuery[TeamTableDef]

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
   * Finds a team by id when given only ASCII digits, otherwise by name.
   *
   * Names are compared in SQL, matching the `team_name_key` index; Java's case folding differs for some letters.
   *
   * @param idOrName A team id or name, as typed in a URL.
   */
  def findByIdOrName(idOrName: String): DBIO[Option[Team]] = {
    val byId: Option[Int] = if (idOrName.matches("[0-9]+")) idOrName.toIntOption else None
    byId match {
      case Some(id) => teams.filter(_.teamId === id).result.headOption
      case None     =>
        teams.filter(_.name.trim.toLowerCase === idOrName.bind.trim.toLowerCase).result.headOption
    }
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
