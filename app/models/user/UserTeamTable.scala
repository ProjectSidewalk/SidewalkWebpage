package models.user

import java.util.UUID
import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class UserTeam(userTeamId: Int, userId: String, teamId: Int)

class UserTeamTable(tag: slick.lifted.Tag) extends Table[UserTeam](tag, "user_team") {
  def userTeamId = column[Int]("user_team_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def teamId = column[Int]("team_id", O.NotNull)

  def * = (userTeamId, userId, teamId) <> ((UserTeam.apply _).tupled, UserTeam.unapply)
}

/**
 * Data access object for the user_team table.
 */
object UserTeamTable {
  val db = play.api.db.slick.DB
  val userTeams = TableQuery[UserTeamTable]

  /**
   * Gets the team the given user is affiliated with.
   *
   * @param userId The id of the user.
   * @return The team the given user is affiliated with.
   */
  def getTeam(userId: UUID): Option[Int] = db.withSession { implicit session =>
    userTeams.filter(_.userId === userId.toString).map(_.teamId).firstOption
  }

  /**
   * Gets all users affiliated with the given team.
   *
   * @param teamId The id of the team.
   * @return A list of all users affiliated with the given team.
   */
  def getAllUsers(teamId: Int): List[String] = db.withSession { implicit session =>
    userTeams.filter(_.teamId === teamId).map(_.userId).list
  }
  
  /**
   * Saves a new user-team affiliation if and only if the given teamId is valid.
   *
   * @param userId The id of the user.
   * @param teamId The id of the team.
   * @return The id of the new user-team affiliation.
   *         However, if the given teamId is invalid, then it returns 0.
   */
  def save(userId: UUID, teamId: Int): Int = db.withSession { implicit session =>
    if (TeamTable.containsId(teamId)) {
      userTeams.insertOrUpdate(UserTeam(0, userId.toString, teamId))
    } else {
      -1
    }
  }

  /**
   * Removes a user-team affiliation.
   *
   * @param userId The id of the user.
   * @param teamId The id of the team.
   * @return The id of the removed user-team affiliation.
   */
  def remove(userId: UUID, teamId: Int): Int = db.withSession { implicit session =>
    userTeams.filter(r => r.userId === userId.toString && r.teamId === teamId).delete
  }
}
