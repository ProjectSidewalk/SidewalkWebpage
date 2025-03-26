package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class UserTeam(userTeamId: Int, userId: String, teamId: Int)

class UserTeamTableDef(tag: slick.lifted.Tag) extends Table[UserTeam](tag, "user_team") {
  def userTeamId: Rep[Int] = column[Int]("user_team_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def teamId: Rep[Int] = column[Int]("team_id")

  def * = (userTeamId, userId, teamId) <> ((UserTeam.apply _).tupled, UserTeam.unapply)
}

@ImplementedBy(classOf[UserTeamTable])
trait UserTeamTableRepository {
}

@Singleton
class UserTeamTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserTeamTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val userTeams = TableQuery[UserTeamTableDef]
  val teams = TableQuery[TeamTableDef]

  /**
   * Gets the team the given user is affiliated with.
   *
   * @param userId The id of the user.
   * @return The team the given user is affiliated with.
   */
  def getTeam(userId: String): DBIO[Option[Team]] = {
    teams.join(userTeams).on(_.teamId === _.teamId).filter(_._2.userId === userId).map(_._1).result.headOption
  }

//  /**
//   * Gets all users affiliated with the given team.
//   *
//   * @param teamId The id of the team.
//   * @return A list of all users affiliated with the given team.
//   */
//  def getAllUsers(teamId: Int): List[String] = db.withSession { implicit session =>
//    userTeams.filter(_.teamId === teamId).map(_.userId).list
//  }
//
//  /**
//   * Saves a new user-team affiliation if and only if the given teamId is valid.
//   *
//   * @param userId The id of the user.
//   * @param teamId The id of the team.
//   * @return The id of the new user-team affiliation.
//   *         However, if the given teamId is invalid, then it returns 0.
//   */
//  def save(userId: UUID, teamId: Int): Int = db.withSession { implicit session =>
//    if (TeamTable.containsId(teamId)) {
//      userTeams.insertOrUpdate(UserTeam(0, userId.toString, teamId))
//    } else {
//      -1
//    }
//  }
//
//  /**
//   * Removes a user-team affiliation.
//   *
//   * @param userId The id of the user.
//   * @param teamId The id of the team.
//   * @return The id of the removed user-team affiliation.
//   */
//  def remove(userId: UUID, teamId: Int): Int = db.withSession { implicit session =>
//    userTeams.filter(r => r.userId === userId.toString && r.teamId === teamId).delete
//  }
}
