package models.daos

import java.sql.Timestamp
import java.util.UUID

import com.mohiva.play.silhouette.api.LoginInfo
import models.daos.UserDAOImpl._
import models.daos.slickdaos.DBTableDefinitions.{DBUser, UserTable}
import models.user.{RoleTable, User, UserRoleTable, WebpageActivityTable}
import models.audit._
import models.label.LabelTable
import models.mission.MissionTable

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile

import scala.collection.mutable
import scala.concurrent.Future
import models.utils.MyPostgresDriver.api._

import scala.concurrent.ExecutionContext.Implicits.global

case class UserStatsForAdminPage(userId: String, username: String, email: String, role: String,
                                 signUpTime: Option[Timestamp], lastSignInTime: Option[Timestamp], signInCount: Int,
                                 completedMissions: Int, completedAudits: Int, labels: Int)

class UserDAOImpl extends UserDAO {


  /**
   * Finds a user by its login info.
   *
   * @param loginInfo The login info of the user to find.
   * @return The found user or None if no user for the given login info could be found.
   */
  def find(loginInfo: LoginInfo) = Future.successful(
    users.find { case (id, user) => user.loginInfo == loginInfo }.map(_._2)
  )

  /**
   * Finds a user by its user ID.
   *
   * @param userID The ID of the user to find.
   * @return The found user or None if no user for the given ID could be found.
   */
  def find(userID: UUID) = Future.successful(users.get(userID))

  def find(username: String) = Future.successful(
    users.find { case (id, user) => user.username == username }.map(_._2)
  )

  /**
   * Saves a user.
   *
   * @param user The user to save.
   * @return The saved user.
   */
  def save(user: User) = {
    users += (user.userId -> user)
    Future.successful(user)
  }
}

/**
 * The companion object.
 */
object UserDAOImpl {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val userTable = TableQuery[UserTable]
  val userRoleTable = TableQuery[UserRoleTable]
  val roleTable = TableQuery[RoleTable]
  val auditTaskTable = TableQuery[AuditTaskTable]
  val auditTaskEnvironmentTable = TableQuery[AuditTaskEnvironmentTable]
  val auditTaskInteractionTable = TableQuery[AuditTaskInteractionTable]

  val users: mutable.HashMap[UUID, User] = mutable.HashMap()

  def all: Future[List[DBUser]] = db.run(
    userTable.to[List].result
  )

  def size: Future[Int] = db.run(
    userTable.length.result
  )

  /**
    * Count the number of users of the given role who have ever started (or completed) an audit task.
    *
    * @param roles
    * @param taskCompleted
    * @return
    */
  def countUsersContributed(roles: List[String], taskCompleted: Boolean): Future[Int] = db.run({

    val tasks = if (taskCompleted) auditTaskTable.filter(_.completed) else auditTaskTable

    val users = for {
      _task <- tasks
      _user <- userTable if _task.userId === _user.userId
      _userRole <- userRoleTable if _user.userId === _userRole.userId
      _role <- roleTable if _userRole.roleId === _role.roleId
      if _user.username =!= "anonymous"
      if _role.role inSet roles
    } yield _user.userId

    // The group by and map does a SELECT DISTINCT, and the list.length does the COUNT.
    users.groupBy(x => x).map(_._1).length.result
  })

  /**
    * Count the number of researchers who have ever started (or completed) an audit task.
    *
    * Researchers include the Researcher, Adminstrator, and Owner roles.
    *
    * @param taskCompleted
    * @return
    */
  def countResearchersContributed(taskCompleted: Boolean): Future[Int] =
    countUsersContributed(List("Researcher", "Administrator", "Owner"), taskCompleted)

  /**
    * Count the number of users who have ever started (or completed) an audit task (across all roles).
    *
    * @param taskCompleted
    * @return
    */
  def countAllUsersContributed(taskCompleted: Boolean): Future[Int] = db.run(
    (roleTable.map(_.role).to[List].result)
  ).flatMap { l =>
    countUsersContributed(l, taskCompleted)
  }

  /**
    * Count the number of users of the given role who contributed today.
    *
    * We consider a "contribution" to mean that a user has completed at least one audit task.
    *
    * @param role
    * @return
    */
  def countUsersContributedToday(role: String): Future[Int] = {
    def countQuery(role: String) =
      sql"""SELECT COUNT(DISTINCT(audit_task.user_id))
             FROM sidewalk.audit_task
                INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
                INNER JOIN sidewalk_user_role ON sidewalk_user.user_id = sidewalk_user_role.user_id
                INNER JOIN sidewalk.role ON sidewalk_user_role.role_id = sidewalk.role.role_id
             WHERE audit_task.task_end::date = now()::date
                AND sidewalk_user.username <> 'anonymous'
                AND role.role = #$role
                AND audit_task.completed = true
        """.as[Int]

    db.run(countQuery(role).head)
  }

  /**
    * Count the number of researchers who contributed today (includes Researcher, Adminstrator, and Owner roles).
    *
    * @return
    */
  def countResearchersContributedToday: Future[Int] = {
    for {
      researchers <- countUsersContributedToday("Researcher")
      administrators <- countUsersContributedToday("Administrator")
      owners <- countUsersContributedToday("Owner")
    } yield (researchers + administrators + owners)
  }

  /**
    * Count the number of users who contributed today (across all roles).
    *
    * @return
    */
  def countAllUsersContributedToday: Future[Int] = {
    for {
      registered <- countUsersContributedToday("Registered")
      anonymous <- countUsersContributedToday("Anonymous")
      turkers <- countUsersContributedToday("Turker")
      researchers <- countResearchersContributedToday
    } yield (registered + anonymous + turkers + researchers)
  }

