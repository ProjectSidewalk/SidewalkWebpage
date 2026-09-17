package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.silhouette.api.Identity

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

case class SidewalkUser(userId: String, username: String, email: String)

/**
 * The user behind a request, loaded on every request. Account-wide settings ride along so pages needn't query again.
 *
 * @param communityService  Whether they're tracking their time for community service hours.
 * @param infra3dAccess     Whether they may view this city's infra3D imagery (always false in non-infra3D cities).
 * @param measurementSystem The units they chose on the Settings page, or None to follow the site language.
 */
case class SidewalkUserWithRole(
    userId: String,
    username: String,
    email: String,
    role: Role.Value,
    communityService: Boolean,
    infra3dAccess: Boolean,
    measurementSystem: Option[MeasurementSystem.Value]
) extends Identity

class SidewalkUserTableDef(tag: Tag) extends Table[SidewalkUser](tag, "sidewalk_user") {
  def userId: Rep[String]   = column[String]("user_id", O.PrimaryKey)
  def username: Rep[String] = column[String]("username")
  def email: Rep[String]    = column[String]("email")
  def *                     = (userId, username, email) <> (SidewalkUser.tupled, SidewalkUser.unapply)

  // CHECK (email = lower(email)) and CHECK (username NOT LIKE '%@%') in the DB.
  def usernameUnique = index("sidewalk_user_username_key", username, unique = true)
  def emailUnique    = index("sidewalk_user_email_key", email, unique = true)
}

/**
 * Companion object with constants that are shared throughout codebase.
 */
object SidewalkUserTable {
  val fallbackAnonUserId = "97760883-8ef0-4309-9a5e-0c086ef27573"
  val aiUserId: String   = "51b0b927-3c8a-45b2-93de-bd878d1e5cf4"

  /** Escapes a user's search text so its LIKE metacharacters match literally; pair with `like(..., '|')`. */
  def escapeLike(text: String): String = text.replace("|", "||").replace("%", "|%").replace("_", "|_")
}

@ImplementedBy(classOf[SidewalkUserTable])
trait SidewalkUserTableRepository {}

