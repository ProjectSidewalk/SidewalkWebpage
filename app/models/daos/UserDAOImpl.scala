package models.daos

import java.util.UUID

import com.mohiva.play.silhouette.api.LoginInfo
import models.daos.UserDAOImpl._
import models.daos.slickdaos.DBTableDefinitions.{DBUser, UserTable}
import models.user.{RoleTable, User, UserRoleTable}
import models.audit._

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile

import scala.collection.mutable
import scala.concurrent.Future
import models.utils.MyPostgresDriver.api._

import scala.concurrent.ExecutionContext.Implicits.global

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
}