  /**
    * Count the number of users of the given role who contributed yesterday.
    *
    * We consider a "contribution" to mean that a user has completed at least one audit task.
    *
    * @param role
    * @return
    */
  def countUsersContributedYesterday(role: String): Future[Int] = {
    def countQuery(role: String) =
      sql"""SELECT COUNT(DISTINCT(audit_task.user_id))
             FROM sidewalk.audit_task
                INNER JOIN sidewalk_user ON sidewalk_user.user_id = audit_task.user_id
                INNER JOIN sidewalk_user_role ON sidewalk_user.user_id = sidewalk_user_role.user_id
                INNER JOIN sidewalk.role ON sidewalk_user_role.role_id = sidewalk.role.role_id
             WHERE audit_task.task_end::date = now()::date - interval '1' day
                AND sidewalk_user.username <> 'anonymous'
                AND role.role = #$role
                AND audit_task.completed = true
        """.as[Int]

    db.run(countQuery(role).head)
  }

  /**
    * Count the number of researchers who contributed yesterday (includes Researcher, Adminstrator, and Owner roles).
    *
    * @return
    */
  def countResearchersContributedYesterday: Future[Int] = {
    for {
      researchers <- countUsersContributedYesterday("Researcher")
      administrators <- countUsersContributedYesterday("Administrator")
      owners <- countUsersContributedYesterday("Owner")
    } yield (researchers + administrators + owners)
  }

  /**
    * Count the number of users who contributed yesterday (across all roles).
    *
    * @return
    */
  def countAllUsersContributedYesterday: Future[Int] = {
    for {
      registered <- countUsersContributedYesterday("Registered")
      anonymous <- countUsersContributedYesterday("Anonymous")
      turkers <- countUsersContributedYesterday("Turker")
      researchers <- countResearchersContributedYesterday
    } yield (registered + anonymous + turkers + researchers)
  }

  /**
    * Gets metadata for each user that we use on the admin page.
    *
    * @return
    */
  def getUserStatsForAdminPage: Future[List[UserStatsForAdminPage]] = {

    // We run 6 queries for different bits of metadata that we need. We run each query and convert them to Scala maps
    // with the user_id as the key. We then query for all the users in the `user` table and for each user, we lookup
    // the user's metadata in each of the maps from those 6 queries. This simulates a left join across the six sub-
    // queries. We are using Scala Map objects instead of Slick b/c Slick doesn't create very efficient queries for this
    // use-case (at least in the old version of Slick that we are using right now).

    // Map(user_id: String -> role: String)
    val rolesF: Future[Map[String, String]] = db.run {
      userRoleTable.join(roleTable).on(_.roleId === _.roleId).map(x => (x._1.userId, x._2.role)).result
    }.map(_.toMap)

    // Map(user_id: String -> signup_time: Option[Timestamp])
    val signUpTimesF: Future[Map[String, Option[Timestamp]]] = db.run {
      WebpageActivityTable.activities.filter(_.activity inSet List("AnonAutoSignUp", "SignUp"))
        .groupBy(_.userId).map { case (_userId, group) => (_userId, group.map(_.timestamp).max) }.result
    }.map(_.toMap)

    // Map(user_id: String -> (most_recent_sign_in_time: Option[Timestamp], sign_in_count: Int))
    val signInTimesAndCountsF: Future[Map[String, (Option[Timestamp], Int)]] = db.run {
      WebpageActivityTable.activities.filter(_.activity inSet List("AnonAutoSignUp", "SignIn"))
        .groupBy(_.userId).map { case (_userId, group) => (_userId, group.map(_.timestamp).min, group.length) }.result
      //        .list.map { case (_userId, _time, _count) => (_userId, (_time, _count)) }.toMap
    }.map { rows => rows.map { case (_userId, _time, _count) => (_userId, (_time, _count)) }.toMap }

    // Map(user_id: String -> mission_count: Int)
    val missionCountsF: Future[Map[String, Int]] = db.run {
      MissionTable.missions.filter(_.completed)
        .groupBy(_.userId).map { case (_userId, group) => (_userId, group.length) }.result
    }.map(_.toMap)

    // Map(user_id: String -> audit_count: Int)
    val auditCountsF: Future[Map[String, Int]] = db.run {
      AuditTaskTable.completedTasks.groupBy(_.userId).map { case (_uId, group) => (_uId, group.length) }.result
    }.map(_.toMap)

    // Map(user_id: String -> label_count: Int)
    val labelCountsF: Future[Map[String, Int]] = db.run {
      AuditTaskTable.auditTasks.join(LabelTable.labelsWithoutDeleted).on(_.auditTaskId === _.auditTaskId)
        .groupBy(_._1.userId).map { case (_userId, group) => (_userId, group.length) }.result
    }.map(_.toMap)

    // Now left join them all together and put into UserStatsForAdminPage objects.
    for {
      dbUsers <- UserDAOImpl.all
      roles <- rolesF
      signUpTimes <- signUpTimesF
      signInTimesAndCounts <- signInTimesAndCountsF
      missionCounts <- missionCountsF
      auditCounts <- auditCountsF
      labelCounts <- labelCountsF
    } yield {
      dbUsers.map { u =>
        UserStatsForAdminPage(
          u.userId, u.username, u.email,
          roles.getOrElse(u.userId, ""),
          signUpTimes.get(u.userId).flatten,
          signInTimesAndCounts.get(u.userId).flatMap(_._1), signInTimesAndCounts.get(u.userId).map(_._2).getOrElse(0),
          missionCounts.getOrElse(u.userId, 0),
          auditCounts.getOrElse(u.userId, 0),
          labelCounts.getOrElse(u.userId, 0)
        )
      }
    }
  }
}
