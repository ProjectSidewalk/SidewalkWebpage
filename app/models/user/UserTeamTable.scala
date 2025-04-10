package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

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
class UserTeamTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider,
                              implicit val ec: ExecutionContext) extends UserTeamTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val userTeams = TableQuery[UserTeamTableDef]
  val teams = TableQuery[TeamTableDef]

  /**
   * Gets the team the given user is affiliated with.
   * @param userId The id of the user.
   * @return The team the given user is affiliated with.
   */
  def getTeam(userId: String): DBIO[Option[Team]] = {
    teams.join(userTeams).on(_.teamId === _.teamId).filter(_._2.userId === userId).map(_._1).result.headOption
  }

  def getUserIdsWithTeamNames: DBIO[Seq[(String, String)]] = {
    userTeams.join(teams).on(_.teamId === _.teamId).map { case (userTeam, team) => (userTeam.userId, team.name) }.result
  }

  /**
   * Saves a new user-team affiliation if and only if the given teamId is valid.
   * @param userId The id of the user.
   * @param teamId The id of the team.
   * @return The id of the new user-team affiliation, or 0 if the given teamId is invalid.
   */
  def save(userId: String, teamId: Int): DBIO[Int] = {
    teams.filter(_.teamId === teamId).result.headOption.flatMap {
      case Some(_) => userTeams.insertOrUpdate(UserTeam(0, userId, teamId))
      case _ => DBIO.successful(0)
    }
  }

  /**
   * Removes a user-team affiliation.
   * @param userId The id of the user.
   * @param teamId The id of the team.
   * @return The id of the removed user-team affiliation.
   */
  def remove(userId: String, teamId: Int): DBIO[Int] = {
    userTeams.filter(r => r.userId === userId && r.teamId === teamId).delete
  }
}