@Singleton
class SidewalkUserTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    userRoleTable: UserRoleTable
)(implicit ec: ExecutionContext)
    extends SidewalkUserTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val sidewalkUser           = TableQuery[SidewalkUserTableDef]
  val userRole               = TableQuery[UserRoleTableDef]
  val userSettings           = TableQuery[UserSettingsTableDef]
  val userTeam               = TableQuery[UserTeamTableDef]
  val team                   = TableQuery[TeamTableDef]
  val sidewalkUserToRoleJoin = sidewalkUser.join(userRole).on(_.userId === _.userId)
  // A left join, because a user with no user_settings row has every setting at its default.
  val sidewalkUserWithRole = sidewalkUserToRoleJoin
    .joinLeft(userSettings)
    .on(_._1.userId === _.userId)
    .map { case ((user, userRole), settings) =>
      (
        user.userId,
        user.username,
        user.email,
        userRole.role,
        settings.map(_.communityService).getOrElse(false),
        userRoleTable.infra3dAccessForCurrentCity(userRole),
        settings.flatMap(_.measurementSystem)
      )
    }
  val aiUsers    = sidewalkUserToRoleJoin.filter(_._2.role === Role.Ai).map(_._1)
  val humanUsers = sidewalkUserToRoleJoin.filter(_._2.role =!= Role.Ai).map(_._1)

  def findByUserId(userId: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._1 === userId).result.headOption).map(_.map(SidewalkUserWithRole.tupled))
  }

  /**
   * Resolves a batch of usernames to their user id and role, for annotating a list (e.g. the admin activity feed).
   *
   * @param usernames Usernames to look up.
   * @return Per matched user: (username, userId, role).
   */
  def getUserIdAndRoleByUsernames(usernames: Seq[String]): DBIO[Seq[(String, String, Role.Value)]] = {
    sidewalkUserToRoleJoin
      .filter(_._1.username inSet usernames)
      .map { case (user, userRole) => (user.username, user.userId, userRole.role) }
      .result
  }

  /**
   * Finds accounts an admin could add to a team (#5381). Anonymous accounts are left out: they can't belong to a team,
   * and they would crowd out the registered accounts being looked for. Each match's current team comes back with it,
   * so the admin sees that adding someone would move them before they do it.
   *
   * Matches whose username *starts* with the query sort first, so typing a name in full always surfaces that account
   * even when `limit` cuts off hundreds of accounts that merely contain the text somewhere.
   *
   * @param query A fragment to match, case-insensitively, against username or email. Its LIKE metacharacters are
   *              escaped: an admin typing `a_b` wants that name, not a wildcard.
   * @param limit The most matches to return.
   * @return Per match: (user id, username, email, role, the name of the team they're on).
   */
  def searchUsers(
      query: String,
      limit: Int
  ): DBIO[Seq[(String, String, String, Role.Value, Option[String])]] = {
    val escaped = SidewalkUserTable.escapeLike(query.trim)
    // Both sides fold in SQL: Java's case folding differs from Postgres's for some letters (the same trap
    // TeamTable.findByIdOrName calls out), and lower-casing the pattern here would apply only one of the two.
    val contains       = s"%$escaped%".bind.toLowerCase
    val startsWith     = s"$escaped%".bind.toLowerCase
    val likeEscapeChar = '|'

    sidewalkUserToRoleJoin
      .filter(_._2.role =!= Role.Anonymous)
      .filter { case (user, _) =>
        user.username.toLowerCase.like(contains, likeEscapeChar) ||
        user.email.toLowerCase.like(contains, likeEscapeChar)
      }
      .joinLeft(userTeam.join(team).on(_.teamId === _.teamId))
      .on { case ((user, _), (_userTeam, _)) => user.userId === _userTeam.userId }
      .map { case ((user, userRole), teamRow) =>
        (
          user.userId,
          user.username,
          user.email,
          userRole.role,
          teamRow.map(_._2.name),
          user.username.toLowerCase.like(startsWith, likeEscapeChar)
        )
      }
      .sortBy { case (_, username, _, _, _, isPrefix) => (isPrefix.desc, username.toLowerCase) }
      .take(limit)
      .result
      .map(_.map { case (userId, username, email, role, teamName, _) => (userId, username, email, role, teamName) })
  }

  def findByUsername(username: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._2 === username).result.headOption).map(_.map(SidewalkUserWithRole.tupled))
  }

  // Emails are stored lower-cased (the schema checks it), so lookups and writes lower-case here, not in every caller.
  def findByEmail(email: String): Future[Option[SidewalkUserWithRole]] = {
    db.run(sidewalkUserWithRole.filter(_._3 === email.toLowerCase).result.headOption)
      .map(_.map(SidewalkUserWithRole.tupled))
  }

  /**
   * Updates the username of a user.
   * @param userId The user ID of the user whose username is to be updated
   * @param newUsername The new username to set for the user
   * @return A DBIO action that returns the number of rows updated
   */
  def updateUsername(userId: String, newUsername: String): DBIO[Int] = {
    sidewalkUser.filter(_.userId === userId).map(_.username).update(newUsername)
  }

  /**
   * Updates the email of a user. NOTE: MUST be accompanied by updating login_info, handled by AuthenticationService.
   * @param userId The user ID of the user whose email is to be updated
   * @param newEmail The new email address to set for the user
   * @return A DBIO action that returns the number of rows updated
   */
  def updateEmail(userId: String, newEmail: String): DBIO[Int] = {
    sidewalkUser.filter(_.userId === userId).map(_.email).update(newEmail.toLowerCase)
  }

  def insert(newUser: SidewalkUser): DBIO[String] = {
    (sidewalkUser returning sidewalkUser.map(_.userId)) += newUser.copy(email = newUser.email.toLowerCase)
  }
}
